import { Primitive, smax, smin, type V3 } from './primitives';

export interface SdfPart {
  /** Unique name, used by the coat painter to find creases (e.g. the mouth line). */
  name: string;
  prim: Primitive;
  /** Index of the bone that owns this part (drives skin weights). */
  bone: number;
  /** Smooth blend radius against everything added before it. */
  k: number;
  op: 'union' | 'subtract';
}

/**
 * An ordered list of smoothly blended primitives. Evaluation skips primitives whose bounds are
 * too far away to change the result, which keeps meshing fast.
 */
interface Accelerator {
  min: V3;
  cell: number;
  nx: number;
  ny: number;
  nz: number;
  /** Start offset of each cell's part list in `items` (length = cells + 1). */
  offsets: Int32Array;
  items: Int32Array;
}

export class SdfModel {
  readonly parts: SdfPart[] = [];
  private readonly partIndex = new Map<string, number>();
  private accel: Accelerator | null = null;

  add(part: SdfPart): this {
    if (this.partIndex.has(part.name)) throw new Error(`Duplicate SDF part '${part.name}'`);
    this.accel = null;
    this.partIndex.set(part.name, this.parts.length);
    this.parts.push(part);
    return this;
  }

  indexOf(name: string): number {
    const i = this.partIndex.get(name);
    if (i === undefined) throw new Error(`Unknown SDF part '${name}'`);
    return i;
  }

  /**
   * Builds a uniform grid listing, per cell, the parts whose bounds come within `reach` of it.
   * Evaluation then only visits those parts. Results are exact wherever |d| < reach - max(k),
   * which covers everything meshing needs; farther away only the magnitude can differ.
   */
  accelerate(min: V3, max: V3, cell: number, reach: number): void {
    const nx = Math.max(1, Math.ceil((max[0] - min[0]) / cell));
    const ny = Math.max(1, Math.ceil((max[1] - min[1]) / cell));
    const nz = Math.max(1, Math.ceil((max[2] - min[2]) / cell));
    const offsets = new Int32Array(nx * ny * nz + 1);
    const items: number[] = [];
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c0: V3 = [min[0] + i * cell, min[1] + j * cell, min[2] + k * cell];
          offsets[i + nx * (j + ny * k)] = items.length;
          for (let p = 0; p < this.parts.length; p++) {
            const b = this.parts[p].prim.bounds;
            const dx = Math.max(b.min[0] - (c0[0] + cell), 0, c0[0] - b.max[0]);
            const dy = Math.max(b.min[1] - (c0[1] + cell), 0, c0[1] - b.max[1]);
            const dz = Math.max(b.min[2] - (c0[2] + cell), 0, c0[2] - b.max[2]);
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.85 <= reach) items.push(p);
          }
        }
      }
    }
    offsets[nx * ny * nz] = items.length;
    this.accel = { min, cell, nx, ny, nz, offsets, items: Int32Array.from(items) };
  }

  /** Signed distance of the whole model. `upTo` limits evaluation to the first N parts. */
  eval(x: number, y: number, z: number, upTo = this.parts.length): number {
    const a = this.accel;
    if (a && upTo === this.parts.length) {
      const i = Math.floor((x - a.min[0]) / a.cell);
      const j = Math.floor((y - a.min[1]) / a.cell);
      const k = Math.floor((z - a.min[2]) / a.cell);
      if (i >= 0 && j >= 0 && k >= 0 && i < a.nx && j < a.ny && k < a.nz) {
        const c = i + a.nx * (j + a.ny * k);
        return this.evalList(x, y, z, a.items, a.offsets[c], a.offsets[c + 1]);
      }
    }
    let d = Infinity;
    const parts = this.parts;
    for (let i = 0; i < upTo; i++) {
      const p = parts[i];
      // Bounds are padded (x0.85) because several primitives are distance bounds, not exact.
      const bd = p.prim.boundsDistance(x, y, z) * 0.85;
      if (p.op === 'union') {
        if (bd >= d + p.k) continue;
        d = smin(d, p.prim.eval(x, y, z), p.k);
      } else {
        if (bd >= p.k - d) continue;
        d = smax(d, -p.prim.eval(x, y, z), p.k);
      }
    }
    return d;
  }

  private evalList(x: number, y: number, z: number, list: Int32Array, from: number, to: number): number {
    let d = Infinity;
    const parts = this.parts;
    for (let n = from; n < to; n++) {
      const p = parts[list[n]];
      const bd = p.prim.boundsDistance(x, y, z) * 0.85;
      if (p.op === 'union') {
        if (bd >= d + p.k) continue;
        d = smin(d, p.prim.eval(x, y, z), p.k);
      } else {
        if (bd >= p.k - d) continue;
        d = smax(d, -p.prim.eval(x, y, z), p.k);
      }
    }
    // A cell far from every part: report "far outside" rather than Infinity.
    return d === Infinity ? 1 : d;
  }

  /** Raw (unblended) distance of every union part, written into `out`. */
  partDistances(x: number, y: number, z: number, out: Float64Array): void {
    const parts = this.parts;
    for (let i = 0; i < parts.length; i++) {
      out[i] = parts[i].op === 'union' ? parts[i].prim.eval(x, y, z) : Infinity;
    }
  }

  /** Central-difference gradient (not normalized). */
  gradient(x: number, y: number, z: number, eps: number, out: [number, number, number]): void {
    out[0] = this.eval(x + eps, y, z) - this.eval(x - eps, y, z);
    out[1] = this.eval(x, y + eps, z) - this.eval(x, y - eps, z);
    out[2] = this.eval(x, y, z + eps) - this.eval(x, y, z - eps);
  }
}
