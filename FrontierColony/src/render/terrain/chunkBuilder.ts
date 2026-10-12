/**
 * Turns one 16×16 block of tiles into sprites. Flat (sea-level) tiles go into the chunk's ground
 * container; anything raised, plus every tall object, goes into the shared depth-sorted layer so
 * settlers and buildings can walk in front of / behind it correctly.
 */
import { Container, type MeshSimple, Sprite, type RenderTexture, type Texture } from 'pixi.js';
import { Terrain } from '../../sim';
import { ELEVATION_STEP, tileToScreen } from '../../shared/iso';
import type { TextureSet } from '../textures';
import type { EdgeDir } from '../textures/groundTiles';
import type { CliffMaterial } from '../textures/cliffs';
import { clamp, fbm, hash01, hash32, smoothstep } from '../util/noise';
import { mixRgb, toHex, type RGB } from '../util/color';
import { WATER_DEEP, WATER_MID, WATER_SHALLOW, WATER_SHORE } from '../textures/palette';
import type { DepthLayer } from '../depthLayer';
import type { SeasonLook } from '../atmosphere/seasons';
import type { OccIndex } from './occluders';
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
  /** Flat-tile sprites. In baked mode this is a detached scratch container, in live mode it is on the stage. */
  ground: Container;
  /** Baked picture of the whole chunk (ground and objects) drawn through a skyline-shaped mesh. */
  bake: MeshSimple | null;
  rt: RenderTexture | null;
  /** Resolution the picture was baked at, and its world-pixel origin. */
  res: number;
  bx: number;
  by: number;
  /** Baked objects, for redrawing the ones that must stand in front of settlers and buildings. */
  records: OccIndex | null;
  mode: 'none' | 'baked' | 'live';
  fx: Container;
  sorted: Sprite[];
  shimmers: ShimmerFx[];
  foams: FoamFx[];
  built: boolean;
  dirty: boolean;
  /** Season look the chunk was built with. */
  lookKey: string;
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
    bake: null,
    rt: null,
    res: 0,
    bx: 0,
    by: 0,
    records: null,
    mode: 'none',
    fx,
    sorted: [],
    shimmers: [],
    foams: [],
    built: false,
    dirty: true,
    lookKey: '',
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

/** Pixi's Mesh.destroy leaves its geometry (and the GL buffers behind it) alive; free those too. */
export function destroyMesh(mesh: MeshSimple | null): void {
  if (!mesh) return;
  const geometry = mesh.geometry;
  mesh.destroy();
  geometry.destroy(true);
}

/** Free the baked image of a chunk too. */
export function destroyBake(chunk: Chunk): void {
  destroyMesh(chunk.bake);
  chunk.rt?.destroy(true);
  chunk.bake = null;
  chunk.rt = null;
  chunk.records = null;
  chunk.mode = 'none';
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
export function landTint(x: number, y: number, e: number, terrain: number, look: SeasonLook): number {
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
  if (terrain !== Terrain.Sand && terrain !== Terrain.Mountain) {
    r *= look.grass[0];
    g *= look.grass[1];
    b *= look.grass[2];
    if (look.dry > 0) {
      // drought: yellowed, patchy
      const patch = 0.6 + 0.4 * fbm(x * 0.12 + 7, y * 0.12 + 3, 55, 2);
      const k = look.dry * patch;
      r *= 1 + k * 0.1;
      g *= 1 - k * 0.1;
      b *= 1 - k * 0.42;
    }
  }
  return tint(Math.min(1, r), Math.min(1, g), Math.min(1, b));
}

const WATER_STOPS: { at: number; c: RGB }[] = [
  { at: 0, c: WATER_SHORE },
  { at: 0.2, c: WATER_SHALLOW },
  { at: 0.55, c: WATER_MID },
  { at: 1, c: WATER_DEEP },
];

const ICE: RGB = [206, 232, 244];

export function waterTint(x: number, y: number, terrain: number, shore: number, ice = 0): number {
  let f = clamp((shore - 0.6) / 9, 0, 1);
  if (terrain === Terrain.DeepWater) f = Math.max(f, 0.5);
  else f = Math.min(f, 0.45);
  f += (fbm(x * 0.1 + 2, y * 0.1 + 8, 77, 3) - 0.5) * 0.08 + (hash01(x, y, 77) - 0.5) * 0.035;
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
  if (ice > 0 && terrain === Terrain.ShallowWater) c = mixRgb(c, ICE, ice * 0.7 * (1 - smoothstep(0, 5, shore)));
  return toHex(c);
}

/** True when forest, hills or mountain tiles just south of (x, y) would stand over a sparkle drawn there. */
function tallSouth(model: TerrainModel, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 1], [0, 1], [1, 0], [2, 2], [1, 2], [2, 1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (!model.inBounds(nx, ny)) continue;
    const i = model.index(nx, ny);
    const t = model.terrain[i]!;
    if (t === Terrain.Forest || t === Terrain.Mountain || (t === Terrain.Hills && model.level[i]! > 0)) return true;
  }
  return false;
}

/** Texture and tint of the top face of tile (x, y). */
function tileTop(model: TerrainModel, tex: TextureSet, look: SeasonLook, x: number, y: number): { tex: Texture; tint: number; snowy: boolean } {
  const i = model.index(x, y);
  const t = model.terrain[i]!;
  const e = model.elev[i]!;
  const h = hash32(x, y, 17);
  const water = isWaterTerrain(t);
  let topTex: Texture;
  let topTint: number;
  const sea = tex.seasonal;
  const snowy = sea !== null && look.snow > 0 && !water && hash01(x, y, 401) < look.snow;
  switch (t) {
    case Terrain.DeepWater:
    case Terrain.ShallowWater:
      topTex = pick(tex.water, h >>> 3);
      topTint = waterTint(x, y, t, model.shoreSmooth[i]!, look.ice);
      break;
    case Terrain.Sand:
      topTex = snowy ? pick(sea!.sandFrost, h >>> 4) : (h & 7) === 0 ? pick(tex.sandPebbles, h >>> 4) : pick(tex.sandPlain, h >>> 4);
      topTint = landTint(x, y, e, t, look);
      break;
    case Terrain.Forest:
      topTex = snowy ? pick(sea!.forestSnow, h >>> 4) : pick(tex.forestFloor, h >>> 4);
      topTint = landTint(x, y, e, t, look);
      break;
    case Terrain.Hills:
      topTex = snowy ? pick(sea!.hillsSnow, h >>> 4) : pick(tex.hills, h >>> 4);
      topTint = landTint(x, y, e, t, look);
      break;
    case Terrain.Mountain:
      topTex = snowy ? pick(sea!.rockSnow, h >>> 4) : pick(tex.rockGround, h >>> 4);
      topTint = landTint(x, y, e, t, look);
      break;
    default: {
      const r = (h >>> 5) & 15;
      const flowerFrom = 13 - Math.round(look.spring * 3);
      topTex = snowy ? pick(sea!.grassSnow, h >>> 9) : r < 9 ? pick(tex.grassPlain, h >>> 9) : r < flowerFrom ? pick(tex.grassTuft, h >>> 9) : pick(tex.grassFlower, h >>> 9);
      topTint = landTint(x, y, e, t, look);
    }
  }
  if (snowy) {
    // one soft cold white; brightness (not hue) drifts slowly across the field
    const lum = 0.925 + fbm(x * 0.13 + 4, y * 0.13 + 9, 408, 3) * 0.06 + (hash01(x, y, 403) - 0.5) * 0.02;
    topTint = tint(lum, lum + 0.014, Math.min(1, lum + 0.05));
  }
  return { tex: topTex, tint: topTint, snowy };
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
export function buildChunk(chunk: Chunk, model: TerrainModel, tex: TextureSet, depth: DepthLayer, look: SeasonLook, baked: boolean): void {
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
        const frostTile = !water && tex.seasonal !== null && look.snow > 0 && hash01(x, y, 401) < look.snow;
        const shade = f.right ? 0xb9b4b2 : 0xffffff;
        const waterSide = water ? (f.right ? 0x4a7aa0 : 0x6a9cbf) : shade;
        if (levels === 1 && !oob && !water && (t === Terrain.Grass || t === Terrain.Forest || t === Terrain.Sand)) {
          const arr = t === Terrain.Sand ? (frostTile ? tex.seasonal!.bankSandFrost : tex.bankSand) : frostTile ? tex.seasonal!.bankSnow : tex.bankGrass;
          const s = new Sprite(arr[(h + (f.right ? 3 : 0)) % arr.length]!);
          s.position.set(top.x, top.y);
          if (f.right) {
            s.scale.x = -1;
            s.tint = 0xd2d2d2;
          }
          if (raised) {
            s.zIndex = d + 0.49;
            sorted.push(s);
          } else groundUnder.push(s);
          continue;
        }
        for (let k = 0; k < levels; k++) {
          const lip = k === 0 && t !== Terrain.Mountain && !water;
          const arr = lip ? (frostTile && mat !== 'sand' ? tex.seasonal!.lipSnow[mat] : set.lip) : set.mid;
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
      const top = tileTop(model, tex, look, x, y);
      const snowy = top.snowy;
      const sea = tex.seasonal;
      if (t === Terrain.Forest) ctx.hasForest = true;
      if (t === Terrain.Mountain) ctx.hasMountain = true;
      add(top.tex, c.x, c.y, raised, d + 0.5, 'top', top.tint, ((h >>> 12) & 1) === 1);

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
          if (nWater && model.elev[ni] === 0 && e === 0) {
            // depth colour is per tile; wash each edge with the neighbour's colour so the steps melt together
            const nt2 = waterTint(nx, ny, nt, model.shoreSmooth[ni]!, look.ice);
            const diff = Math.abs((nt2 >> 16) - (top.tint >> 16)) + Math.abs(((nt2 >> 8) & 255) - ((top.tint >> 8) & 255)) + Math.abs((nt2 & 255) - (top.tint & 255));
            if (diff > 10) add(tex.waterBlend[dir], c.x, c.y, raised, d + 0.505, 'over', nt2);
          }
          if (!nWater && model.elev[ni] === 0) {
            if (baked && (dir === 'se' || dir === 'sw')) {
              // land to the south: its trees stand over this foam, so it is painted into the picture (still)
              const dv = dir === 'se' ? [-0.89, -0.45] : [0.89, -0.45];
              const f = add(tex.foam[dir], c.x + dv[0]! * 1.5, c.y + dv[1]! * 1.5, raised, d + 0.52, 'over');
              f.alpha = 0.75;
              continue;
            }
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
        if (rn > rt && !snowy) add(tex.fringe[FRINGE_MATERIAL[nt]!][dir], c.x, c.y, raised, d + 0.51, 'over');
      }

      // ---- decals & objects -------------------------------------------------------------------
      const hd = hash01(x, y, 29);
      const ox = (hash01(x, y, 31) - 0.5) * 30;
      const oy = (hash01(x, y, 37) - 0.5) * 12;
      const wintry = look.snow > 0.45;
      switch (t) {
        case Terrain.Grass: {
          if (model.stump[i]) addObject(tex.stump, c.x + ox * 0.3, c.y + oy * 0.4, d + 0.99);
          else if (hd < 0.045) addObject(pick(tex.bush, h >>> 7), c.x + ox, c.y + oy, d + 1 + oy * 0.001);
          else if (hd < 0.11 + look.spring * 0.07 && !wintry) add(pick(tex.flowerPatch, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
          else if (hd < 0.2 + look.spring * 0.07 && !snowy) add(pick(tex.tuft, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
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
            const v = (h >>> 6) % 3;
            const th = hash01(x, y, 402);
            let texture: Texture;
            if (sp === 1) {
              texture = sea !== null && look.snow > th * 0.8 ? sea.pineSnow[lvl - 1]![v]! : tex.trees.pine[lvl - 1]![(h >>> 6) % tex.trees.pine[0]!.length]!;
            } else if (sea !== null && look.bare > th) {
              texture = (sp === 0 ? sea.treesBare.oak : sea.treesBare.birch)[lvl - 1]![v]!;
            } else if (sea !== null && look.autumn > th) {
              texture = (sp === 0 ? sea.treesAutumn.oak : sea.treesAutumn.birch)[lvl - 1]![v]!;
            } else {
              const arr = sp === 0 ? tex.trees.oak : tex.trees.birch;
              texture = arr[lvl - 1]![(h >>> 6) % arr[0]!.length]!;
            }
            addObject(texture, c.x, c.y, d + 1, ((h >>> 13) & 1) === 1);
          } else {
            addObject(tex.stump, c.x - 6, c.y + 1, d + 0.99);
            addObject(tex.stump, c.x + 8, c.y - 2, d + 0.99);
          }
          break;
        }
        case Terrain.Hills: {
          if (lvl > 0) {
            // outcrops are sparse and varied; richer tiles are likelier to carry a bigger one
            const chance = [0.3, 0.42, 0.55, 0.68][lvl - 1]!;
            if (hash01(x, y, 411) < chance) {
              const kind = (h >>> 5) % tex.outcrops.length;
              const tier = clamp(lvl - 1 + (((h >>> 9) & 3) === 0 ? -1 : 0), 0, 3);
              const arr = tex.outcrops[kind]![tier]!;
              addObject(arr[(h >>> 11) % arr.length]!, c.x + (hash01(x, y, 412) - 0.5) * 22, c.y + (hash01(x, y, 413) - 0.5) * 8, d + 1, ((h >>> 13) & 1) === 1);
            } else if (hd < 0.35 && !wintry) {
              addObject(pick(tex.bush, h >>> 7), c.x + ox, c.y + oy, d + 1 + oy * 0.001);
            } else if (hd < 0.6 && !snowy) {
              add(pick(tex.tuft, h >>> 9), c.x + ox, c.y + oy, raised, d + 0.53, 'over');
            }
          } else addObject(pick(tex.rubble, h >>> 6), c.x, c.y, d + 1);
          break;
        }
        case Terrain.Mountain: {
          if (lvl > 0) {
            const base = e >= 6 ? 2 : e >= 5 ? 1 : 0;
            const snow = Math.min(2, base + (sea !== null && look.snow > hash01(x, y, 405) ? 1 : 0));
            const v = (h >>> 6) % tex.mountains[snow]!.length;
            const sp = addObject(tex.mountains[snow]![v]![(h >>> 14) & 1]!, c.x, c.y + 4, d + 1);
            const sc = 0.86 + hash01(x, y, 421) * 0.3;
            sp.scale.set(sc);
          } else addObject(pick(tex.quarried, h >>> 6), c.x, c.y + 4, d + 1);
          break;
        }
        case Terrain.ShallowWater:
        case Terrain.DeepWater: {
          const sh = model.shore[i]!;
          if (hd < 0.38 && !(baked && tallSouth(model, x, y))) {
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
  chunk.lookKey = look.key + (tex.seasonal ? '+' : '-');
  if (chunk.shown && !baked) for (const s of sorted) depth.place(s);
}
