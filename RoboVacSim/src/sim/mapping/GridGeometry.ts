import type { Rect, Vec2 } from '../world/types';

/**
 * Row-major grid covering a world rectangle.
 * Cell (i, j): i = column (x), j = row (y). index = j * width + i.
 * Cell (i, j) covers world x in [originX + i*cell, originX + (i+1)*cell), same for y.
 */
export class GridGeometry {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  constructor(
    readonly originX: number,
    readonly originY: number,
    width: number,
    height: number,
    readonly cellSize: number,
  ) {
    if (!(cellSize > 0)) throw new Error('cellSize must be > 0');
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.size = this.width * this.height;
  }

  /** Grid covering `bounds` expanded by `margin` meters on each side. */
  static fromBounds(bounds: Rect, cellSize: number, margin = 0.5): GridGeometry {
    const ox = bounds.x - margin;
    const oy = bounds.y - margin;
    const w = Math.ceil((bounds.w + 2 * margin) / cellSize);
    const h = Math.ceil((bounds.h + 2 * margin) / cellSize);
    return new GridGeometry(ox, oy, w, h, cellSize);
  }

  /** Column for world x (may be out of range). */
  col(x: number): number {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  /** Row for world y (may be out of range). */
  row(y: number): number {
    return Math.floor((y - this.originY) / this.cellSize);
  }

  inBounds(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.width && j < this.height;
  }

  index(i: number, j: number): number {
    return j * this.width + i;
  }

  /** Index of the cell containing world point, or -1 if outside. */
  indexAt(x: number, y: number): number {
    const i = this.col(x);
    const j = this.row(y);
    return this.inBounds(i, j) ? j * this.width + i : -1;
  }

  /** World x of the center of column i. */
  cx(i: number): number {
    return this.originX + (i + 0.5) * this.cellSize;
  }

  /** World y of the center of row j. */
  cy(j: number): number {
    return this.originY + (j + 0.5) * this.cellSize;
  }

  centerOf(index: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
    const i = index % this.width;
    const j = (index - i) / this.width;
    out.x = this.cx(i);
    out.y = this.cy(j);
    return out;
  }

  /** Inclusive cell range overlapping a world rect, clamped to the grid. Returns null if empty. */
  rectRange(r: Rect): { i0: number; j0: number; i1: number; j1: number } | null {
    const i0 = Math.max(0, this.col(r.x));
    const j0 = Math.max(0, this.row(r.y));
    const i1 = Math.min(this.width - 1, this.col(r.x + r.w - 1e-9));
    const j1 = Math.min(this.height - 1, this.row(r.y + r.h - 1e-9));
    if (i0 > i1 || j0 > j1) return null;
    return { i0, j0, i1, j1 };
  }

  get worldWidth(): number {
    return this.width * this.cellSize;
  }

  get worldHeight(): number {
    return this.height * this.cellSize;
  }
}
