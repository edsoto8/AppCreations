import type { ConveyorSnap, PhaseInfo, ProductSnap, SimSnapshot, StationSnap, Vec2, VehicleSnap, WorkerSnap } from '../simulation/types';
import { fgSlotPosition, type FactoryLayout } from '../logistics/layout';
import { pointAtDistance, positionAt } from '../logistics/motion';
import { AGV_DECK_TOP, AGV_TOTE_SLOTS } from './models/AGV';
import { ASSEMBLY_FIXTURE_POS } from './models/AssemblyMachine';
import { KIT_TABLE_SLOTS, KIT_TABLE_TOP } from './models/Racks';
import { packagingCartonX } from './models/PackagingMachine';
import { FORKLIFT_LOAD_X } from './models/Forklift';
import { cartonStackOffsets } from './models/geometries';

/** Heights (m) of handling surfaces, shared with the models. */
export const Y = {
  belt: 0.86,
  table: KIT_TABLE_TOP,
  fixture: ASSEMBLY_FIXTURE_POS[1],
  agvDeck: AGV_DECK_TOP,
  pallet: 0,
  forkLift: 0.25,
};

export interface P3 {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export type ProductVisual = 'tote' | 'A' | 'B' | 'carton';

/** Indexed view of a snapshot (rebuilt only when the snapshot version changes). */
export class SnapIndex {
  version = -1;
  stations = new Map<string, StationSnap>();
  conveyors = new Map<string, ConveyorSnap>();
  vehicles = new Map<string, VehicleSnap>();
  workers = new Map<string, WorkerSnap>();
  products = new Map<string, ProductSnap>();
  snap: SimSnapshot | null = null;

  update(s: SimSnapshot | null): void {
    if (!s || s.version === this.version) return;
    this.version = s.version;
    this.snap = s;
    this.stations.clear();
    this.conveyors.clear();
    this.vehicles.clear();
    this.workers.clear();
    this.products.clear();
    for (const x of s.stations) this.stations.set(x.id, x);
    for (const x of s.conveyors) this.conveyors.set(x.id, x);
    for (const x of s.vehicles) this.vehicles.set(x.id, x);
    for (const x of s.workers) this.workers.set(x.id, x);
    for (const x of s.products) this.products.set(x.id, x);
  }
}

export function progress(p: PhaseInfo | null, t: number): number {
  if (!p) return 0;
  if (p.frozenProgress !== undefined) return p.frozenProgress;
  if (p.t1 <= p.t0) return 1;
  return Math.min(1, Math.max(0, (t - p.t0) / (p.t1 - p.t0)));
}

const tmp = { x: 0, z: 0, heading: 0 };

export function beltPosAt(c: ConveyorSnap, t: number): number {
  const moving = c.state === 'running' || c.state === 'stopped';
  return c.beltPos + (moving ? Math.max(0, t - c.beltTime) * c.speed : 0);
}

/** Distances along the belt of all items (head first) at render time. */
export function conveyorItemDistances(c: ConveyorSnap, t: number, out: number[]): number[] {
  out.length = 0;
  const belt = beltPosAt(c, t);
  let cap = c.length;
  for (const it of c.items) {
    const d = Math.max(0, Math.min(it.basePos + (belt - it.baseBelt), cap));
    out.push(d);
    cap = d - c.pitch;
  }
  return out;
}

export function vehiclePose(v: VehicleSnap, t: number, out: P3): P3 {
  if (v.motion) {
    positionAt(v.motion, t, tmp);
    out.x = tmp.x;
    out.z = tmp.z;
    out.heading = tmp.heading;
  } else {
    out.x = v.pos[0];
    out.z = v.pos[1];
    out.heading = v.heading;
  }
  out.y = 0;
  return out;
}

export function workerPose(w: WorkerSnap, t: number, out: P3): P3 {
  if (w.motion) {
    positionAt(w.motion, t, tmp);
    out.x = tmp.x;
    out.z = tmp.z;
    out.heading = tmp.heading;
  } else {
    out.x = w.pos[0];
    out.z = w.pos[1];
    out.heading = w.heading;
  }
  out.y = 0;
  return out;
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

function arc(out: P3, a: [number, number, number], b: [number, number, number], s: number, h: number): P3 {
  out.x = lerp(a[0], b[0], s);
  out.y = lerp(a[1], b[1], s) + Math.sin(Math.PI * s) * h;
  out.z = lerp(a[2], b[2], s);
  return out;
}

/** Tote position on an assembly cell kit table (4 slots, then stacked). */
export function kitTableSlot(layout: FactoryLayout, cell: number, slot: number): [number, number, number] {
  const c = layout.cells[cell].kitTable;
  const s = KIT_TABLE_SLOTS[slot % KIT_TABLE_SLOTS.length];
  return [c[0] + s[0], Y.table + Math.floor(slot / KIT_TABLE_SLOTS.length) * 0.21, c[1] + s[1]];
}

export function fixturePos(layout: FactoryLayout, cell: number): [number, number, number] {
  const m = layout.cells[cell].machine;
  return [m[0] + ASSEMBLY_FIXTURE_POS[0], ASSEMBLY_FIXTURE_POS[1], m[1] + ASSEMBLY_FIXTURE_POS[2]];
}

/** Object3D rotation.y for a motion heading (atan2(dx, dz)); models face local +x. */
export function yawFromHeading(h: number): number {
  return h - Math.PI / 2;
}

export function cellIndexOf(id: string): number {
  return Number(id.split('-')[1]);
}

/**
 * Where a product is drawn at render time `t`, and as what. Returns false when not visible.
 */
export function productPose(p: ProductSnap, ix: SnapIndex, layout: FactoryLayout, t: number, out: P3, d: number[]): ProductVisual | null {
  const loc = p.location;
  const base: ProductVisual = p.type;
  out.heading = 0;
  switch (loc.kind) {
    case 'conveyor': {
      const c = ix.conveyors.get(loc.ref!);
      if (!c) return null;
      conveyorItemDistances(c, t, d);
      const dist = d[loc.slot] ?? 0;
      pointAtDistance(c.points, dist, tmp);
      out.x = tmp.x;
      out.z = tmp.z;
      out.y = Y.belt;
      out.heading = tmp.heading;
      return c.id === 'C3' ? 'carton' : base;
    }
    case 'buffer': {
      if (loc.ref === 'infeed') {
        const s = layout.infeed.slots[loc.slot % layout.infeed.slots.length];
        out.x = s[0];
        out.z = s[1];
        out.y = Y.table;
        return base;
      }
      if (loc.ref === 'reject') {
        const s = layout.rejectBin.slots[loc.slot % layout.rejectBin.slots.length];
        out.x = s[0];
        out.z = s[1];
        out.y = 0.55;
        return base;
      }
      const cell = cellIndexOf(loc.ref!);
      const [x, y, z] = kitTableSlot(layout, cell, loc.slot);
      out.x = x;
      out.y = y;
      out.z = z;
      return p.rework ? base : 'tote';
    }
    case 'vehicle': {
      const v = ix.vehicles.get(loc.ref!);
      if (!v) return null;
      vehiclePose(v, t, out);
      const [lx, lz] = AGV_TOTE_SLOTS[loc.slot % AGV_TOTE_SLOTS.length];
      const c = Math.cos(out.heading);
      const s = Math.sin(out.heading);
      // heading = atan2(dx, dz): local +x (forward) maps to world (sin h, cos h), local +z to (cos h, -sin h)
      out.x += lx * s + lz * c;
      out.z += lx * c - lz * s;
      out.y = Y.agvDeck + Math.floor(loc.slot / AGV_TOTE_SLOTS.length) * 0.21;
      return p.rework ? base : 'tote';
    }
    case 'station':
      return stationProductPose(p, ix, layout, t, out);
    default:
      return null;
  }
}

function stationProductPose(p: ProductSnap, ix: SnapIndex, layout: FactoryLayout, t: number, out: P3): ProductVisual | null {
  const st = ix.stations.get(p.location.ref!);
  if (!st) return null;
  const s = progress(st.phase, t);
  const ph = st.phase?.name ?? 'blocked';
  const held = p.location.slot === 1 || !st.phase;
  switch (st.kind) {
    case 'assembly': {
      const cell = layout.cells[st.index];
      const table = kitTableSlot(layout, st.index, 0);
      const fixture = fixturePos(layout, st.index);
      const outfeed: [number, number, number] = [cell.outfeed[0], Y.belt + 0.15, cell.outfeed[1]];
      if (held) {
        out.x = outfeed[0];
        out.y = outfeed[1] + 0.35;
        out.z = outfeed[2];
        return p.type;
      }
      if (ph === 'load') {
        if (s < 0.3) {
          out.x = table[0];
          out.y = table[1];
          out.z = table[2];
        } else arc(out, table, fixture, (s - 0.3) / 0.7, 0.9);
        return 'tote';
      }
      if (ph === 'process') {
        out.x = fixture[0];
        out.y = fixture[1];
        out.z = fixture[2];
        return s < 0.25 ? 'tote' : p.type;
      }
      // unload
      if (s < 0.3) {
        out.x = fixture[0];
        out.y = fixture[1];
        out.z = fixture[2];
      } else arc(out, fixture, outfeed, (s - 0.3) / 0.7, 0.9);
      return p.type;
    }
    case 'inspection': {
      const pos = layout.inspection[st.index].pos;
      const bed: [number, number, number] = [pos[0], Y.belt, pos[1]];
      const from: [number, number, number] = [layout.infeed.center[0] + 0.6, Y.table, layout.infeed.center[1]];
      const c2 = layout.conveyors.find((c) => c.id === 'C2')!.points[0];
      const toPass: [number, number, number] = [c2[0], Y.belt, c2[1]];
      const toReject: [number, number, number] = [layout.rejectBin.pos[0], 0.6, layout.rejectBin.pos[1]];
      if (held) {
        out.x = bed[0] + 1;
        out.y = bed[1];
        out.z = bed[2];
        return p.type;
      }
      if (ph === 'load') return arc(out, from, bed, s, 0.3), p.type;
      if (ph === 'test') {
        out.x = bed[0];
        out.y = bed[1];
        out.z = bed[2];
        return p.type;
      }
      return arc(out, bed, st.result === 'reject' ? toReject : toPass, s, 0.3), p.type;
    }
    case 'packaging': {
      const c2 = layout.conveyors.find((c) => c.id === 'C2')!.points;
      const c3 = layout.conveyors.find((c) => c.id === 'C3')!.points;
      const a = c2[c2.length - 1];
      const b = c3[0];
      if (held) {
        out.x = b[0];
        out.y = Y.belt;
        out.z = b[1];
        return 'carton';
      }
      out.x = layout.packaging.center[0] + packagingCartonX(s);
      out.y = Y.belt;
      out.z = lerp(a[1], b[1], s);
      return s < 0.45 ? p.type : 'carton';
    }
    case 'palletizer': {
      const c3 = layout.conveyors.find((c) => c.id === 'C3')!.points;
      const from = c3[c3.length - 1];
      const pos = st.buildPos ?? 0;
      const target: Vec2 = layout.palletizer.positions[pos] ?? layout.palletizer.positions[0];
      const pallet = ix.snap?.pallets.find((x) => x.location === 'palletizer' && x.slot === pos);
      const units = pallet?.units ?? 0;
      const [ox, oy, oz] = cartonStackOffsets(units + 1)[units];
      return arc(out, [from[0], Y.belt, from[1]], [target[0] + ox, Y.pallet + oy, target[1] + oz], s, 1.0), 'carton';
    }
  }
  return null;
}

/** Carton positions on a pallet: 4 layers of 6 (3 x 2), 1.2 x 1.0 m pallet. */
export function cartonSlot(i: number): [number, number, number] {
  const layer = Math.floor(i / 6);
  const k = i % 6;
  const col = k % 3;
  const row = Math.floor(k / 3);
  return [(col - 1) * 0.36, 0.13 + layer * 0.25, (row - 0.5) * 0.42];
}

/** World pose of a pallet (palletizer, forklift forks, FG rack or truck). */
export function palletPose(
  pal: { location: string; slot: number; vehicleId: string | null },
  ix: SnapIndex,
  layout: FactoryLayout,
  t: number,
  out: P3,
): boolean {
  out.heading = 0;
  switch (pal.location) {
    case 'palletizer': {
      const p = layout.palletizer.positions[pal.slot];
      if (!p) return false;
      out.x = p[0];
      out.y = 0;
      out.z = p[1];
      return true;
    }
    case 'fg': {
      const [x, y, z] = fgSlotPosition(layout, pal.slot);
      out.x = x;
      out.y = y;
      out.z = z;
      return true;
    }
    case 'forklift': {
      const v = pal.vehicleId ? ix.vehicles.get(pal.vehicleId) : undefined;
      if (!v) return false;
      vehiclePose(v, t, out);
      const fwd = FORKLIFT_LOAD_X;
      out.x += Math.sin(out.heading) * fwd;
      out.z += Math.cos(out.heading) * fwd;
      out.y = Y.forkLift;
      return true;
    }
    default:
      return false;
  }
}
