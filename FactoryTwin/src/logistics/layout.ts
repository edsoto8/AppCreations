import type { FactoryConfig, MaterialId, Vec2 } from '../simulation/types';
import { WaypointGraph } from './graph';

/**
 * Factory floor layout: the single source of truth for where things are.
 * The simulation uses it for travel distances; the renderer uses it to place equipment.
 *
 * Coordinates: x grows east, z grows south, metres. The floor spans x in [-50, 50],
 * z in [-30, 30]. Material flows west -> east.
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Zone {
  id: string;
  label: string;
  rect: Rect;
  color: string;
}

export interface CellLayout {
  index: number;
  z: number;
  kitTable: Vec2;
  robot: Vec2;
  machine: Vec2;
  outfeed: Vec2;
  dropNode: string;
  operatorNode: string;
}

export interface InspectionLayout {
  index: number;
  pos: Vec2;
  operatorNode: string;
}

export interface RackLayout {
  index: number;
  center: Vec2;
  length: number;
  depth: number;
  levels: number;
  bays: number;
  /** Side the pick face looks at: +1 = south, -1 = north. */
  face: 1 | -1;
  node: string;
  materials: MaterialId[];
}

export interface BayLayout {
  index: number;
  door: Vec2;
  truck: Vec2;
  node: string;
}

export interface FactoryLayout {
  bounds: Rect;
  zones: Zone[];
  graph: WaypointGraph;
  /** Aisle polylines, for floor markings. */
  aisles: Vec2[][];
  receivingBays: BayLayout[];
  shippingBays: BayLayout[];
  rawRacks: RackLayout[];
  fgRacks: RackLayout[];
  kitting: { pos: Vec2; node: string };
  agvParking: { pos: Vec2; node: string }[];
  cells: CellLayout[];
  conveyors: { id: string; points: Vec2[] }[];
  infeed: { center: Vec2; slots: Vec2[] };
  inspection: InspectionLayout[];
  rejectBin: { pos: Vec2; node: string; slots: Vec2[] };
  packaging: { center: Vec2; length: number; operatorNodes: string[] };
  palletizer: { center: Vec2; pickup: Vec2; positions: Vec2[]; nodes: string[] };
  forkliftHome: string[];
  controlRoom: { center: Vec2; size: Vec2 };
  breakRoom: { center: Vec2; size: Vec2; node: string };
  entrance: { pos: Vec2; node: string };
  controlNode: string;
  /** Aisle node in front of a named pick-up/drop-off spot. */
  approachNode(spot: string): string;
  nearestNode(p: Vec2): string;
}

export const RAW_RACK_MATERIALS: MaterialId[][] = [
  ['PCB', 'SENSOR'],
  ['ENCLOSURE', 'SPEAKER_DRIVER'],
  ['BATTERY', 'PACKAGING_KIT'],
];

/** Positions of assembly cells along z for `n` cells. */
export function cellZ(i: number, n: number): number {
  const spacing = n > 1 ? Math.min(11, 36 / (n - 1)) : 0;
  return (i - (n - 1) / 2) * spacing;
}

export function inspectionZ(j: number, m: number): number {
  return (j - (m - 1) / 2) * 6;
}

export function conveyorId(kind: 'C1' | 'C2' | 'C3', i = 0): string {
  return kind === 'C1' ? `C1-${i + 1}` : kind;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const keyOf = (p: Vec2) => `n:${r2(p[0])},${r2(p[1])}`;

/** Builds aisle networks from axis-aligned lines plus named spots attached by orthogonal spurs. */
class GraphBuilder {
  private lines: [Vec2, Vec2][] = [];
  private spots: { id: string; pos: Vec2 }[] = [];

  line(a: Vec2, b: Vec2) {
    this.lines.push([a, b]);
  }

  spot(id: string, pos: Vec2) {
    this.spots.push({ id, pos });
  }

  build(): WaypointGraph {
    const g = new WaypointGraph();
    // cut points per line
    const cuts: Vec2[][] = this.lines.map(([a, b]) => [a, b]);
    // intersections (axis-aligned lines only)
    for (let i = 0; i < this.lines.length; i++) {
      for (let j = i + 1; j < this.lines.length; j++) {
        const p = intersect(this.lines[i], this.lines[j]);
        if (p) {
          cuts[i].push(p);
          cuts[j].push(p);
        }
      }
    }
    // spot projections
    const spotProj: { id: string; pos: Vec2; proj: Vec2 }[] = [];
    for (const s of this.spots) {
      let best = Infinity;
      let bestP: Vec2 = s.pos;
      let bestLine = 0;
      this.lines.forEach((l, li) => {
        const p = project(l, s.pos);
        const d = Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]);
        if (d < best - 1e-9) {
          best = d;
          bestP = p;
          bestLine = li;
        }
      });
      cuts[bestLine].push(bestP);
      spotProj.push({ id: s.id, pos: s.pos, proj: bestP });
    }
    // nodes and edges along lines
    this.lines.forEach(([a, b], li) => {
      const horizontal = Math.abs(a[1] - b[1]) < 1e-9;
      const pts = cuts[li]
        .map((p): Vec2 => [r2(p[0]), r2(p[1])])
        .sort((p, q) => (horizontal ? p[0] - q[0] : p[1] - q[1]));
      let prev: string | null = null;
      for (const p of pts) {
        const id = keyOf(p);
        g.addNode(id, p);
        if (prev && prev !== id) g.connect(prev, id);
        prev = id;
      }
    });
    for (const s of spotProj) {
      g.addNode(s.id, s.pos);
      g.connect(s.id, keyOf([r2(s.proj[0]), r2(s.proj[1])]));
    }
    return g;
  }
}

function intersect(l1: [Vec2, Vec2], l2: [Vec2, Vec2]): Vec2 | null {
  const h1 = Math.abs(l1[0][1] - l1[1][1]) < 1e-9;
  const h2 = Math.abs(l2[0][1] - l2[1][1]) < 1e-9;
  if (h1 === h2) return null;
  const [h, v] = h1 ? [l1, l2] : [l2, l1];
  const z = h[0][1];
  const x = v[0][0];
  const hx0 = Math.min(h[0][0], h[1][0]);
  const hx1 = Math.max(h[0][0], h[1][0]);
  const vz0 = Math.min(v[0][1], v[1][1]);
  const vz1 = Math.max(v[0][1], v[1][1]);
  if (x < hx0 - 1e-9 || x > hx1 + 1e-9 || z < vz0 - 1e-9 || z > vz1 + 1e-9) return null;
  return [x, z];
}

function project(l: [Vec2, Vec2], p: Vec2): Vec2 {
  const [a, b] = l;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return [a[0] + dx * t, a[1] + dz * t];
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push(p);
  }
  return out;
}

export function buildLayout(config: FactoryConfig): FactoryLayout {
  const nCells = config.assembly.cells;
  const nInsp = config.inspection.stations;
  const gb = new GraphBuilder();

  // --- aisles -------------------------------------------------------------
  const aisles: Vec2[][] = [
    [
      [-38, -22],
      [40, -22],
    ],
    [
      [-38, 22],
      [40, 22],
    ],
    [
      [-38, -22],
      [-38, 22],
    ],
    [
      [-20, -22],
      [-20, 22],
    ],
    [
      [15, -22],
      [15, -3],
    ],
    [
      [15, 3],
      [15, 22],
    ],
    [
      [34, -22],
      [34, 22],
    ],
    [
      [34, -11],
      [46, -11],
    ],
  ];

  // --- raw storage racks ----------------------------------------------------
  const rawRacks: RackLayout[] = [-14, -4, 6].map((z, i) => {
    const node = `rack-${i}`;
    aisles.push([
      [-38, z + 2.2],
      [-20, z + 2.2],
    ]);
    gb.spot(node, [-31, z + 2.2]);
    return {
      index: i,
      center: [-31, z],
      length: 10,
      depth: 1.3,
      levels: 4,
      bays: 5,
      face: 1,
      node,
      materials: RAW_RACK_MATERIALS[i],
    };
  });
  for (const a of aisles) gb.line(a[0], a[1]);

  // --- receiving & shipping -------------------------------------------------
  const recvZ = config.logistics.receivingBays === 1 ? [0] : [-8, 8, 0].slice(0, config.logistics.receivingBays);
  const receivingBays: BayLayout[] = recvZ.map((z, i) => {
    const node = `recv-${i}`;
    gb.spot(node, [-44, z]);
    return { index: i, door: [-50, z], truck: [-56, z], node };
  });
  const shipZ = [8, 16, 24].slice(0, Math.max(1, config.logistics.shippingBays));
  const shippingBays: BayLayout[] = shipZ.map((z, i) => {
    const node = `ship-${i}`;
    gb.spot(node, [46, z]);
    return { index: i, door: [50, z], truck: [56, z], node };
  });

  // --- kitting, AGV parking ----------------------------------------------------
  gb.spot('kit', [-22.5, 2]);
  const agvParking = Array.from({ length: Math.max(1, config.vehicles.agvCount) }, (_, k) => {
    const pos: Vec2 = [-23, 10 + 2.6 * k];
    const node = `agv-park-${k}`;
    gb.spot(node, pos);
    return { pos, node };
  });

  // --- assembly cells -------------------------------------------------------------
  const cells: CellLayout[] = [];
  const conveyors: { id: string; points: Vec2[] }[] = [];
  for (let i = 0; i < nCells; i++) {
    const z = cellZ(i, nCells);
    const dropNode = `cell-${i}-drop`;
    const operatorNode = `cell-${i}-op`;
    gb.spot(dropNode, [-14.4, z]);
    gb.spot(operatorNode, [-12.4, z + 2.1]);
    cells.push({
      index: i,
      z,
      kitTable: [-12.5, z],
      robot: [-10.5, z],
      machine: [-10.5, z - 2.05],
      outfeed: [-8.5, z],
      dropNode,
      operatorNode,
    });
    const e = (i - (nCells - 1) / 2) * 1.0;
    conveyors.push({
      id: conveyorId('C1', i),
      points: dedupe([
        [-8.5, z],
        [2, z],
        [2, e],
        [4.4, e],
      ]),
    });
  }
  conveyors.push({
    id: 'C2',
    points: [
      [12.6, 0],
      [18, 0],
    ],
  });
  conveyors.push({
    id: 'C3',
    points: [
      [24, 0],
      [29.2, 0],
    ],
  });

  // --- inspection ----------------------------------------------------------------------
  const infeedCap = config.inspection.infeedCapacity;
  const rows = Math.ceil(infeedCap / 2);
  const infeedSlots: Vec2[] = Array.from({ length: infeedCap }, (_, k) => {
    const col = k % 2;
    const row = Math.floor(k / 2);
    return [5.1 + col * 0.8, (row - (rows - 1) / 2) * 0.8];
  });
  const inspection: InspectionLayout[] = Array.from({ length: nInsp }, (_, j) => {
    const z = inspectionZ(j, nInsp);
    const operatorNode = `insp-${j}-op`;
    gb.spot(operatorNode, [9.5, z - 2.3]);
    return { index: j, pos: [9.5, z], operatorNode };
  });
  const rejectPos: Vec2 = [6.5, -9.5];
  gb.spot('reject', [6.5, -11.2]);
  const rejectSlots: Vec2[] = Array.from({ length: config.inspection.rejectBinCapacity }, (_, k) => [
    rejectPos[0] - 0.6 + (k % 3) * 0.6,
    rejectPos[1] - 0.3 + Math.floor(k / 3) * 0.6,
  ]);

  // --- packaging & palletizer --------------------------------------------------------------
  gb.spot('pack-op-0', [21, -2.3]);
  gb.spot('pack-op-1', [21, 2.3]);
  const bp = config.palletizer.buildPositions;
  const palPositions: Vec2[] = Array.from({ length: bp }, (_, k) => [31.2, (k - (bp - 1) / 2) * 3]);
  const palNodes = palPositions.map((p, k) => {
    const id = `pal-${k}`;
    gb.spot(id, [33, p[1]]);
    return id;
  });

  // --- finished goods -------------------------------------------------------------------------
  const fgRacks: RackLayout[] = [-14, -8].map((z, i) => {
    const node = `fg-${i}`;
    gb.spot(node, [37 + i * 5, -11]);
    return {
      index: i,
      center: [40.5, z],
      length: 10,
      depth: 1.4,
      levels: 3,
      bays: 5,
      face: i === 0 ? 1 : -1,
      node,
      materials: [],
    };
  });

  // --- people -----------------------------------------------------------------------------------
  gb.spot('entrance', [0, 27]);
  gb.spot('break', [-12, -24.4]);
  gb.spot('control', [0, -24.4]);
  const forkliftHome = Array.from({ length: Math.max(1, config.vehicles.forkliftCount) }, (_, k) => {
    const id = `fork-home-${k}`;
    gb.spot(id, [28 - 4 * k, 24.5]);
    return id;
  });

  const graph = gb.build();
  const zMax = Math.max(...cells.map((c) => Math.abs(c.z)), 4);

  const zones: Zone[] = [
    { id: 'receiving', label: 'RECEIVING', rect: { x0: -50, z0: -14, x1: -40, z1: 14 }, color: '#3b82f6' },
    { id: 'raw', label: 'RAW STORAGE', rect: { x0: -37, z0: -17, x1: -25, z1: 10 }, color: '#6366f1' },
    { id: 'kitting', label: 'KITTING', rect: { x0: -26, z0: -1, x1: -21, z1: 5 }, color: '#8b5cf6' },
    { id: 'agv', label: 'AGV PARK', rect: { x0: -26, z0: 8, x1: -21, z1: 10 + 2.6 * agvParking.length }, color: '#a855f7' },
    { id: 'assembly', label: 'ASSEMBLY', rect: { x0: -17, z0: -zMax - 4.5, x1: 3, z1: zMax + 4 }, color: '#f59e0b' },
    { id: 'inspection', label: 'INSPECTION', rect: { x0: 4, z0: -12.5, x1: 13.5, z1: Math.max(9, inspectionZ(nInsp - 1, nInsp) + 3) }, color: '#10b981' },
    { id: 'packaging', label: 'PACKAGING', rect: { x0: 17.5, z0: -4, x1: 25, z1: 4 }, color: '#14b8a6' },
    { id: 'palletizing', label: 'PALLETIZING', rect: { x0: 28.5, z0: -5, x1: 33.5, z1: 5 }, color: '#06b6d4' },
    { id: 'fg', label: 'FINISHED GOODS', rect: { x0: 35, z0: -17, x1: 46.5, z1: -5 }, color: '#0ea5e9' },
    { id: 'shipping', label: 'SHIPPING', rect: { x0: 40, z0: 4, x1: 50, z1: 20 }, color: '#ef4444' },
    { id: 'control', label: 'CONTROL ROOM', rect: { x0: -6, z0: -30, x1: 6, z1: -25 }, color: '#64748b' },
    { id: 'break', label: 'BREAK ROOM', rect: { x0: -16, z0: -30, x1: -8, z1: -25 }, color: '#64748b' },
  ];

  return {
    bounds: { x0: -50, z0: -30, x1: 50, z1: 30 },
    zones,
    graph,
    aisles,
    receivingBays,
    shippingBays,
    rawRacks,
    fgRacks,
    kitting: { pos: [-24.2, 2], node: 'kit' },
    agvParking,
    cells,
    conveyors,
    infeed: { center: [5.5, 0], slots: infeedSlots },
    inspection,
    rejectBin: { pos: rejectPos, node: 'reject', slots: rejectSlots },
    packaging: { center: [21, 0], length: 6, operatorNodes: ['pack-op-0', 'pack-op-1'] },
    palletizer: { center: [31.2, 0], pickup: [29.6, 0], positions: palPositions, nodes: palNodes },
    forkliftHome,
    controlRoom: { center: [0, -27.5], size: [12, 5] },
    breakRoom: { center: [-12, -27.5], size: [8, 5], node: 'break' },
    entrance: { pos: [0, 29.5], node: 'entrance' },
    controlNode: 'control',
    approachNode: (spot: string) => graph.neighbors(spot)[0],
    nearestNode: (p: Vec2) => graph.nearest(p),
  };
}

/** World position of FG rack slot `k` (pallets fill bays then levels, rack 0 first). Returns [x, y, z]. */
export function fgSlotPosition(layout: FactoryLayout, k: number): [number, number, number] {
  const perRack = layout.fgRacks[0].bays * layout.fgRacks[0].levels;
  const total = perRack * layout.fgRacks.length;
  const kk = k % total;
  const rack = layout.fgRacks[Math.floor(kk / perRack)];
  const within = kk % perRack;
  const bay = within % rack.bays;
  const level = Math.floor(within / rack.bays);
  const x = rack.center[0] - rack.length / 2 + (bay + 0.5) * (rack.length / rack.bays);
  return [x, 0.15 + level * 1.5, rack.center[1]];
}
