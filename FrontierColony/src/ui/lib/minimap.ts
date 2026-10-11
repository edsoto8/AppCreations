/** Minimap maths and colours. Pure so it can be tested without a canvas. */
import { Terrain, type TilePos } from '../../sim';
import { screenToTile } from '../../shared/iso';

/** RGB per terrain code (matches the look of the map: water blues, sand, grass, forest, rock). */
export const TERRAIN_RGB: Record<number, readonly [number, number, number]> = {
  [Terrain.DeepWater]: [34, 76, 118],
  [Terrain.ShallowWater]: [66, 130, 168],
  [Terrain.Sand]: [208, 190, 138],
  [Terrain.Grass]: [118, 160, 82],
  [Terrain.Forest]: [58, 106, 58],
  [Terrain.Hills]: [138, 126, 104],
  [Terrain.Mountain]: [190, 192, 196],
};

const UNKNOWN_RGB = [30, 24, 18] as const;

/** One RGBA pixel per tile for a `width` x `height` map. */
export function terrainPixels(terrain: readonly number[], elevation: readonly number[], maxElevation: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(terrain.length * 4);
  for (let i = 0; i < terrain.length; i++) {
    const rgb = TERRAIN_RGB[terrain[i] ?? -1] ?? UNKNOWN_RGB;
    // A little shading by height so ridges read.
    const shade = 0.88 + 0.2 * ((elevation[i] ?? 0) / Math.max(1, maxElevation));
    out[i * 4] = Math.min(255, rgb[0] * shade);
    out[i * 4 + 1] = Math.min(255, rgb[1] * shade);
    out[i * 4 + 2] = Math.min(255, rgb[2] * shade);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Minimap pixel position of a tile coordinate (continuous), for a map of `mapSize` drawn at `size` pixels. */
export function tileToMinimap(x: number, y: number, mapSize: number, size: number): { x: number; y: number } {
  return { x: (x / mapSize) * size, y: (y / mapSize) * size };
}

/** Tile under a point of the minimap, clamped to the map. `px`/`py` are in minimap pixels. */
export function minimapToTile(px: number, py: number, mapSize: number, size: number): TilePos {
  const clamp = (v: number) => Math.max(0, Math.min(mapSize - 1, Math.floor((v / size) * mapSize)));
  return { x: clamp(px), y: clamp(py) };
}

export interface CameraLike {
  centerX: number;
  centerY: number;
  zoom: number;
}

/**
 * The four corners (tile coordinates, continuous) of the part of the world the camera shows.
 * The screen is a rectangle in iso screen space, which is a rotated quad on the map.
 */
export function viewportCorners(camera: CameraLike, viewW: number, viewH: number): { x: number; y: number }[] {
  const hw = viewW / 2 / camera.zoom;
  const hh = viewH / 2 / camera.zoom;
  return [
    [camera.centerX - hw, camera.centerY - hh],
    [camera.centerX + hw, camera.centerY - hh],
    [camera.centerX + hw, camera.centerY + hh],
    [camera.centerX - hw, camera.centerY + hh],
  ].map(([sx, sy]) => {
    const t = screenToTile(sx!, sy!, 0);
    return { x: t.x, y: t.y };
  });
}
