/**
 * Occluder redraw for baked terrain.
 *
 * A baked chunk is one picture of ground, trees, rocks, mountains and raised tiles. Settlers and
 * buildings are live sprites drawn on top of that picture, so anything that should stand *in front of*
 * them (a tree just south of a settler, a hill face in front of a building) would wrongly be covered. For
 * every live entity we therefore redraw, as ordinary depth-sorted sprites, exactly those baked objects
 * that overlap it and sort after it. A handful of sprites per entity replaces thousands in the frame.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { DepthLayer } from '../depthLayer';
import { setTex } from '../util/sprite';

export interface OccRec {
  tex: Texture;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  tint: number;
  /** Conservative world bounds. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Frame stamp of the last query that wanted this record. */
  stamp: number;
  occ: Sprite | null;
}

const CELL = 128;

/** Records of one baked chunk, indexed on a coarse grid for fast rectangle queries. */
export class OccIndex {
  readonly records: OccRec[] = [];
  private readonly cells = new Map<number, OccRec[]>();

  add(r: OccRec): void {
    this.records.push(r);
    const ix0 = Math.floor(r.x0 / CELL);
    const ix1 = Math.floor(r.x1 / CELL);
    const iy0 = Math.floor(r.y0 / CELL);
    const iy1 = Math.floor(r.y1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const k = ix * 65536 + iy;
        let a = this.cells.get(k);
        if (!a) {
          a = [];
          this.cells.set(k, a);
        }
        a.push(r);
      }
    }
  }

  /** Push every record overlapping the rectangle that sorts after `z` into `out` (deduplicated by stamp). */
  query(x0: number, y0: number, x1: number, y1: number, z: number, stamp: number, out: OccRec[]): void {
    const ix0 = Math.floor(x0 / CELL);
    const ix1 = Math.floor(x1 / CELL);
    const iy0 = Math.floor(y0 / CELL);
    const iy1 = Math.floor(y1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const a = this.cells.get(ix * 65536 + iy);
        if (!a) continue;
        for (const r of a) {
          if (r.stamp === stamp || r.z <= z) continue;
          if (r.x1 < x0 || r.x0 > x1 || r.y1 < y0 || r.y0 > y1) continue;
          r.stamp = stamp;
          out.push(r);
        }
      }
    }
  }
}

const POOL = 900;

/** Pool of live sprites that redraw wanted records; slots stay attached to a record while it is wanted. */
export class Occluders {
  private readonly free: Sprite[] = [];
  private active: OccRec[] = [];
  private stamp = 1;
  private readonly depth: DepthLayer;

  constructor(depth: DepthLayer) {
    this.depth = depth;
    for (let i = 0; i < POOL; i++) {
      const s = new Sprite();
      s.visible = false;
      this.free.push(s);
    }
  }

  /** Start a frame: returns the stamp to use for queries. */
  begin(): number {
    return ++this.stamp;
  }

  /** Finish a frame: show the wanted records, release the ones no longer wanted. */
  end(wanted: readonly OccRec[], stamp: number): void {
    for (const r of this.active) {
      if (r.stamp !== stamp && r.occ) {
        r.occ.visible = false;
        this.free.push(r.occ);
        r.occ = null;
      }
    }
    const next: OccRec[] = [];
    for (const r of wanted) {
      if (!r.occ) {
        const s = this.free.pop();
        if (!s) continue;
        r.occ = s;
        setTex(s, r.tex);
        s.position.set(r.x, r.y);
        s.scale.set(r.sx, r.sy);
        s.tint = r.tint;
        s.visible = true;
        s.zIndex = r.z;
        this.depth.place(s);
      }
      next.push(r);
    }
    this.active = next;
  }

  /** A chunk is being rebuilt or dropped: release its sprites. */
  releaseAll(records: readonly OccRec[]): void {
    for (const r of records) {
      if (r.occ) {
        r.occ.visible = false;
        this.free.push(r.occ);
        r.occ = null;
      }
    }
    this.active = this.active.filter((r) => r.occ !== null);
  }

  destroy(): void {
    for (const s of this.free) s.destroy();
    for (const r of this.active) r.occ?.destroy();
    this.free.length = 0;
    this.active = [];
  }
}
