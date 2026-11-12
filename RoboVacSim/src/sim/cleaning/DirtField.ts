import { SUCTION_FACTOR, SURFACE, WATER_FACTOR, type CleanMode, type SimConfig, type SuctionLevel, type WaterLevel } from '../config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { ROBOT } from '../robot/robotSpec';
import type { DirtKind, DirtPatch, HouseLayout } from '../world/types';
import { FLOOR_CODES, type WorldModel } from '../world/WorldModel';

export const DIRT_KINDS: DirtKind[] = ['dust', 'crumbs', 'hair', 'liquid', 'stain'];

export interface CleaningContext {
  mode: CleanMode;
  suction: SuctionLevel;
  water: WaterLevel;
  vacuumOn: boolean;
  mopOn: boolean;
  speed: number;
  /** 0..1 how full the dustbin is (a full bin reduces airflow). */
  binFill: number;
  /** Mop pads wetness 0..1 (clean water available). */
  padWetness: number;
  /** Mop pad soiling 0..1 (dirty pads mop worse). */
  padSoil: number;
}

export interface PassResult {
  /** Solids collected into the dustbin this step (g). */
  solids: number;
  /** Liquid recovered by the mop this step (ml). */
  liquid: number;
  /** Stain intensity·m² removed (for stats). */
  stain: number;
  /** Floor area newly covered (first pass in this mission) this step (m²). */
  newArea: number;
}

/**
 * Spatially distributed dirt on the same grid as the world model (5 cm cells).
 * Solids in grams per cell, liquid in ml per cell, stains as 0..1 intensity per cell.
 *
 * Cleaning model (simplified, see ROBOTICS.md): every time the cleaning footprint *enters* a cell
 * (a new pass) a fraction of the dirt is removed:
 *   removed = amount * efficiency, efficiency = base * surface * suction * speed * bin * pass-specific
 * The side brush sweeps a ring in front-right with reduced efficiency. Mop pads remove liquid and
 * stains (several passes needed for stains), and only on hard floors.
 */
export class DirtField {
  readonly dust: Float32Array;
  readonly crumbs: Float32Array;
  readonly hair: Float32Array;
  readonly liquid: Float32Array;
  readonly stain: Float32Array;
  /** Number of footprint passes per cell in the current mission. */
  readonly passes: Uint8Array;
  /** Mop passes per cell in the current mission. */
  readonly mopPasses: Uint8Array;
  private readonly lastStep: Uint32Array;
  private readonly lastMopStep: Uint32Array;
  /** Bumped whenever dirt changes (for render texture uploads). */
  version = 0;
  readonly initialTotals: Record<DirtKind, number> = { dust: 0, crumbs: 0, hair: 0, liquid: 0, stain: 0 };
  readonly removed: Record<DirtKind, number> = { dust: 0, crumbs: 0, hair: 0, liquid: 0, stain: 0 };
  private world: WorldModel;
  private readonly cfg: SimConfig['cleaning'];
  private readonly cellArea: number;
  private stepId = 1;
  /** Cells touched in the current step, collected for passes accounting. */
  coveredCells = 0;

  constructor(world: WorldModel, cfg: SimConfig['cleaning']) {
    this.world = world;
    this.cfg = cfg;
    const n = world.grid.size;
    this.dust = new Float32Array(n);
    this.crumbs = new Float32Array(n);
    this.hair = new Float32Array(n);
    this.liquid = new Float32Array(n);
    this.stain = new Float32Array(n);
    this.passes = new Uint8Array(n);
    this.mopPasses = new Uint8Array(n);
    this.lastStep = new Uint32Array(n);
    this.lastMopStep = new Uint32Array(n);
    this.cellArea = world.grid.cellSize * world.grid.cellSize;
  }

  /** Point at a rebuilt world model (same grid) after a layout edit. Dirt amounts are preserved. */
  rebind(world: WorldModel): void {
    if (world.grid.size !== this.dust.length) throw new Error('DirtField.rebind: grid size changed');
    this.world = world;
    this.version++;
  }

  layer(kind: DirtKind): Float32Array {
    return this[kind];
  }

  /** Procedurally seed dirt: base dust with value noise, traffic paths near doors, + explicit patches. */
  seed(layout: HouseLayout, seed: number): void {
    const rng = new Rng(seed).fork('dirt');
    const g = this.world.grid;
    const A = this.cellArea;
    // Low-frequency value noise lattice (1 m spacing).
    const lw = Math.ceil(g.worldWidth) + 2;
    const lh = Math.ceil(g.worldHeight) + 2;
    const lattice = new Float32Array(lw * lh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
    const noise = (x: number, y: number) => {
      const fx = x - g.originX;
      const fy = y - g.originY;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const tx = fx - i;
      const ty = fy - j;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = lattice[j * lw + i];
      const b = lattice[j * lw + i + 1];
      const c = lattice[(j + 1) * lw + i];
      const d = lattice[(j + 1) * lw + i + 1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    for (let j = 0; j < g.height; j++) {
      for (let i = 0; i < g.width; i++) {
        const idx = g.index(i, j);
        if (!this.world.cleanable[idx]) continue;
        const x = g.cx(i);
        const y = g.cy(j);
        const n = noise(x, y);
        // Base dust 0.3 .. 1.5 g/m2.
        this.dust[idx] = (0.3 + 1.2 * n * n) * A;
        const surf = FLOOR_CODES[this.world.surface[idx]];
        if (surf === 'carpet' || surf === 'rug') this.hair[idx] += 0.08 * n * A;
      }
    }
    // High-traffic patches at doorways.
    const patches: DirtPatch[] = [...layout.dirtPatches];
    for (const d of layout.doors) patches.push({ kind: 'dust', x: d.center.x, y: d.center.y, radius: 0.9, amount: 3.5 });
    for (const p of patches) this.addPatch(p, rng);
    for (const k of DIRT_KINDS) {
      this.initialTotals[k] = this.total(k);
      this.removed[k] = 0;
    }
    this.version++;
  }

  /** Add a patch of dirt (also used by the "spill" tool). Amount is the peak density per m². */
  addPatch(p: DirtPatch, rng?: Rng): number {
    const g = this.world.grid;
    const range = g.rectRange({ x: p.x - p.radius, y: p.y - p.radius, w: p.radius * 2, h: p.radius * 2 });
    if (!range) return 0;
    const layer = this.layer(p.kind);
    let added = 0;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) {
        const idx = g.index(i, j);
        if (!this.world.cleanable[idx]) continue;
        const d = Math.hypot(g.cx(i) - p.x, g.cy(j) - p.y) / p.radius;
        if (d >= 1) continue;
        // Smooth falloff with a bit of seeded speckle for solids.
        let f = 1 - d * d;
        f *= f;
        if (rng && p.kind !== 'liquid' && p.kind !== 'stain') f *= 0.55 + 0.9 * rng.next();
        const amount = p.kind === 'stain' ? Math.min(1 - layer[idx], p.amount * f) : p.amount * f * this.cellArea;
        layer[idx] += amount;
        added += amount;
      }
    }
    this.initialTotals[p.kind] += added;
    this.version++;
    return added;
  }

  total(kind: DirtKind): number {
    const a = this.layer(kind);
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  }

  /** Total solid dirt (g) remaining within an optional cell mask. */
  remainingSolids(mask?: Uint8Array): number {
    let s = 0;
    for (let i = 0; i < this.dust.length; i++) {
      if (mask && !mask[i]) continue;
      s += this.dust[i] + this.crumbs[i] + this.hair[i];
    }
    return s;
  }

  /** Begin a new mission: reset pass counters. */
  resetPasses(): void {
    this.passes.fill(0);
    this.mopPasses.fill(0);
    this.lastStep.fill(0);
    this.lastMopStep.fill(0);
    this.version++;
  }

  /**
   * Apply cleaning for the robot at pose (x, y, theta) for one simulation step.
   * Returns what was collected. Allocation-free except for the result object reuse.
   */
  clean(x: number, y: number, theta: number, ctx: CleaningContext, out: PassResult): PassResult {
    out.solids = 0;
    out.liquid = 0;
    out.stain = 0;
    out.newArea = 0;
    this.stepId++;
    const g = this.world.grid;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const speedFactor = clamp(Math.sqrt(this.cfg.nominalSpeed / Math.max(0.05, Math.abs(ctx.speed))), 0.75, 1.25);
    const binFactor = ctx.binFill >= 1 ? 0.1 : 1 - 0.35 * Math.max(0, ctx.binFill - 0.7) / 0.3;
    const vacEff = this.cfg.baseVacuumEfficiency * SUCTION_FACTOR[ctx.suction] * speedFactor * binFactor;
    const mopEff = this.cfg.baseMopEfficiency * WATER_FACTOR[ctx.water] * speedFactor * (0.25 + 0.75 * ctx.padWetness) * (1 - 0.4 * ctx.padSoil);
    let touched = false;

    // Main brush + side brush footprint (vacuum), and pass accounting for coverage.
    const halfW = ROBOT.mainBrushWidth / 2;
    const halfL = ROBOT.mainBrushLength / 2 + 0.01;
    const reach = ROBOT.radius;
    const range = g.rectRange({ x: x - reach, y: y - reach, w: reach * 2, h: reach * 2 });
    if (!range) return out;
    const sbx = ROBOT.sideBrushX;
    const sbz = ROBOT.sideBrushZ;
    const sbr2 = ROBOT.sideBrushRadius * ROBOT.sideBrushRadius;
    const mopR2 = ROBOT.mopRadius * ROBOT.mopRadius;
    for (let j = range.j0; j <= range.j1; j++) {
      const wy = g.cy(j) - y;
      for (let i = range.i0; i <= range.i1; i++) {
        const idx = g.index(i, j);
        if (!this.world.cleanable[idx]) continue;
        const wx = g.cx(i) - x;
        // To robot local frame: lx forward, lz left.
        const lx = wx * c + wy * s;
        const lz = -wx * s + wy * c;
        const inMain = Math.abs(lx - ROBOT.mainBrushX) <= halfL && Math.abs(lz) <= halfW;
        const dsx = lx - sbx;
        const dsz = lz - sbz;
        const inSide = !inMain && dsx * dsx + dsz * dsz <= sbr2;
        if (inMain || inSide) {
          const newPass = this.lastStep[idx] !== this.stepId - 1;
          this.lastStep[idx] = this.stepId;
          if (newPass) {
            if (this.passes[idx] === 0) out.newArea += this.cellArea;
            if (this.passes[idx] < 255) this.passes[idx]++;
            touched = true;
          }
          if (newPass && ctx.vacuumOn) {
            const surf = SURFACE[FLOOR_CODES[this.world.surface[idx]]];
            const k = inMain ? 1 : 0.45;
            const eDust = clamp(vacEff * surf.vacuum * k, 0, 0.98);
            const eCrumb = clamp(vacEff * 1.1 * Math.min(1, surf.vacuum + 0.15) * k, 0, 0.99);
            const eHair = clamp(vacEff * surf.hair * k, 0, 0.97);
            out.solids += this.take(this.dust, idx, eDust, 'dust');
            out.solids += this.take(this.crumbs, idx, eCrumb, 'crumbs');
            out.solids += this.take(this.hair, idx, eHair, 'hair');
          }
        }
        if (ctx.mopOn) {
          let inMop = false;
          for (let m = -1; m <= 1; m += 2) {
            const dmx = lx - ROBOT.mopX;
            const dmz = lz - m * ROBOT.mopZ;
            if (dmx * dmx + dmz * dmz <= mopR2) inMop = true;
          }
          if (inMop) {
            const newMop = this.lastMopStep[idx] !== this.stepId - 1;
            this.lastMopStep[idx] = this.stepId;
            const surf = SURFACE[FLOOR_CODES[this.world.surface[idx]]];
            if (newMop && surf.mop > 0) {
              if (this.mopPasses[idx] < 255) this.mopPasses[idx]++;
              const e = clamp(mopEff * surf.mop, 0, 0.95);
              out.liquid += this.take(this.liquid, idx, clamp(e * 1.3, 0, 0.97), 'liquid');
              out.stain += this.take(this.stain, idx, e * 0.45, 'stain');
              // Mop also lifts residual fine dust into the pad.
              this.take(this.dust, idx, e * 0.5, 'dust');
              touched = true;
            }
          }
        }
      }
    }
    if (touched || out.solids > 0) this.version++;
    return out;
  }

  private take(layer: Float32Array, idx: number, eff: number, kind: DirtKind): number {
    const v = layer[idx];
    if (v <= 0) return 0;
    let r = v * eff;
    if (v - r < 1e-7) r = v;
    layer[idx] = v - r;
    this.removed[kind] += r;
    return r;
  }
}
