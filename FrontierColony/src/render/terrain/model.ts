/**
 * Renderer-side view of the world's tile arrays: compact typed arrays holding exactly what the
 * chunk builder needs (visual elevation, tree/rock density levels, distance from the shore ...), plus
 * a cheap change detector so only the chunks whose tiles actually changed are rebuilt.
 */
import { Terrain, type WorldState } from '../../sim';
import { fbm } from '../util/noise';

export const CHUNK_SIZE = 16;

/** Wood on a fresh forest tile (docs/GAME_DESIGN.md); denser worlds just clamp to "dense". */
export const FOREST_REF_RESOURCE = 40;
export const HILLS_REF_RESOURCE = 60;
export const MOUNTAIN_REF_RESOURCE = 120;

export type TreeSpeciesId = 0 | 1 | 2; // oak, pine, birch

export function isWaterTerrain(t: number): boolean {
  return t === Terrain.DeepWater || t === Terrain.ShallowWater;
}

/** 0 = depleted, 1..5 = number of trees standing. */
export function treeLevel(resource: number, ref: number): number {
  if (resource <= 0) return 0;
  const r = resource / ref;
  return r > 0.8 ? 5 : r > 0.6 ? 4 : r > 0.4 ? 3 : r > 0.2 ? 2 : 1;
}

/** 0 = depleted, 1..4 boulders. */
export function rockLevel(resource: number, ref: number): number {
  if (resource <= 0) return 0;
  const r = resource / ref;
  return r > 0.7 ? 4 : r > 0.45 ? 3 : r > 0.2 ? 2 : 1;
}

export class TerrainModel {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  /** Visual elevation (water is always drawn at sea level). */
  readonly elev: Uint8Array;
  /** Forest: 0..5 trees; Hills: 0..4 boulders; Mountain: 1 intact / 0 quarried. */
  readonly level: Uint8Array;
  /** Tile was a forest that has been cut down (draw a stump). */
  readonly stump: Uint8Array;
  /** Water tiles: tiles to the nearest land (1 = touching land), capped at 12. Land = 0. */
  readonly shore: Uint8Array;
  /** Smoothed shore distance (for gradual depth colouring). */
  readonly shoreSmooth: Float32Array;
  readonly sig: Int32Array;
  forestRef = FOREST_REF_RESOURCE;
  revision = -1;

  constructor(world: Readonly<WorldState>) {
    const n = world.width * world.height;
    this.width = world.width;
    this.height = world.height;
    this.terrain = new Uint8Array(n);
    this.elev = new Uint8Array(n);
    this.level = new Uint8Array(n);
    this.stump = new Uint8Array(n);
    this.shore = new Uint8Array(n);
    this.shoreSmooth = new Float32Array(n);
    this.sig = new Int32Array(n).fill(-1);
    let maxForest = 0;
    for (let i = 0; i < n; i++) if (world.terrain[i] === Terrain.Forest) maxForest = Math.max(maxForest, world.resource[i] ?? 0);
    this.forestRef = Math.max(FOREST_REF_RESOURCE, maxForest);
    this.syncAll(world);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Visual elevation at a tile, clamped to the map. */
  elevAt(x: number, y: number): number {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return this.elev[cy * this.width + cx]!;
  }

  species(x: number, y: number): TreeSpeciesId {
    const n = fbm(x * 0.075 + 3.1, y * 0.075 + 7.7, 1337, 3) - this.elevAt(x, y) * 0.035;
    return n < 0.455 ? 0 : n < 0.53 ? 2 : 1;
  }

  private syncAll(world: Readonly<WorldState>): void {
    this.sync(world, () => {});
  }

  /**
   * Re-read the world; calls `onChange(index, structural)` for every tile whose rendering changed.
   * `structural` is true when terrain/elevation changed (neighbouring tiles' edges depend on it).
   */
  sync(world: Readonly<WorldState>, onChange: (index: number, structural: boolean, prevTerrain: number, prevLevel: number) => void): void {
    const n = this.width * this.height;
    let waterChanged = false;
    for (let i = 0; i < n; i++) if (this.updateTile(world, i, onChange)) waterChanged = true;
    if (waterChanged || this.revision === -1) this.computeShore();
    this.revision = world.revision;
  }

  /** Re-read a single tile (driven by `tileChanged` events, e.g. a tree felled). */
  syncTile(world: Readonly<WorldState>, x: number, y: number, onChange: (index: number, structural: boolean, prevTerrain: number, prevLevel: number) => void): void {
    if (!this.inBounds(x, y)) return;
    if (this.updateTile(world, y * this.width + x, onChange)) this.computeShore();
  }

  /** Returns true when the tile switched between water and land. */
  private updateTile(world: Readonly<WorldState>, i: number, onChange: (index: number, structural: boolean, prevTerrain: number, prevLevel: number) => void): boolean {
    const t = world.terrain[i] ?? Terrain.Grass;
    const water = isWaterTerrain(t);
    const e = water ? 0 : Math.max(0, Math.min(15, world.elevation[i] ?? 0));
    const res = world.resource[i] ?? 0;
    const lvl =
      t === Terrain.Forest
        ? treeLevel(res, this.forestRef)
        : t === Terrain.Hills
          ? rockLevel(res, HILLS_REF_RESOURCE)
          : t === Terrain.Mountain
            ? res > 0
              ? 1
              : 0
            : 0;
    const prevT = this.terrain[i]!;
    const prevLevel = this.level[i]!;
    let stump = this.stump[i]!;
    if (this.sig[i] !== -1) {
      if (prevT === Terrain.Forest && t === Terrain.Grass) stump = 1;
      else if (t !== Terrain.Grass) stump = 0;
    }
    const sig = t | (e << 3) | (lvl << 8) | (stump << 12);
    if (sig === this.sig[i]) return false;
    const prevSig = this.sig[i]!;
    const waterChanged = prevSig !== -1 && isWaterTerrain(prevT) !== water;
    this.terrain[i] = t;
    this.elev[i] = e;
    this.level[i] = lvl;
    this.stump[i] = stump;
    this.sig[i] = sig;
    onChange(i, prevSig === -1 || (prevSig & 0xff) !== (sig & 0xff), prevSig === -1 ? -1 : prevT, prevLevel);
    return waterChanged;
  }

  private computeShore(): void {
    const { width: w, height: h, terrain, shore } = this;
    const n = w * h;
    shore.fill(0);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const visited = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!isWaterTerrain(terrain[i]!)) {
        visited[i] = 1;
        queue[tail++] = i;
      }
    }
    // Multi-source BFS (8-neighbourhood) over water.
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % w;
      const y = (i - x) / w;
      const d = shore[i]!;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (visited[j]) continue;
          visited[j] = 1;
          shore[j] = Math.min(12, d + 1);
          queue[tail++] = j;
        }
      }
    }
    // No land at all: treat everything as open water.
    if (tail === 0) shore.fill(12);
    // two box-blur passes over water for smooth depth gradients
    let src = Float32Array.from(shore);
    const dst = this.shoreSmooth;
    for (let pass = 0; pass < 6; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!isWaterTerrain(terrain[i]!)) {
            dst[i] = 0;
            continue;
          }
          let sum = 0;
          let cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              sum += src[ny * w + nx]!;
              cnt++;
            }
          }
          dst[i] = sum / cnt;
        }
      }
      src = Float32Array.from(dst);
    }
  }
}

