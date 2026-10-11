/**
 * Turns one 16×16 block of tiles into sprites. Flat (sea-level) tiles go into the chunk's ground
 * container; anything raised, plus every tall object, goes into the shared depth-sorted layer so
 * settlers and buildings can walk in front of / behind it correctly.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { Terrain } from '../../sim';
import { ELEVATION_STEP, tileToScreen } from '../../shared/iso';
import type { TextureSet } from '../textures';
import type { EdgeDir } from '../textures/groundTiles';
import type { CliffMaterial } from '../textures/cliffs';
import { clamp, fbm, hash01, hash32, smoothstep } from '../util/noise';
import { mixRgb, toHex, type RGB } from '../util/color';
import { WATER_DEEP, WATER_MID, WATER_SHALLOW, WATER_SHORE } from '../textures/palette';
import type { DepthLayer } from '../depthLayer';
import { CHUNK_SIZE, isWaterTerrain, type TerrainModel } from './model';

export interface ShimmerFx {
  sprite: Sprite;
  baseX: number;
  baseY: number;
  phase: number;
  speed: number;
}

export interface FoamFx {
  sprite: Sprite;
  baseX: number;
  baseY: number;
  dx: number;
  dy: number;
  phase: number;
}

export interface Chunk {
  cx: number;
  cy: number;
  index: number;
  ground: Container;
  fx: Container;
  sorted: Sprite[];
  shimmers: ShimmerFx[];
  foams: FoamFx[];
  built: boolean;
  dirty: boolean;
  shown: boolean;
  lastShownFrame: number;
  /** World-pixel bounds (generous), valid after the chunk is built. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function createChunk(cx: number, cy: number, index: number): Chunk {
  const ground = new Container({ isRenderGroup: true });
  const fx = new Container({ isRenderGroup: true });
  return {
    cx,
    cy,
    index,
    ground,
    fx,
    sorted: [],
    shimmers: [],
    foams: [],
    built: false,
    dirty: true,
    shown: false,
    lastShownFrame: 0,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
  };
}

export function clearChunk(chunk: Chunk): void {
  for (const s of chunk.ground.removeChildren()) s.destroy();
  for (const s of chunk.fx.removeChildren()) s.destroy();
  for (const s of chunk.sorted) {
    s.parent?.removeChild(s);
    s.destroy();
  }
  chunk.sorted.length = 0;
  chunk.shimmers.length = 0;
  chunk.foams.length = 0;
  chunk.built = false;
}

const EDGE_NEIGHBOUR: Record<EdgeDir, [number, number]> = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };

const RANK: Record<number, number> = {
  [Terrain.Sand]: 1,
  [Terrain.Grass]: 2,
  [Terrain.Forest]: 3,
  [Terrain.Hills]: 4,
  [Terrain.Mountain]: 5,
};
const FRINGE_MATERIAL: Record<number, 'sand' | 'grass' | 'forest' | 'hills' | 'rock'> = {
  [Terrain.Sand]: 'sand',
  [Terrain.Grass]: 'grass',
  [Terrain.Forest]: 'forest',
  [Terrain.Hills]: 'hills',
  [Terrain.Mountain]: 'rock',
};

function pick<T>(arr: readonly T[], h: number): T {
  return arr[h % arr.length]!;
}

function tint(r: number, g: number, b: number): number {
  return (clamp(Math.round(r * 255), 0, 255) << 16) | (clamp(Math.round(g * 255), 0, 255) << 8) | clamp(Math.round(b * 255), 0, 255);
}

/** Subtle large-scale brightness/hue variation so the land never looks like a flat repeat. */
export function landTint(x: number, y: number, e: number, terrain: number): number {
  const n = fbm(x * 0.085 + 11, y * 0.085 + 5, 5, 3);
  const m = fbm(x * 0.21 + 3, y * 0.21 + 9, 8, 2);
  const lift = Math.min(e, 4) * 0.032;
  const base = 0.84 + lift + n * 0.115 + (m - 0.5) * 0.03;
  let r = base;
  let g = base;
  let b = base;
  if (terrain === Terrain.Grass) {
    // patches drift between lush and slightly dry
    const dry = smoothstep(0.55, 0.8, fbm(x * 0.05 + 40, y * 0.05 + 2, 21, 2));
    r *= 1 + dry * 0.02;
    g *= 1 - dry * 0.03;
    b *= 1 - dry * 0.09;
  } else if (terrain === Terrain.Sand) {
    b *= 0.985;
  }
  return tint(Math.min(1, r), Math.min(1, g), Math.min(1, b));
}

const WATER_STOPS: { at: number; c: RGB }[] = [
  { at: 0, c: WATER_SHORE },
  { at: 0.2, c: WATER_SHALLOW },
  { at: 0.55, c: WATER_MID },
  { at: 1, c: WATER_DEEP },
];

export function waterTint(x: number, y: number, terrain: number, shore: number): number {
  let f = clamp((shore - 0.6) / 9, 0, 1);
  if (terrain === Terrain.DeepWater) f = Math.max(f, 0.5);
  else f = Math.min(f, 0.45);
  f += (fbm(x * 0.1 + 2, y * 0.1 + 8, 77, 3) - 0.5) * 0.08;
  f = clamp(f, 0, 1);
  let c: RGB = WATER_STOPS[0]!.c;
  for (let i = 1; i < WATER_STOPS.length; i++) {
    const a = WATER_STOPS[i - 1]!;
    const b = WATER_STOPS[i]!;
    if (f <= b.at) {
      c = mixRgb(a.c, b.c, (f - a.at) / (b.at - a.at));
      break;
    }
    c = b.c;
  }
  return toHex(c);
}

interface Ctx {
  model: TerrainModel;
  tex: TextureSet;
  chunk: Chunk;
  maxElev: number;
  hasMountain: boolean;
  hasForest: boolean;
}

function cliffMaterial(terrain: number): CliffMaterial {
  if (terrain === Terrain.Sand) return 'sand';
  if (terrain === Terrain.Hills || terrain === Terrain.Mountain) return 'rock';
  return 'soil';
}

/** Build all sprites for a chunk (the chunk must have been cleared). */
export function buildChunk(chunk: Chunk, model: TerrainModel, tex: TextureSet, depth: DepthLayer): void {
  const ctx: Ctx = { model, tex, chunk, maxElev: 0, hasMountain: false, hasForest: false };
  const x0 = chunk.cx * CHUNK_SIZE;
  const y0 = chunk.cy * CHUNK_SIZE;
  const x1 = Math.min(model.width, x0 + CHUNK_SIZE);
  const y1 = Math.min(model.height, y0 + CHUNK_SIZE);

  const sorted: Sprite[] = [];
  const groundTops: Sprite[] = [];
  const groundOver: Sprite[] = [];
  const groundUnder: Sprite[] = [];

  /** Create a sprite that lives either in the ground container or the sorted layer. */
  const add = (texture: Texture, px: number, py: number, raised: boolean, z: number, pass: 'under' | 'top' | 'over', tintColor = 0xffffff, flip = false): Sprite => {
    const s = new Sprite(texture);
    s.position.set(px, py);
    if (tintColor !== 0xffffff) s.tint = tintColor;
    if (flip) s.scale.x = -1;
    if (raised) {
      s.zIndex = z;
      sorted.push(s);
    } else if (pass === 'top') groundTops.push(s);
    else if (pass === 'under') groundUnder.push(s);
    else groundOver.push(s);
    return s;
  };
  /** An upright object (always depth sorted). */
  const addObject = (texture: Texture, px: number, py: number, z: number, flip = false): Sprite => {
    const s = new Sprite(texture);
    s.position.set(px, py);
    if (flip) s.scale.x = -1;
    s.zIndex = z;
    sorted.push(s);
    return s;
  };

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = model.index(x, y);
      const t = model.terrain[i]!;
      const e = model.elev[i]!;
      const lvl = model.level[i]!;
      const h = hash32(x, y, 17);
      const raised = e >= 1;
      const d = x + y;
      const c = tileToScreen(x + 0.5, y + 0.5, e);
      const water = isWaterTerrain(t);
      if (e > ctx.maxElev) ctx.maxElev = e;

      // ---- cliffs / map-edge slab -------------------------------------------------------------
      const mat = cliffMaterial(t);
      const faces: { dx: number; dy: number; right: boolean }[] = [
        { dx: 0, dy: 1, right: false },
        { dx: 1, dy: 0, right: true },
      ];
      for (const f of faces) {
        const nx = x + f.dx;
        const ny = y + f.dy;
        const oob = !model.inBounds(nx, ny);
        const ne = oob ? -1 : model.elev[model.index(nx, ny)]!;
        const levels = e - ne; // oob: e + 1 (a slab of soil under the map edge)
        if (levels <= 0) continue;
        const top = tileToScreen(f.right ? x + 1 : x, f.right ? y : y + 1, e);
        const set = tex.cliffs[water ? 'soil' : mat];
        const shade = f.right ? 0xb9b4b2 : 0xffffff;
        const waterSide = water ? (f.right ? 0x4a7aa0 : 0x6a9cbf) : shade;
        for (let k = 0; k < levels; k++) {
          const lip = k === 0 && t !== Terrain.Mountain && !water;
          const arr = lip ? set.lip : set.mid;
          const tx = arr[(h + k * 7 + (f.right ? 3 : 0)) % arr.length]!;
          const s = new Sprite(tx);
          s.position.set(top.x, top.y + k * ELEVATION_STEP);
          if (f.right) s.scale.x = -1;
          s.tint = k === levels - 1 && levels > 1 ? (water ? waterSide : f.right ? 0xa09c9a : 0xe6e6e6) : water ? waterSide : shade;
          if (raised) {
            s.zIndex = d + 0.49;
            sorted.push(s);
          } else groundUnder.push(s);
        }
      }

      // ---- tile top ---------------------------------------------------------------------------
      let topTex: Texture;
      let topTint: number;
      switch (t) {
        case Terrain.DeepWater:
        case Terrain.ShallowWater:
          topTex = pick(tex.water, h >>> 3);
          topTint = waterTint(x, y, t, model.shoreSmooth[i]!);
          break;
        case Terrain.Sand:
          topTex = (h & 7) === 0 ? pick(tex.sandPebbles, h >>> 4) : pick(tex.sandPlain, h >>> 4);
          topTint = landTint(x, y, e, t);
          break;
        case Terrain.Forest:
          topTex = pick(tex.forestFloor, h >>> 4);
          topTint = landTint(x, y, e, t);
          ctx.hasForest = true;
          break;
        case Terrain.Hills:
          topTex = pick(tex.hills, h >>> 4);
          topTint = landTint(x, y, e, t);
          break;
        case Terrain.Mountain:
          topTex = pick(tex.rockGround, h >>> 4);
          topTint = landTint(x, y, e, t);
          ctx.hasMountain = true;
          break;
        default: {
          const r = (h >>> 5) & 15;
          topTex = r < 9 ? pick(tex.grassPlain, h >>> 9) : r < 13 ? pick(tex.grassTuft, h >>> 9) : pick(tex.grassFlower, h >>> 9);
          topTint = landTint(x, y, e, t);
        }
      }
      add(topTex, c.x, c.y, raised, d + 0.5, 'top', topTint, ((h >>> 12) & 1) === 1);

      // ---- overlays: fringes, wet banks, foam ------------------------------------------------
      for (const dir of ['ne', 'se', 'sw', 'nw'] as EdgeDir[]) {
        const [ox, oy] = EDGE_NEIGHBOUR[dir];
        const nx = x + ox;
        const ny = y + oy;
        if (!model.inBounds(nx, ny)) continue;
        const ni = model.index(nx, ny);
        const nt = model.terrain[ni]!;
        const nWater = isWaterTerrain(nt);
        if (water) {
          if (!nWater && model.elev[ni] === 0) {
            const foam = new Sprite(tex.foam[dir]);
            foam.position.set(c.x, c.y);
            chunk.fx.addChild(foam);
            const dirVec = { ne: [-0.89, 0.45], se: [-0.89, -0.45], sw: [0.89, -0.45], nw: [0.89, 0.45] }[dir];
            chunk.foams.push({ sprite: foam, baseX: c.x, baseY: c.y, dx: dirVec[0]!, dy: dirVec[1]!, phase: hash01(x, y, 91 + ox * 3 + oy) * 6.28 });
          }
          continue;
        }
        if (nWater) {
          if (e === 0) add(tex.wet[dir], c.x, c.y, raised, d + 0.51, 'over');
          continue;
        }
        if (model.elev[ni] !== e) continue;
        const rn = RANK[nt] ?? 0;
        const rt = RANK[t] ?? 0;
        if (rn > rt) add(tex.fringe[FRINGE_MATERIAL[nt]!][dir], c.x, c.y, raised, d + 0.51, 'over');
      }

      // ---- decals & objects -------------------------------------------------------------------
      const hd = hash01(x, y, 29);
      const ox = (hash01(x, y, 31) - 0.5) * 30;
      const oy = (hash01(x, y, 37) - 0.5) * 12;
      switch (t) {
        case Terrain.Grass: {
          if (model.stump[i]) addObject(tex.stump, c.x + ox * 0.3, c.y + oy * 0.4, d + 0.99);
          else if (hd < 0.045) addObject(pick(tex.bush, h >>> 7), c.x + ox, c.y + oy, d + 1 + oy * 0.001);
          else if (hd < 0.11) add(pick(tex.flowerPatch, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
          else if (hd < 0.2) add(pick(tex.tuft, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
          break;
        }
        case Terrain.Sand: {
          if (hd < 0.07) add(pick(tex.shell, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
          else if (hd < 0.14) add(pick(tex.pebbles, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
          break;
        }
        case Terrain.Forest: {
          if (lvl > 0) {
            const sp = model.species(x, y);
            const arr = sp === 0 ? tex.trees.oak : sp === 1 ? tex.trees.pine : tex.trees.birch;
            addObject(arr[lvl - 1]![(h >>> 6) % arr[0]!.length]!, c.x, c.y, d + 1, ((h >>> 13) & 1) === 1);
          } else {
            addObject(tex.stump, c.x - 6, c.y + 1, d + 0.99);
            addObject(tex.stump, c.x + 8, c.y - 2, d + 0.99);
          }
          break;
        }
        case Terrain.Hills: {
          if (lvl > 0) addObject(tex.rocks[lvl - 1]![(h >>> 6) % tex.rocks[0]!.length]!, c.x, c.y, d + 1, ((h >>> 13) & 1) === 1);
          else addObject(pick(tex.rubble, h >>> 6), c.x, c.y, d + 1);
          break;
        }
        case Terrain.Mountain: {
          if (lvl > 0) {
            const snow = e >= 6 ? 2 : e >= 5 ? 1 : 0;
            const v = (h >>> 6) % tex.mountains[snow]!.length;
            addObject(tex.mountains[snow]![v]![(h >>> 14) & 1]!, c.x, c.y + 4, d + 1);
          } else addObject(pick(tex.quarried, h >>> 6), c.x, c.y + 4, d + 1);
          break;
        }
        case Terrain.ShallowWater:
        case Terrain.DeepWater: {
          const sh = model.shore[i]!;
          if (hd < 0.38) {
            const s = new Sprite(tex.sparkle);
            const sx = c.x + (hash01(x, y, 53) - 0.5) * 36;
            const sy = c.y + (hash01(x, y, 59) - 0.5) * 14;
            s.position.set(sx, sy);
            s.alpha = 0;
            chunk.fx.addChild(s);
            chunk.shimmers.push({ sprite: s, baseX: sx, baseY: sy, phase: hash01(x, y, 61) * 6.28, speed: 0.7 + hash01(x, y, 67) * 1.1 });
          }
          if (t === Terrain.ShallowWater && sh >= 1 && sh <= 2 && hd > 0.9) {
            const l = new Sprite(pick(tex.lily, h >>> 7));
            l.position.set(c.x + ox * 0.6, c.y + oy * 0.5);
            groundOver.push(l);
          }
          break;
        }
      }
      // reeds where land meets water
      if (!water && e === 0 && (t === Terrain.Grass || t === Terrain.Sand) && hd > 0.55 && hd < 0.8) {
        for (const dir of ['ne', 'se', 'sw', 'nw'] as EdgeDir[]) {
          const [rx, ry] = EDGE_NEIGHBOUR[dir];
          const nx = x + rx;
          const ny = y + ry;
          if (model.inBounds(nx, ny) && isWaterTerrain(model.terrain[model.index(nx, ny)]!)) {
            const dirVec = { ne: [12, -6], se: [12, 6], sw: [-12, 6], nw: [-12, -6] }[dir];
            addObject(pick(tex.reeds, h >>> 8), c.x + dirVec[0]! * 0.85 + ox * 0.15, c.y + dirVec[1]! * 0.85, d + 1 + (dirVec[1]! > 0 ? 0.3 : -0.3));
            break;
          }
        }
      }
    }
  }

  for (const s of groundUnder) chunk.ground.addChild(s);
  for (const s of groundTops) chunk.ground.addChild(s);
  for (const s of groundOver) chunk.ground.addChild(s);
  chunk.sorted = sorted;

  // bounds in world pixels (generous: tall objects, cliffs, map-edge slabs)
  const tall = ctx.hasMountain ? 130 : ctx.hasForest ? 80 : 40;
  chunk.x0 = (x0 - y1) * 32 - 40;
  chunk.x1 = (x1 - y0) * 32 + 40;
  chunk.y0 = (x0 + y0) * 16 - ctx.maxElev * ELEVATION_STEP - tall;
  chunk.y1 = (x1 + y1) * 16 + 40;
  chunk.built = true;
  chunk.dirty = false;
  if (chunk.shown) for (const s of sorted) depth.place(s);
}
