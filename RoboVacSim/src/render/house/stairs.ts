import type { HouseLayout, Rect } from '../../sim/world/types';
import { BoxBatch } from './geometry';

export interface StairBatches {
  tread: BoxBatch;
  riser: BoxBatch;
  shaft: BoxBatch;
  dark: BoxBatch;
  nosing: BoxBatch;
}

const RUN = 0.26;
const RISE = 0.18;
const SHAFT_T = 0.06;

function wallRects(layout: HouseLayout): Rect[] {
  return layout.walls.map((w) => {
    const t = w.thickness / 2;
    const x0 = Math.min(w.a.x, w.b.x) - t;
    const y0 = Math.min(w.a.y, w.b.y) - t;
    return { x: x0, y: y0, w: Math.max(w.a.x, w.b.x) + t - x0, h: Math.max(w.a.y, w.b.y) + t - y0 };
  });
}

const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * Stairwell going down inside a cliff rect: steps descend along the rect's long axis, starting at a
 * short edge that is not against a wall. The shaft is fully enclosed below floor level so it is
 * self-contained (it extends to about -1.9 m).
 */
export function buildStairwell(rect: Rect, layout: HouseLayout, b: StairBatches): void {
  const walls = wallRects(layout);
  const walled = (x: number, y: number) => walls.some((r) => inRect(r, x, y));
  const alongX = rect.w >= rect.h;
  const L = alongX ? rect.w : rect.h;
  const W = alongX ? rect.h : rect.w;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const probe = 0.05;
  // Short edges: "min" edge (x0 or y0) and "max" edge.
  const minOpen = alongX ? !walled(rect.x - probe, cy) : !walled(cx, rect.y - probe);
  const maxOpen = alongX ? !walled(rect.x + rect.w + probe, cy) : !walled(cx, rect.y + rect.h + probe);
  const fromMax = !minOpen && maxOpen;
  // Long edges (t = 0 side and t = W side).
  const t0Open = alongX ? !walled(cx, rect.y - probe) : !walled(rect.x - probe, cy);
  const t1Open = alongX ? !walled(cx, rect.y + rect.h + probe) : !walled(rect.x + rect.w + probe, cy);

  /** Stair frame (s along descent, t across) to sim (x, y). */
  const toSim = (s: number, t: number): [number, number] => {
    const along = fromMax ? L - s : s;
    return alongX ? [rect.x + along, rect.y + t] : [rect.x + t, rect.y + along];
  };
  /** Axis-aligned box in stair coordinates -> three coordinates (x, y, z = sim y). */
  const box = (batch: BoxBatch, s0: number, s1: number, t0: number, t1: number, y0: number, y1: number, faces?: number) => {
    const [ax, ay] = toSim(s0, t0);
    const [bx, by] = toSim(s1, t1);
    batch.box(Math.min(ax, bx), y0, Math.min(ay, by), Math.max(ax, bx), y1, Math.max(ay, by), faces);
  };

  const n = Math.max(3, Math.floor(L / RUN));
  const run = L / n;
  const bottom = -(n + 1) * RISE;
  for (let i = 0; i < n; i++) {
    const top = -(i + 1) * RISE;
    const s0 = i * run;
    const s1 = i === n - 1 ? L : s0 + run;
    // Solid step column (riser face + sides) and a wooden tread on top.
    box(b.riser, s0, s1, 0, W, bottom, top - 0.03);
    box(b.tread, s0 - 0.015, s1, 0, W, top - 0.03, top);
    box(b.nosing, s0 - 0.02, s0 + 0.03, 0.02, W - 0.02, top - 0.005, top + 0.003);
  }
  // Shaft walls just outside the rect (inner faces = rect edges), and a dark bottom.
  box(b.shaft, -SHAFT_T, 0, -SHAFT_T, W + SHAFT_T, bottom - 0.2, -0.003);
  box(b.shaft, L, L + SHAFT_T, -SHAFT_T, W + SHAFT_T, bottom - 0.2, -0.003);
  box(b.shaft, 0, L, -SHAFT_T, 0, bottom - 0.2, -0.003);
  box(b.shaft, 0, L, W, W + SHAFT_T, bottom - 0.2, -0.003);
  box(b.dark, 0, L, 0, W, bottom - 0.2, bottom - 0.19);
  // Metal edge nosing on the floor along every open edge of the drop.
  const lip = 0.035;
  box(b.nosing, -lip, 0.004, -0.0, W, -0.02, 0.005);
  if (t0Open) box(b.nosing, 0, L, -lip, 0.004, -0.02, 0.005);
  if (t1Open) box(b.nosing, 0, L, W - 0.004, W + lip, -0.02, 0.005);
  const farOpen = fromMax ? minOpen : maxOpen;
  if (farOpen) box(b.nosing, L - 0.004, L + lip, 0, W, -0.02, 0.005);
}
