import type { SimSpeed } from '../sim/core/clock';
import type { FloorType, DirtKind, FurnitureKind, HouseLayout, ObstacleKind } from '../sim/world/types';
import { FURNITURE_CATALOG, OBSTACLE_CATALOG } from '../sim/world/furnitureCatalog';
import type { Command, CommandResult } from '../sim/mission/types';
import type { SuctionLevel, WaterLevel } from '../sim/config';
import { Simulation } from '../sim/Simulation';
import { buildTelemetry } from '../sim/telemetry';
import { getPreset } from '../sim/world/presets';
import { WorldView } from '../render/WorldView';
import { useStore, type RoomInfo, type UiState } from './store';
import type { AppApi, PresetId } from './types';

let uid = 1;

/**
 * Owns the Simulation and the WorldView (Three.js), runs the single animation loop, publishes
 * throttled telemetry into the store and applies UI state to the renderer. One instance per page.
 */
export class AppController implements AppApi {
  sim: Simulation;
  readonly view: WorldView;
  private raf = 0;
  private last = 0;
  private telemetryTimer = 0;
  private perfTimer = 0;
  private frames = 0;
  private unsubStore: () => void;
  private unsubSim: Array<() => void> = [];
  private disposed = false;
  private manual = { forward: 0, turn: 0, vacuum: false };

  constructor(container: HTMLElement) {
    const s = useStore.getState();
    this.sim = this.createSim(s.preset, s.seed);
    this.view = new WorldView(container, this, useStore.getState());
    this.view.setSimulation(this.sim);
    this.publishLayout();
    this.unsubStore = useStore.subscribe((state, prev) => this.onStore(state, prev));
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private createSim(preset: PresetId, seed: number): Simulation {
    const sim = new Simulation(getPreset(preset), { seed });
    sim.clock.speed = useStore.getState().speed;
    this.unsubSim.forEach((u) => u());
    this.unsubSim = [
      sim.events.on('log', (e) => {
        if (e.level === 'warn' || e.level === 'error' || e.level === 'success') useStore.getState().notify(e.message, e.level);
      }),
      sim.events.on('layout', () => this.publishLayout()),
    ];
    return sim;
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const steps = this.sim.advance(dt);
    this.view.frame(dt, steps);
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.125) {
      this.telemetryTimer = 0;
      this.publishTelemetry();
    }
    this.frames++;
    this.perfTimer += dt;
    if (this.perfTimer >= 0.5) {
      const fps = this.frames / this.perfTimer;
      this.frames = 0;
      this.perfTimer = 0;
      useStore.setState({ perf: this.view.perfStats(fps, this.sim.stepMs, steps) });
    }
  };

  private publishTelemetry(): void {
    const sim = this.sim;
    const st = useStore.getState();
    const patch: Partial<UiState> = { telemetry: buildTelemetry(sim) };
    if (st.logs.length === 0 || st.logs[st.logs.length - 1] !== sim.logs[sim.logs.length - 1]) patch.logs = sim.logs.slice(-120);
    useStore.setState(patch);
  }

  private publishLayout(): void {
    const l = this.sim.layout;
    const rooms: RoomInfo[] = l.rooms.map((r) => {
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (const q of r.rects) {
        const a = q.w * q.h;
        area += a;
        cx += (q.x + q.w / 2) * a;
        cy += (q.y + q.h / 2) * a;
      }
      return { id: r.id, name: r.name, floor: r.floor, area, cx: cx / area, cy: cy / area };
    });
    useStore.setState((s) => ({ rooms, layoutName: l.name, layoutVersion: s.layoutVersion + 1 }));
    this.view?.syncLayout(l);
  }

  private onStore(s: UiState, p: UiState): void {
    if (s.speed !== p.speed) this.sim.clock.speed = s.speed;
    this.view.applyUi(s, p);
  }

  // ------------------------------------------------------------------ AppApi

  command(c: Command): CommandResult {
    const r = this.sim.command(c);
    if (!r.ok && r.reason) useStore.getState().notify(r.reason, 'warn');
    if (r.ok && c.type === 'manual') this.manual = { forward: 0, turn: 0, vacuum: false };
    return r;
  }

  startMission(): CommandResult {
    const d = useStore.getState().draft;
    return this.command({
      type: 'start',
      settings: { kind: d.kind, cleanMode: d.cleanMode, suction: d.suction, water: d.water, passes: d.passes, rooms: d.rooms, spot: d.spot ?? undefined },
    });
  }

  setSpeed(s: SimSpeed): void {
    useStore.setState({ speed: s });
  }

  setSuction(s: SuctionLevel): void {
    this.sim.ctrl.suction = s;
    useStore.getState().setDraft({ suction: s });
  }

  setWater(w: WaterLevel): void {
    this.sim.ctrl.water = w;
    useStore.getState().setDraft({ water: w });
  }

  reset(preset?: PresetId, seed?: number): void {
    const st = useStore.getState();
    const p = preset ?? st.preset;
    const sd = seed ?? st.seed;
    this.sim.dispose();
    this.sim = this.createSim(p, sd);
    useStore.setState({ preset: p, seed: sd, selection: null, inspected: null, logs: [], telemetry: null });
    useStore.getState().setDraft({ rooms: [], spot: null });
    this.view.setSimulation(this.sim);
    this.publishLayout();
    this.publishTelemetry();
  }

  setManualInput(forward: number, turn: number, vacuum: boolean): void {
    this.manual = { forward, turn, vacuum };
    this.sim.ctrl.manual = { ...this.manual };
  }

  setFloorType(roomId: string, floor: FloorType): void {
    this.sim.editLayout((l) => {
      const r = l.rooms.find((x) => x.id === roomId);
      if (r) r.floor = floor;
    });
  }

  removeSelected(): void {
    const sel = useStore.getState().selection;
    if (!sel) return;
    this.sim.editLayout((l) => {
      if (sel.kind === 'furniture') l.furniture = l.furniture.filter((f) => f.id !== sel.id);
      if (sel.kind === 'obstacle') l.obstacles = l.obstacles.filter((f) => f.id !== sel.id);
      if (sel.kind === 'zone') l.zones = l.zones.filter((z) => z.id !== sel.id);
    });
    useStore.setState({ selection: null });
  }

  rotateSelected(delta: number): void {
    const sel = useStore.getState().selection;
    if (!sel || sel.kind === 'zone') return;
    this.sim.editLayout((l) => {
      const list: Array<{ id: string; rotation: number }> = sel.kind === 'furniture' ? l.furniture : l.obstacles;
      const it = list.find((x) => x.id === sel.id);
      if (it) it.rotation += delta;
    });
  }

  /** Move an item (editor drag end). */
  moveItem(kind: 'furniture' | 'obstacle', id: string, x: number, y: number): void {
    this.sim.editLayout((l) => {
      const list: Array<{ id: string; x: number; y: number }> = kind === 'furniture' ? l.furniture : l.obstacles;
      const it = list.find((q) => q.id === id);
      if (it) {
        it.x = x;
        it.y = y;
      }
    });
  }

  addZone(kind: 'noGo' | 'noMop', rect: { x: number; y: number; w: number; h: number }): void {
    if (rect.w < 0.15 || rect.h < 0.15) return;
    this.sim.editLayout((l) => l.zones.push({ id: `zone-${uid++}`, kind, rect }));
    this.sim.log('info', `${kind === 'noGo' ? 'No-go' : 'No-mop'} zone added (${rect.w.toFixed(1)} × ${rect.h.toFixed(1)} m)`);
  }

  clearMap(): void {
    this.sim.clearMap();
  }

  setBattery(soc: number): void {
    this.sim.res.soc = soc;
    this.sim.log('info', `Battery set to ${Math.round(soc * 100)}% (demo control)`);
  }

  dockService(action: 'refill' | 'emptyDirty' | 'replaceBag'): void {
    const d = this.sim.dock;
    if (action === 'refill') d.refillCleanTank();
    if (action === 'emptyDirty') d.emptyDirtyTank();
    if (action === 'replaceBag') d.replaceDustBag();
    this.sim.log('info', { refill: 'Dock clean tank refilled', emptyDirty: 'Dock dirty tank emptied', replaceBag: 'Dust bag replaced' }[action]);
  }

  spill(kind: DirtKind, x: number, y: number): void {
    this.sim.spill(kind, x, y);
    this.view.refreshDebris();
  }

  addObstacleAt(kind: ObstacleKind, x: number, y: number): void {
    const spec = OBSTACLE_CATALOG[kind];
    const id = `obs-${kind}-${uid++}`;
    this.sim.editLayout((l: HouseLayout) => l.obstacles.push({ id, kind, x, y, rotation: 0, ...spec.defaults }));
    this.sim.log('info', `Placed ${spec.label.toLowerCase()} at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  addFurnitureAt(kind: FurnitureKind, x: number, y: number): void {
    const spec = FURNITURE_CATALOG[kind];
    const id = `user-${kind}-${uid++}`;
    this.sim.editLayout((l: HouseLayout) => l.furniture.push({ id, kind, x, y, rotation: 0, ...spec.defaults }));
    this.sim.log('info', `Placed ${spec.label.toLowerCase()}`);
  }

  dropObstacleOnPath(): void {
    const b = this.sim.body;
    const path = this.sim.nav.remainingPath(b.x, b.y);
    let p = { x: b.x + Math.cos(b.theta) * 0.8, y: b.y + Math.sin(b.theta) * 0.8 };
    let acc = 0;
    for (let k = 1; k < path.length; k++) {
      acc += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y);
      if (acc >= 0.8) {
        p = path[k];
        break;
      }
    }
    const kinds: ObstacleKind[] = ['box', 'toy', 'shoe', 'cylinder'];
    this.addObstacleAt(kinds[uid % kinds.length], p.x, p.y);
  }

  focus(x: number, y: number): void {
    this.view.focus(x, y);
  }

  screenshot(): string {
    return this.view.screenshot();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubStore();
    this.unsubSim.forEach((u) => u());
    this.sim.dispose();
    this.view.dispose();
  }
}
