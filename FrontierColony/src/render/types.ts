/**
 * Renderer contract. The renderer reads GameState (never mutates it), draws it with PixiJS v8,
 * and reports pointer interaction through callbacks. It knows nothing about React or the store.
 */
import type { EntityId, GameState, SimEvent, TilePos } from '../sim';
import type { OverlayMode, PlacementGhost, Selection } from '../shared/types';

/** Per-frame information from the game loop. */
export interface FrameInfo {
  /** 0..1 progress between the last sim tick and the next; lerp prevPos→pos with it. */
  alpha: number;
  /** Real milliseconds since the previous frame (for animations; already clamped). */
  frameMs: number;
  /** performance.now() of this frame (monotonic, for animation phases). */
  nowMs: number;
  /** Current speed multiplier; 0 while paused (animations may slow/stop accordingly). */
  speed: number;
  /** Sim events produced by ticks run since the previous frame (particles, effects). */
  events: readonly SimEvent[];
}

export type PointerButton = 'left' | 'right';

/**
 * Callbacks into the game controller. For one click the renderer calls exactly one of
 * onSettlerClick / onBuildingClick / onTileClick, using hit priority settler > building > tile.
 * Drags (camera pans) do not produce clicks.
 */
export interface RendererCallbacks {
  /** Tile under the pointer changed (null when off-map or pointer left the canvas). */
  onTileHover(tile: TilePos | null): void;
  onTileClick(tile: TilePos, button: PointerButton): void;
  onSettlerClick(id: EntityId, button: PointerButton): void;
  onBuildingClick(id: EntityId, button: PointerButton): void;
}

export interface CameraState {
  /** World-container point (iso screen pixels) at the centre of the view. */
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface GameRenderer {
  /**
   * Called once when a game is started or loaded (and whenever the state object is replaced).
   * Builds terrain caches; must be called before the first `render` of that state.
   */
  setWorld(state: Readonly<GameState>): void;
  /** Draw one frame. Must be cheap: called at display refresh rate. */
  render(state: Readonly<GameState>, frame: FrameInfo): void;
  setPlacementGhost(ghost: PlacementGhost | null): void;
  setSelection(selection: Selection | null): void;
  setOverlay(overlay: OverlayMode): void;
  /** Move the camera so the world point (tile units) is centred. */
  centerOn(tile: TilePos | { x: number; y: number }, opts?: { animate?: boolean }): void;
  /** Multiply zoom by factor (clamped to the renderer's limits), anchored at the view centre. */
  zoomBy(factor: number): void;
  getCamera(): CameraState;
  /** Release GPU resources and remove the canvas from the host. Idempotent. */
  destroy(): void;
}

/** Factory signature; the canvas fills `host` and follows its size. */
export type CreateRenderer = (host: HTMLElement, callbacks: RendererCallbacks) => Promise<GameRenderer>;
