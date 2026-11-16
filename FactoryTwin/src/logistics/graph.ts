import type { Vec2 } from '../simulation/types';

/**
 * Undirected waypoint graph used by AGVs, the forklift and walking workers.
 * Shortest paths use Dijkstra with deterministic tie-breaking (node insertion order),
 * and are cached per (from, to) pair.
 */
export class WaypointGraph {
  readonly pos: Vec2[] = [];
  readonly ids: string[] = [];
  private readonly index = new Map<string, number>();
  private readonly adj: { to: number; w: number }[][] = [];
  private readonly pathCache = new Map<string, { nodes: number[]; length: number }>();

  addNode(id: string, p: Vec2): number {
    const existing = this.index.get(id);
    if (existing !== undefined) return existing;
    const i = this.pos.length;
    this.pos.push([p[0], p[1]]);
    this.ids.push(id);
    this.index.set(id, i);
    this.adj.push([]);
    return i;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  idx(id: string): number {
    const i = this.index.get(id);
    if (i === undefined) throw new Error(`Unknown waypoint ${id}`);
    return i;
  }

  position(id: string): Vec2 {
    return this.pos[this.idx(id)];
  }

  connect(a: string, b: string): void {
    const ia = this.idx(a);
    const ib = this.idx(b);
    if (ia === ib || this.adj[ia].some((e) => e.to === ib)) return;
    const w = Math.hypot(this.pos[ia][0] - this.pos[ib][0], this.pos[ia][1] - this.pos[ib][1]);
    this.adj[ia].push({ to: ib, w });
    this.adj[ib].push({ to: ia, w });
    this.pathCache.clear();
  }

  disconnect(a: string, b: string): void {
    const ia = this.idx(a);
    const ib = this.idx(b);
    this.adj[ia] = this.adj[ia].filter((e) => e.to !== ib);
    this.adj[ib] = this.adj[ib].filter((e) => e.to !== ia);
    this.pathCache.clear();
  }

  neighbors(id: string): string[] {
    return this.adj[this.idx(id)].map((e) => this.ids[e.to]);
  }

  /** Nearest aisle node (ids starting with "n:") to a position. */
  nearest(p: Vec2): string {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.pos.length; i++) {
      if (!this.ids[i].startsWith('n:')) continue;
      const d = (this.pos[i][0] - p[0]) ** 2 + (this.pos[i][1] - p[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return this.ids[best];
  }

  edges(): [string, string][] {
    const out: [string, string][] = [];
    this.adj.forEach((list, i) => {
      for (const e of list) if (e.to > i) out.push([this.ids[i], this.ids[e.to]]);
    });
    return out;
  }

  /** Shortest path as node positions (including both ends). */
  path(from: string, to: string): { points: Vec2[]; length: number } {
    const key = `${from}>${to}`;
    let p = this.pathCache.get(key);
    if (!p) {
      p = this.dijkstra(this.idx(from), this.idx(to));
      this.pathCache.set(key, p);
    }
    return { points: p.nodes.map((n) => this.pos[n]), length: p.length };
  }

  private dijkstra(src: number, dst: number): { nodes: number[]; length: number } {
    const n = this.pos.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[src] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1 || u === dst) break;
      done[u] = 1;
      for (const e of this.adj[u]) {
        const nd = dist[u] + e.w;
        if (nd < dist[e.to] - 1e-9) {
          dist[e.to] = nd;
          prev[e.to] = u;
        }
      }
    }
    if (dist[dst] === Infinity) throw new Error(`No path ${this.ids[src]} -> ${this.ids[dst]}`);
    const nodes: number[] = [];
    for (let v = dst; v !== -1; v = prev[v]) nodes.push(v);
    nodes.reverse();
    return { nodes, length: dist[dst] };
  }
}
