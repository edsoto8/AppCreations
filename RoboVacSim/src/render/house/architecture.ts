import * as THREE from 'three';
import type { FloorType, HouseLayout, Rect, WallDef } from '../../sim/world/types';
import { BoxBatch, FACE } from './geometry';
import type { MaterialLibrary, MatKey } from './materials';
import { buildStairwell } from './stairs';

export type WallMode = 'full' | 'cutaway' | 'hidden';

export const CUTAWAY_HEIGHT = 0.9;
export const CURB_HEIGHT = 0.12;
const DOOR_HEIGHT = 2.05;
const BASEBOARD_H = 0.08;
const BASEBOARD_T = 0.012;
const CASING_W = 0.07;
const CASING_T = 0.015;
const RUG_T = 0.01;

/** A group of meshes built from shared materials; dispose() frees geometry and releases materials. */
export interface BuiltGroup {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  dispose(): void;
}

function emptyGroup(name: string, lib: MaterialLibrary): BuiltGroup & { add(mat: MatKey, geo: THREE.BufferGeometry | null, cfg?: Partial<THREE.Mesh>): THREE.Mesh | null } {
  const group = new THREE.Group();
  group.name = name;
  const meshes: THREE.Mesh[] = [];
  const keys: MatKey[] = [];
  return {
    group,
    meshes,
    add(mat, geo, cfg = {}) {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, lib.acquire(mat));
      keys.push(mat);
      Object.assign(m, cfg);
      m.name = `${name}:${mat}`;
      group.add(m);
      meshes.push(m);
      return m;
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      keys.forEach((k) => lib.release(k));
      meshes.length = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}

/** Disjoint pieces of rect r minus the holes (axis-aligned). */
export function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  let pieces: Rect[] = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const p of pieces) {
      const ix0 = Math.max(p.x, h.x);
      const iy0 = Math.max(p.y, h.y);
      const ix1 = Math.min(p.x + p.w, h.x + h.w);
      const iy1 = Math.min(p.y + p.h, h.y + h.h);
      if (ix1 - ix0 <= 1e-9 || iy1 - iy0 <= 1e-9) {
        next.push(p);
        continue;
      }
      const px1 = p.x + p.w;
      const py1 = p.y + p.h;
      if (iy0 > p.y) next.push({ x: p.x, y: p.y, w: p.w, h: iy0 - p.y });
      if (py1 > iy1) next.push({ x: p.x, y: iy1, w: p.w, h: py1 - iy1 });
      if (ix0 > p.x) next.push({ x: p.x, y: iy0, w: ix0 - p.x, h: iy1 - iy0 });
      if (px1 > ix1) next.push({ x: ix1, y: iy0, w: px1 - ix1, h: iy1 - iy0 });
    }
    pieces = next;
  }
  return pieces;
}

const FLOOR_MAT: Record<FloorType, MatKey> = {
  hardwood: 'floorHardwood',
  tile: 'floorTile',
  carpet: 'floorCarpet',
  rug: 'floorRug',
};

/** Room floors (one merged mesh per floor type, cut around cliffs), rugs and stairwells. */
export function buildFloors(layout: HouseLayout, lib: MaterialLibrary): BuiltGroup & { floorMeshes: THREE.Mesh[] } {
  const out = emptyGroup('floors', lib);
  const batches = new Map<FloorType, BoxBatch>();
  const holes = layout.cliffs.map((c) => c.rect);
  for (const room of layout.rooms) {
    const batch = batches.get(room.floor) ?? new BoxBatch();
    batches.set(room.floor, batch);
    for (const rc of room.rects) {
      for (const p of subtractRects(rc, holes)) batch.floorRect(p.x, p.y, p.x + p.w, p.y + p.h, 0);
    }
  }
  const floorMeshes: THREE.Mesh[] = [];
  for (const [type, batch] of batches) {
    const m = out.add(FLOOR_MAT[type], batch.build(), { receiveShadow: true, castShadow: false });
    if (m) {
      m.userData = { pickKind: 'floor', floor: type };
      floorMeshes.push(m);
    }
  }
  // Rugs: thin boxes, top at ~0.011 m.
  for (const rug of layout.rugs) {
    const g = new THREE.BoxGeometry(rug.rect.w, RUG_T, rug.rect.h);
    if (rug.floor === 'carpet') {
      // World-meter UVs so the carpet texture keeps its scale.
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rug.rect.w, uv.getY(i) * rug.rect.h);
    }
    g.translate(rug.rect.x + rug.rect.w / 2, 0.0012 + RUG_T / 2, rug.rect.y + rug.rect.h / 2);
    const key = `${rug.floor === 'carpet' ? 'rugCarpet' : 'rugPattern'}|${rug.color}`;
    const m = out.add(key, g, { receiveShadow: true, castShadow: false });
    if (m) m.userData = { pickKind: 'floor', floor: rug.floor, rugId: rug.id };
  }
  // Stairwells.
  if (layout.cliffs.length) {
    const sb = { tread: new BoxBatch(), riser: new BoxBatch(), shaft: new BoxBatch(), dark: new BoxBatch(), nosing: new BoxBatch() };
    for (const c of layout.cliffs) buildStairwell(c.rect, layout, sb);
    out.add('stairTread', sb.tread.build(), { receiveShadow: true, castShadow: true });
    out.add('stairRiser', sb.riser.build(), { receiveShadow: true });
    out.add('stairShaft', sb.shaft.build(), { receiveShadow: true });
    out.add('stairDark', sb.dark.build());
    out.add('nosing', sb.nosing.build(), { receiveShadow: true });
  }
  return { ...out, floorMeshes };
}

/** Solid box of a wall segment (extended by thickness/2 at both ends, like the sim). */
function wallBox(w: WallDef): { x0: number; z0: number; x1: number; z1: number; horizontal: boolean } {
  const t = w.thickness / 2;
  const horizontal = Math.abs(w.a.y - w.b.y) < 1e-9;
  return {
    x0: Math.min(w.a.x, w.b.x) - t,
    x1: Math.max(w.a.x, w.b.x) + t,
    z0: Math.min(w.a.y, w.b.y) - t,
    z1: Math.max(w.a.y, w.b.y) + t,
    horizontal,
  };
}

const inAnyRect = (rects: Rect[], x: number, y: number) => rects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);

/** 1D interval subtraction. */
function subtractIntervals(a0: number, a1: number, cuts: Array<[number, number]>): Array<[number, number]> {
  let segs: Array<[number, number]> = [[a0, a1]];
  for (const [c0, c1] of cuts) {
    const next: Array<[number, number]> = [];
    for (const [s0, s1] of segs) {
      if (c1 <= s0 || c0 >= s1) next.push([s0, s1]);
      else {
        if (c0 > s0) next.push([s0, c0]);
        if (c1 < s1) next.push([c1, s1]);
      }
    }
    segs = next;
  }
  return segs.filter(([s0, s1]) => s1 - s0 > 0.005);
}

/** Walls, caps, lintels, door casings + jamb liners, thresholds and baseboards for a wall mode. */
export function buildWalls(layout: HouseLayout, mode: WallMode, details: boolean, lib: MaterialLibrary): BuiltGroup {
  const out = emptyGroup('walls', lib);
  const intSides = new BoxBatch();
  const extSides = new BoxBatch();
  const caps = new BoxBatch();
  const trim = new BoxBatch();
  const thresholds = new BoxBatch();
  const roomRects = layout.rooms.flatMap((r) => r.rects);
  const cliffRects = layout.cliffs.map((c) => c.rect);
  const heightOf = (w: WallDef) => (mode === 'full' ? w.height : mode === 'cutaway' ? Math.min(CUTAWAY_HEIGHT, w.height) : CURB_HEIGHT);

  for (const w of layout.walls) {
    if (mode === 'hidden' && !w.exterior) continue;
    const H = heightOf(w);
    const b = wallBox(w);
    (w.exterior ? extSides : intSides).box(b.x0, 0, b.z0, b.x1, H, b.z1, FACE.SIDES);
    caps.box(b.x0, H - 0.0005, b.z0, b.x1, H, b.z1, FACE.PY);
    if (!details || mode === 'hidden') continue;
    // Baseboards on each face that borders a room (not over a stairwell).
    for (const side of [-1, 1]) {
      if (b.horizontal) {
        const face = side < 0 ? b.z0 : b.z1;
        const mid = (b.x0 + b.x1) / 2;
        const probeY = face + side * 0.15;
        if (!inAnyRect(roomRects, mid, probeY) && !inAnyRect(roomRects, b.x0 + 0.3, probeY) && !inAnyRect(roomRects, b.x1 - 0.3, probeY)) continue;
        const zA = side < 0 ? face - BASEBOARD_T : face;
        const zB = side < 0 ? face : face + BASEBOARD_T;
        const cuts = cliffRects.filter((c) => c.y < zB + 0.02 && c.y + c.h > zA - 0.02).map((c): [number, number] => [c.x, c.x + c.w]);
        for (const [s0, s1] of subtractIntervals(b.x0, b.x1, cuts)) trim.box(s0, 0, zA, s1, BASEBOARD_H, zB, FACE.ALL ^ FACE.NY);
      } else {
        const face = side < 0 ? b.x0 : b.x1;
        const mid = (b.z0 + b.z1) / 2;
        const probeX = face + side * 0.15;
        if (!inAnyRect(roomRects, probeX, mid) && !inAnyRect(roomRects, probeX, b.z0 + 0.3) && !inAnyRect(roomRects, probeX, b.z1 - 0.3)) continue;
        const xA = side < 0 ? face - BASEBOARD_T : face;
        const xB = side < 0 ? face : face + BASEBOARD_T;
        const cuts = cliffRects.filter((c) => c.x < xB + 0.02 && c.x + c.w > xA - 0.02).map((c): [number, number] => [c.y, c.y + c.h]);
        for (const [s0, s1] of subtractIntervals(b.z0, b.z1, cuts)) trim.box(xA, 0, s0, xB, BASEBOARD_H, s1, FACE.ALL ^ FACE.NY);
      }
    }
  }

  for (const d of layout.doors) {
    const t = d.wallThickness / 2;
    const ext = d.wallThickness > 0.15;
    const o0 = (d.axis === 'x' ? d.center.x : d.center.y) - d.width / 2;
    const o1 = o0 + d.width;
    const c = d.axis === 'x' ? d.center.y : d.center.x;
    /** Box in door frame: along the wall [a0,a1], across [c0,c1] (relative to the wall center line). */
    const dbox = (batch: BoxBatch, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number, faces?: number) => {
      if (d.axis === 'x') batch.box(a0, y0, c + c0, a1, y1, c + c1, faces);
      else batch.box(c + c0, y0, a0, c + c1, y1, a1, faces);
    };
    // Threshold strip.
    dbox(thresholds, o0, o1, -(t + 0.02), t + 0.02, 0, d.threshold);
    if (mode === 'hidden' && !ext) continue;
    if (mode === 'full') {
      const lintelFaces = d.axis === 'x' ? FACE.NY | FACE.PZ | FACE.NZ : FACE.NY | FACE.PX | FACE.NX;
      dbox(ext ? extSides : intSides, o0, o1, -t, t, DOOR_HEIGHT, 2.5, lintelFaces);
      dbox(caps, o0, o1, -t, t, 2.5 - 0.0005, 2.5, FACE.PY);
    }
    if (!details || mode === 'hidden') continue;
    const top = mode === 'full' ? DOOR_HEIGHT : Math.min(DOOR_HEIGHT, CUTAWAY_HEIGHT);
    // Jamb liners inside the opening.
    dbox(trim, o0, o0 + 0.012, -t - 0.004, t + 0.004, d.threshold, top);
    dbox(trim, o1 - 0.012, o1, -t - 0.004, t + 0.004, d.threshold, top);
    if (mode === 'full') dbox(trim, o0, o1, -t - 0.004, t + 0.004, top - 0.012, top);
    // Casings on both faces.
    const casingTop = mode === 'full' ? top + CASING_W : top;
    for (const s of [-1, 1]) {
      const c0 = s < 0 ? -t - CASING_T : t;
      const c1 = s < 0 ? -t : t + CASING_T;
      dbox(trim, o0 - CASING_W + 0.006, o0 + 0.006, c0, c1, 0, casingTop);
      dbox(trim, o1 - 0.006, o1 + CASING_W - 0.006, c0, c1, 0, casingTop);
      if (mode === 'full') dbox(trim, o0 + 0.006, o1 - 0.006, c0, c1, top, top + CASING_W);
    }
  }

  out.add('wallInt', intSides.build(), { castShadow: true, receiveShadow: true });
  out.add('wallExt', extSides.build(), { castShadow: true, receiveShadow: true });
  out.add(mode === 'full' ? 'capFull' : 'capCut', caps.build(), { receiveShadow: true });
  out.add('trim', trim.build(), { castShadow: false, receiveShadow: true });
  out.add('threshold', thresholds.build(), { receiveShadow: true });
  return out;
}
