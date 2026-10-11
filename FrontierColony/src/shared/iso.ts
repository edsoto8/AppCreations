/**
 * Isometric projection shared by the renderer, input handling and tests. Pure math, no Pixi.
 *
 * Conventions ("2:1 dimetric"):
 * - World space is tile units. Tile (tx, ty) covers [tx, tx+1) × [ty, ty+1).
 * - Screen space is pixels in the *world container* (before camera pan/zoom); +y is down.
 * - tileToScreen(x, y) maps the continuous world point (x, y) to screen. For an integer tile the
 *   diamond's vertices are: top = (tx, ty), right = (tx+1, ty), bottom = (tx+1, ty+1),
 *   left = (tx, ty+1). The tile centre (tx+0.5, ty+0.5) lands TILE_HEIGHT/2 below the top vertex.
 * - +x runs to screen right-down, +y to screen left-down. Tile (0,0) is the top of the map.
 * - Elevation lifts a point by ELEVATION_STEP pixels per level (screen y decreases).
 * - Draw order: larger depth draws later (in front). See `isoDepth`.
 */

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const HALF_TILE_WIDTH = TILE_WIDTH / 2;
export const HALF_TILE_HEIGHT = TILE_HEIGHT / 2;
/** Vertical pixels per elevation level. */
export const ELEVATION_STEP = 12;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** World (tile units, optional elevation level) → screen pixels. */
export function tileToScreen(x: number, y: number, elevation = 0): ScreenPoint {
  return {
    x: (x - y) * HALF_TILE_WIDTH,
    y: (x + y) * HALF_TILE_HEIGHT - elevation * ELEVATION_STEP,
  };
}

/** Screen position of the centre of integer tile (tx, ty). */
export function tileCenterToScreen(tx: number, ty: number, elevation = 0): ScreenPoint {
  return tileToScreen(tx + 0.5, ty + 0.5, elevation);
}

/**
 * Screen pixels → continuous world point, assuming the point lies on the plane at `elevation`.
 * Exact inverse of `tileToScreen` for the same elevation.
 */
export function screenToTile(sx: number, sy: number, elevation = 0): WorldPoint {
  const yy = (sy + elevation * ELEVATION_STEP) / HALF_TILE_HEIGHT; // = x + y
  const xx = sx / HALF_TILE_WIDTH; // = x - y
  return { x: (yy + xx) / 2, y: (yy - xx) / 2 };
}

/** Integer tile containing the screen point on the plane at `elevation`. */
export function screenToTileFloor(sx: number, sy: number, elevation = 0): { x: number; y: number } {
  const p = screenToTile(sx, sy, elevation);
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}

/**
 * Elevation-aware picking. Because raised tiles are drawn higher, the tile under the cursor is the
 * front-most tile whose raised top face contains the point. We test each elevation plane from the
 * highest down and return the first tile whose own elevation matches that plane.
 * Falls back to the ground-plane tile (which may be out of bounds; callers check bounds).
 *
 * @param getElevation elevation of an in-bounds tile, or null when (x, y) is outside the map.
 */
export function pickTile(
  sx: number,
  sy: number,
  maxElevation: number,
  getElevation: (x: number, y: number) => number | null,
): { x: number; y: number } {
  for (let e = maxElevation; e >= 0; e--) {
    const t = screenToTileFloor(sx, sy, e);
    if (getElevation(t.x, t.y) === e) return t;
  }
  return screenToTileFloor(sx, sy, 0);
}

/**
 * Painter's-algorithm sort key for an object standing at world point (x, y).
 * For a building, pass the footprint's far corner (origin + footprint) so it sorts after the
 * tiles and settlers behind it.
 */
export function isoDepth(x: number, y: number): number {
  return x + y;
}

/** Screen-space bounding box of a width × height map (elevation 0). Useful for camera limits. */
export function mapScreenBounds(width: number, height: number): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: tileToScreen(0, height).x,
    maxX: tileToScreen(width, 0).x,
    minY: tileToScreen(0, 0).y,
    maxY: tileToScreen(width, height).y,
  };
}
