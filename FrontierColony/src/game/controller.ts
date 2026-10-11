/**
 * GameController: owns the GameState and glues sim, renderer and store together.
 *
 *  - Runs the fixed-timestep loop on requestAnimationFrame (speed multiplier, pause).
 *  - Forwards player commands to the sim, raises toasts for failures and notable events.
 *  - Calls the renderer every frame and forwards UI intent (selection, ghost, overlay) to it.
 *  - Publishes a throttled HUD snapshot to the store.
 *  - Saves/loads to storage (manual slots + autosave at each new day and on page hide).
 */
import type { StoreApi } from 'zustand/vanilla';
import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  applyCommand,
  canPlaceBuilding,
  createGame,
  getBuilding,
  getSettler,
  stepGame,
  type CommandResult,
  type GameState,
  type NewGameOptions,
  type PlayerCommand,
  type SimEvent,
  type TilePos,
} from '../sim';
import type { CameraState, CreateRenderer, GameRenderer, PointerButton } from '../render/types';
import type { GameSpeed } from '../shared/types';
import { SNAPSHOT_INTERVAL_MS, buildHudSnapshot, type UiStore } from '../store';
import { MAX_FRAME_MS, advanceClock } from './clock';
import {
  deleteSlot,
  listSaveSlots,
  loadFromSlot,
  saveToSlot,
  type KeyValueStorage,
  type LoadResult,
  type SaveResult,
  type SaveSlotId,
  type SaveSlotInfo,
} from './save';
import type { GameControllerApi } from './types';

export interface GameControllerOptions {
  store: StoreApi<UiStore>;
  storage: KeyValueStorage;
  createRenderer: CreateRenderer;
  /** Initial game; defaults to createGame(DEFAULT_NEW_GAME_OPTIONS). */
  initialState?: GameState;
}

export class GameController implements GameControllerApi {
  private state: GameState;
  private renderer: GameRenderer | null = null;
  private readonly store: StoreApi<UiStore>;
  private readonly storage: KeyValueStorage;
  private readonly makeRenderer: CreateRenderer;
  private frameHandle = 0;
  private lastFrameAt = 0;
  private accumulatorMs = 0;
  private lastSnapshotAt = -Infinity;
  private snapshotDirty = true;
  private pendingEvents: SimEvent[] = [];
  private mountToken = 0;
  private unsubscribeStore: (() => void) | null = null;
  /**
   * Set when a tick or render threw. The state may be half-updated, so the loop stays paused and
   * autosave is off until a new game or a load replaces the state.
   */
  private faulted = false;
  private readonly onPageHide = () => this.autosave();

  constructor(options: GameControllerOptions) {
    this.store = options.store;
    this.storage = options.storage;
    this.makeRenderer = options.createRenderer;
    this.state = options.initialState ?? createGame(DEFAULT_NEW_GAME_OPTIONS);
  }

  // --- lifecycle ---------------------------------------------------------------------------

  /**
   * Create the renderer inside `host` and start the loop. Safe under React StrictMode: if
   * `unmount()` runs while the renderer is still initialising, the late renderer is destroyed.
   */
  async mount(host: HTMLElement): Promise<void> {
    const token = ++this.mountToken;
    const renderer = await this.makeRenderer(host, {
      onTileHover: (tile) => this.handleHover(tile),
      onTileClick: (tile, button) => this.handleTileClick(tile, button),
      onSettlerClick: (id, button) => this.handleEntityClick({ kind: 'settler', id }, button),
      onBuildingClick: (id, button) => this.handleEntityClick({ kind: 'building', id }, button),
    });
    if (token !== this.mountToken) {
      renderer.destroy();
      return;
    }
    this.renderer = renderer;
    renderer.setWorld(this.state);
    this.syncRendererWithStore(this.store.getState());
    this.unsubscribeStore = this.store.subscribe((s, prev) => this.onStoreChange(s, prev));
    window.addEventListener('pagehide', this.onPageHide);
    this.publishSnapshot(performance.now());
    this.lastFrameAt = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  unmount(): void {
    this.mountToken++;
    cancelAnimationFrame(this.frameHandle);
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    window.removeEventListener('pagehide', this.onPageHide);
    this.renderer?.destroy();
    this.renderer = null;
  }

  // --- loop --------------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    this.frameHandle = requestAnimationFrame(this.frame);
    const frameMs = Math.min(Math.max(now - this.lastFrameAt, 0), MAX_FRAME_MS);
    this.lastFrameAt = now;
    const ui = this.store.getState();
    const paused = ui.paused || this.faulted || this.state.outcome.status === 'lost';
    const clock = advanceClock(this.accumulatorMs, frameMs, ui.speed, paused);
    this.accumulatorMs = clock.accumulatorMs;
    try {
      for (let i = 0; i < clock.steps; i++) this.runTick();
      const events = this.pendingEvents;
      this.pendingEvents = [];
      this.renderer?.render(this.state, { alpha: clock.alpha, frameMs, nowMs: now, speed: paused ? 0 : ui.speed, events });
      if (this.snapshotDirty && now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) this.publishSnapshot(now);
    } catch (err) {
      this.fault(err);
    }
  };

  /** Stop the simulation after an unexpected error, without letting it reach autosave. */
  private fault(err: unknown): void {
    this.pendingEvents = [];
    if (this.faulted) return;
    this.faulted = true;
    console.error('Frontier Colony: simulation halted after an error', err);
    const ui = this.store.getState();
    ui.setPaused(true);
    ui.pushToast('Something went wrong and the game was paused. Autosave is off; load a save to continue.', 'danger');
  }

  private runTick(): void {
    const events = stepGame(this.state);
    this.snapshotDirty = true;
    if (events.length > 0) this.handleEvents(events);
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      this.pendingEvents.push(e);
      const toast = toastFor(e, this.state);
      if (toast) this.store.getState().pushToast(toast.message, toast.severity);
      if (e.type === 'dayStarted') this.autosave();
      // Pause on victory/defeat so the UI can show the end screen. After victory the player may
      // dispatch `acknowledgeVictory` and resume (sandbox).
      if (e.type === 'gameOver') this.store.getState().setPaused(true);
    }
  }

  private publishSnapshot(now: number): void {
    this.lastSnapshotAt = now;
    this.snapshotDirty = false;
    const ui = this.store.getState();
    // Drop selections that point at entities that no longer exist.
    const sel = ui.selection;
    if (
      (sel?.kind === 'settler' && !getSettler(this.state, sel.id)) ||
      (sel?.kind === 'building' && !getBuilding(this.state, sel.id))
    ) {
      ui.select(null);
    }
    ui.setSnapshot(buildHudSnapshot(this.state, ui.selection));
    // Stock, settlers and sites change while the cursor rests: keep the placement ghost current.
    if (ui.buildMode) this.syncRendererWithStore(ui);
  }

  // --- store → renderer --------------------------------------------------------------------

  private onStoreChange(s: UiStore, prev: UiStore): void {
    if (s.selection !== prev.selection || s.buildMode !== prev.buildMode || s.hoverTile !== prev.hoverTile || s.overlay !== prev.overlay) {
      this.syncRendererWithStore(s);
    }
  }

  private syncRendererWithStore(s: UiStore): void {
    const r = this.renderer;
    if (!r) return;
    r.setSelection(s.selection);
    r.setOverlay(s.overlay);
    if (s.buildMode && s.hoverTile) {
      const check = canPlaceBuilding(this.state, s.buildMode, s.hoverTile.x, s.hoverTile.y);
      r.setPlacementGhost({ buildingType: s.buildMode, origin: { ...s.hoverTile }, ok: check.ok, tiles: check.tiles });
    } else {
      r.setPlacementGhost(null);
    }
  }

  // --- renderer → controller ---------------------------------------------------------------

  private handleHover(tile: TilePos | null): void {
    this.store.getState().setHoverTile(tile);
  }

  private handleTileClick(tile: TilePos, button: PointerButton): void {
    const ui = this.store.getState();
    if (ui.buildMode) {
      if (button === 'right') {
        ui.setBuildMode(null);
        return;
      }
      const result = this.dispatch({ type: 'placeBuilding', buildingType: ui.buildMode, x: tile.x, y: tile.y });
      if (result.ok) ui.setBuildMode(null);
      return;
    }
    ui.select(button === 'left' ? { kind: 'tile', x: tile.x, y: tile.y } : null);
  }

  private handleEntityClick(selection: { kind: 'settler' | 'building'; id: number }, button: PointerButton): void {
    const ui = this.store.getState();
    if (ui.buildMode) {
      // Clicking an entity while placing: treat as a click on the tile under it.
      const hover = ui.hoverTile;
      if (hover) this.handleTileClick(hover, button);
      return;
    }
    ui.select(button === 'left' ? selection : null);
  }

  // --- GameControllerApi -------------------------------------------------------------------

  getState(): Readonly<GameState> {
    return this.state;
  }

  newGame(options: NewGameOptions): void {
    this.replaceState(createGame(options));
  }

  dispatch(command: PlayerCommand): CommandResult {
    const result = applyCommand(this.state, command);
    if (result.ok) {
      this.handleEvents(result.events);
      this.snapshotDirty = true;
      this.publishSnapshot(performance.now());
      this.syncRendererWithStore(this.store.getState());
    } else {
      this.store.getState().pushToast(result.message, 'warning');
    }
    return result;
  }

  setSpeed(speed: GameSpeed): void {
    this.store.getState().setSpeed(speed);
  }

  setPaused(paused: boolean): void {
    this.store.getState().setPaused(paused);
  }

  togglePause(): void {
    this.store.getState().togglePause();
  }

  saveGame(slot: SaveSlotId): SaveResult {
    const result = saveToSlot(this.storage, slot, this.state);
    if (slot !== 'autosave') {
      this.store.getState().pushToast(result.ok ? 'Game saved.' : result.error, result.ok ? 'good' : 'danger');
    }
    return result;
  }

  loadGame(slot: SaveSlotId): LoadResult {
    const result = loadFromSlot(this.storage, slot);
    if (result.ok) {
      this.replaceState(result.state);
      this.store.getState().pushToast('Game loaded.', 'good');
    } else {
      this.store.getState().pushToast(result.error, 'danger');
    }
    return result;
  }

  listSaves(): SaveSlotInfo[] {
    return listSaveSlots(this.storage);
  }

  deleteSave(slot: SaveSlotId): void {
    deleteSlot(this.storage, slot);
  }

  centerOn(tile: TilePos | { x: number; y: number }, opts: { animate?: boolean } = {}): void {
    this.renderer?.centerOn(tile, { animate: opts.animate ?? true });
  }

  zoomBy(factor: number): void {
    this.renderer?.zoomBy(factor);
  }

  getCamera(): CameraState | null {
    return this.renderer?.getCamera() ?? null;
  }

  advanceTicks(n: number): void {
    try {
      for (let i = 0; i < n && !this.faulted && this.state.outcome.status !== 'lost'; i++) this.runTick();
      if (!this.renderer) this.pendingEvents = [];
      this.publishSnapshot(performance.now());
    } catch (err) {
      this.fault(err);
    }
  }

  /** True after an error halted the simulation (see `fault`). */
  isFaulted(): boolean {
    return this.faulted;
  }

  // --- internals ---------------------------------------------------------------------------

  private replaceState(state: GameState): void {
    this.state = state;
    this.faulted = false;
    this.accumulatorMs = 0;
    this.pendingEvents = [];
    const ui = this.store.getState();
    ui.select(null);
    ui.setBuildMode(null);
    ui.setPaused(state.outcome.status === 'lost' || (state.outcome.status === 'won' && !state.progress.victoryAcknowledged));
    this.renderer?.setWorld(state);
    this.publishSnapshot(performance.now());
  }

  private autosave(): void {
    // Before the player starts or loads a game the state is the main-menu demo world: never autosave it.
    const ui = this.store.getState();
    if (!ui.gameStarted || !ui.prefs.autosave || this.faulted || this.state.outcome.status === 'lost') return;
    const result = saveToSlot(this.storage, 'autosave', this.state);
    if (!result.ok) this.store.getState().pushToast(`Autosave failed: ${result.error}`, 'warning');
  }
}

/** Toast text for notable sim events (null = no toast). */
function toastFor(e: SimEvent, state: GameState): { message: string; severity: 'info' | 'good' | 'warning' | 'danger' } | null {
  switch (e.type) {
    case 'buildingPlaced':
      return { message: `${BUILDING_DEFS[e.buildingType].name} placed. Settlers will start building.`, severity: 'info' };
    case 'buildingCompleted':
      return { message: `${BUILDING_DEFS[e.buildingType].name} completed.`, severity: 'good' };
    case 'settlerBorn':
    case 'settlerArrived': {
      const s = getSettler(state, e.settlerId);
      return { message: `${s?.name ?? 'A settler'} joined the colony.`, severity: 'good' };
    }
    case 'settlerDied':
      return { message: `${e.name} died (${e.cause}).`, severity: 'danger' };
    case 'settlerLeft':
      return { message: `${e.name} left the colony (${e.reason}).`, severity: 'warning' };
    case 'decisionPending':
      return { message: e.message, severity: 'info' };
    case 'objectiveCompleted':
      return { message: e.message, severity: 'good' };
    case 'buildingUnlocked':
      return { message: `${BUILDING_DEFS[e.buildingType].name} unlocked.`, severity: 'good' };
    case 'randomEvent':
      return { message: e.message, severity: e.severity };
    case 'weatherChanged':
      return e.to === 'storm' || e.to === 'snow' ? { message: `Weather: ${e.to}.`, severity: 'warning' } : null;
    case 'gameOver':
      return { message: e.reason, severity: e.status === 'won' ? 'good' : 'danger' };
    default:
      return null;
  }
}
