import { Costmap } from '../mapping/Costmap';
import { GridGeometry } from '../mapping/GridGeometry';
import { OccupancyGrid } from '../mapping/OccupancyGrid';
import { ROBOT } from '../robot/robotSpec';
import { blocksRobot, buildShapes, circleShape, rayShape, type Contact, type Shape } from './shapes';
import type { FloorType, HouseLayout, Rect } from './types';

export const FLOOR_CODES: FloorType[] = ['hardwood', 'tile', 'carpet', 'rug'];
const NO_ROOM = -1;

/**
 * Ground truth of the environment. Only the physics (collisions) and the sensor models (LiDAR rays,
 * bumper, cliff sensors, carpet sensor) may query this. Planning/navigation use the robot's own map.
 */
export class WorldModel {
  readonly layout: HouseLayout;
  readonly shapes: Shape[];
  /** Fine grid (shared resolution with dirt/map) for per-cell lookups. */
  readonly grid: GridGeometry;
  /** Floor type code per cell (index into FLOOR_CODES), 255 = outside the house. */
  readonly surface: Uint8Array;
  /** Room index per cell (into layout.rooms), -1 outside any room. */
  readonly roomIndex: Int16Array;
  /** 1 where the floor exists and is not covered by a robot-blocking footprint or cliff. */
  readonly cleanable: Uint8Array;
  readonly cliffMask: Uint8Array;
  private reachableCache: Uint8Array | null = null;

  private readonly bucketSize = 0.5;
  private readonly bucketCols: number;
  private readonly bucketRows: number;
  private readonly buckets: Shape[][];
  private readonly stamp: Uint32Array;
  private stampId = 1;
  private readonly contact: Contact = { depth: 0, nx: 0, ny: 0, shape: null };

  constructor(layout: HouseLayout, cellSize: number) {
    this.layout = layout;
    this.shapes = buildShapes(layout);
    this.grid = GridGeometry.fromBounds(layout.bounds, cellSize, 0.5);
    const g = this.grid;
    this.bucketCols = Math.ceil(g.worldWidth / this.bucketSize);
    this.bucketRows = Math.ceil(g.worldHeight / this.bucketSize);
    this.buckets = Array.from({ length: this.bucketCols * this.bucketRows }, () => []);
    let maxUid = 0;
    for (const s of this.shapes) {
      maxUid = Math.max(maxUid, s.uid);
      const b0 = this.bucketRange(s.minX, s.minY, s.maxX, s.maxY);
      for (let j = b0.j0; j <= b0.j1; j++) for (let i = b0.i0; i <= b0.i1; i++) this.buckets[j * this.bucketCols + i].push(s);
    }
    this.stamp = new Uint32Array(maxUid + 1);

    this.surface = new Uint8Array(g.size).fill(255);
    this.roomIndex = new Int16Array(g.size).fill(NO_ROOM);
    layout.rooms.forEach((room, ri) => {
      const code = FLOOR_CODES.indexOf(room.floor);
      for (const r of room.rects) this.fillRect(r, (idx) => {
        this.surface[idx] = code;
        this.roomIndex[idx] = ri;
      });
    });
    for (const rug of layout.rugs) {
      const code = FLOOR_CODES.indexOf(rug.floor);
      this.fillRect(rug.rect, (idx) => {
        if (this.surface[idx] !== 255) this.surface[idx] = code;
      });
    }
    this.cliffMask = new Uint8Array(g.size);
    for (const c of layout.cliffs) this.fillRect(c.rect, (idx) => (this.cliffMask[idx] = 1));

    this.cleanable = new Uint8Array(g.size);
    for (let idx = 0; idx < g.size; idx++) {
      if (this.surface[idx] === 255 || this.cliffMask[idx]) continue;
      const i = idx % g.width;
      const j = (idx - i) / g.width;
      if (!this.pointBlocked(g.cx(i), g.cy(j))) this.cleanable[idx] = 1;
    }
  }

  /**
   * EVALUATION ONLY (never used by the robot): cleanable cells that the cleaning footprint can
   * physically reach from the dock — within 0.14 m of a robot-center position that is collision-free
   * and connected to the dock. Coverage percentages are reported against this set.
   */
  get coverageTarget(): Uint8Array {
    if (this.reachableCache) return this.reachableCache;
    const g = this.grid;
    const occ = new OccupancyGrid(g);
    for (let i = 0; i < g.size; i++) occ.logOdds[i] = this.cleanable[i] ? occ.params.lMin : occ.params.lMax;
    occ.version++;
    const cm = new Costmap(g, { robotRadius: ROBOT.radius, inflationRadius: ROBOT.radius + 0.05, safetyMargin: 0 });
    cm.update(occ, { noGo: this.layout.zones.filter((z) => z.kind === 'noGo').map((z) => z.rect) });
    const centers = new Uint8Array(g.size);
    const start = g.indexAt(this.layout.dock.x - Math.cos(this.layout.dock.theta) * 0.5, this.layout.dock.y - Math.sin(this.layout.dock.theta) * 0.5);
    const queue = new Int32Array(g.size);
    let qh = 0;
    let qt = 0;
    if (start >= 0 && cm.isTraversable(start)) {
      centers[start] = 1;
      queue[qt++] = start;
    }
    while (qh < qt) {
      const idx = queue[qh++];
      const i = idx % g.width;
      const j = (idx - i) / g.width;
      for (let k = 0; k < 4; k++) {
        const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!g.inBounds(ni, nj)) continue;
        const n = g.index(ni, nj);
        if (centers[n] || !cm.isTraversable(n)) continue;
        centers[n] = 1;
        queue[qt++] = n;
      }
    }
    const reach = 0.14;
    const rc = Math.ceil(reach / g.cellSize);
    const out = new Uint8Array(g.size);
    for (let idx = 0; idx < g.size; idx++) {
      if (!centers[idx]) continue;
      const i = idx % g.width;
      const j = (idx - i) / g.width;
      for (let dj = -rc; dj <= rc; dj++)
        for (let di = -rc; di <= rc; di++) {
          if ((di * di + dj * dj) * g.cellSize * g.cellSize > reach * reach) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!g.inBounds(ni, nj)) continue;
          const n = g.index(ni, nj);
          if (this.cleanable[n]) out[n] = 1;
        }
    }
    this.reachableCache = out;
    return out;
  }

  private fillRect(r: Rect, fn: (idx: number) => void): void {
    const range = this.grid.rectRange(r);
    if (!range) return;
    for (let j = range.j0; j <= range.j1; j++) {
      for (let i = range.i0; i <= range.i1; i++) fn(this.grid.index(i, j));
    }
  }

  private bucketRange(minX: number, minY: number, maxX: number, maxY: number) {
    const g = this.grid;
    const clampI = (v: number) => Math.max(0, Math.min(this.bucketCols - 1, v));
    const clampJ = (v: number) => Math.max(0, Math.min(this.bucketRows - 1, v));
    return {
      i0: clampI(Math.floor((minX - g.originX) / this.bucketSize)),
      j0: clampJ(Math.floor((minY - g.originY) / this.bucketSize)),
      i1: clampI(Math.floor((maxX - g.originX) / this.bucketSize)),
      j1: clampJ(Math.floor((maxY - g.originY) / this.bucketSize)),
    };
  }

  /** Is a floor-level point inside any robot-blocking footprint? */
  pointBlocked(x: number, y: number): boolean {
    const b = this.bucketRange(x, y, x, y);
    for (const s of this.buckets[b.j0 * this.bucketCols + b.i0]) {
      if (!blocksRobot(s)) continue;
      if (circleShape(s, x, y, 0.001, this.contact)) return true;
    }
    return false;
  }

  /**
   * Cast a horizontal ray at height z. Returns hit distance (<= maxRange) or Infinity. Only shapes whose
   * vertical extent contains z are visible. Uses a DDA walk over the spatial hash buckets.
   */
  raycast(ox: number, oy: number, dx: number, dy: number, maxRange: number, z: number, hitOut?: { shape: Shape | null }): number {
    const g = this.grid;
    const bs = this.bucketSize;
    let i = Math.floor((ox - g.originX) / bs);
    let j = Math.floor((oy - g.originY) / bs);
    const stepI = dx > 0 ? 1 : -1;
    const stepJ = dy > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-12 ? bs / Math.abs(dx) : Infinity;
    const tDeltaY = Math.abs(dy) > 1e-12 ? bs / Math.abs(dy) : Infinity;
    const bx = g.originX + (dx > 0 ? i + 1 : i) * bs;
    const by = g.originY + (dy > 0 ? j + 1 : j) * bs;
    let tMaxX = Math.abs(dx) > 1e-12 ? (bx - ox) / dx : Infinity;
    let tMaxY = Math.abs(dy) > 1e-12 ? (by - oy) / dy : Infinity;
    const id = ++this.stampId;
    if (id === 0xffffffff) {
      this.stamp.fill(0);
      this.stampId = 1;
    }
    let best = Infinity;
    let bestShape: Shape | null = null;
    let tEnter = 0;
    while (tEnter <= maxRange) {
      if (i >= 0 && j >= 0 && i < this.bucketCols && j < this.bucketRows) {
        for (const s of this.buckets[j * this.bucketCols + i]) {
          if (this.stamp[s.uid] === id) continue;
          this.stamp[s.uid] = id;
          if (z < s.zMin || z > s.zMax) continue;
          const t = rayShape(s, ox, oy, dx, dy);
          if (t < best) {
            best = t;
            bestShape = s;
          }
        }
      }
      const tExit = Math.min(tMaxX, tMaxY);
      if (best <= tExit) break;
      if (tMaxX < tMaxY) {
        i += stepI;
        tEnter = tMaxX;
        tMaxX += tDeltaX;
      } else {
        j += stepJ;
        tEnter = tMaxY;
        tMaxY += tDeltaY;
      }
      if ((i < -1 && stepI < 0) || (j < -1 && stepJ < 0) || (i > this.bucketCols && stepI > 0) || (j > this.bucketRows && stepJ > 0)) break;
    }
    if (hitOut) hitOut.shape = best <= maxRange ? bestShape : null;
    return best <= maxRange ? best : Infinity;
  }

  /**
   * Robot (circle at floor level) overlap test against all blocking shapes. Returns the deepest contact
   * (depth 0 if free). The returned object is reused; copy fields if you need to keep them.
   */
  collide(x: number, y: number, r: number = ROBOT.radius): Contact {
    const out = this.contact;
    let bestDepth = 0;
    let bnx = 0;
    let bny = 0;
    let bshape: Shape | null = null;
    const b = this.bucketRange(x - r, y - r, x + r, y + r);
    const id = ++this.stampId;
    for (let j = b.j0; j <= b.j1; j++) {
      for (let i = b.i0; i <= b.i1; i++) {
        for (const s of this.buckets[j * this.bucketCols + i]) {
          if (this.stamp[s.uid] === id) continue;
          this.stamp[s.uid] = id;
          if (!blocksRobot(s)) continue;
          if (circleShape(s, x, y, r, out) && out.depth > bestDepth) {
            bestDepth = out.depth;
            bnx = out.nx;
            bny = out.ny;
            bshape = out.shape;
          }
        }
      }
    }
    out.depth = bestDepth;
    out.nx = bnx;
    out.ny = bny;
    out.shape = bshape;
    return out;
  }

  /** Floor type at a world point (null outside the house). */
  surfaceAt(x: number, y: number): FloorType | null {
    const idx = this.grid.indexAt(x, y);
    if (idx < 0) return null;
    const c = this.surface[idx];
    return c === 255 ? null : FLOOR_CODES[c];
  }

  roomAt(x: number, y: number): number {
    const idx = this.grid.indexAt(x, y);
    return idx < 0 ? NO_ROOM : this.roomIndex[idx];
  }

  isCliff(x: number, y: number): boolean {
    const idx = this.grid.indexAt(x, y);
    if (idx < 0) return true;
    return this.cliffMask[idx] === 1 || this.surface[idx] === 255;
  }

  /** Door threshold under the point? (used for suspension animation + slight slowdown) */
  onThreshold(x: number, y: number): boolean {
    for (const d of this.layout.doors) {
      const halfW = d.width / 2;
      const halfT = d.wallThickness / 2 + 0.02;
      const inX = d.axis === 'x' ? Math.abs(x - d.center.x) <= halfW : Math.abs(x - d.center.x) <= halfT;
      const inY = d.axis === 'x' ? Math.abs(y - d.center.y) <= halfT : Math.abs(y - d.center.y) <= halfW;
      if (inX && inY) return true;
    }
    return false;
  }
}
