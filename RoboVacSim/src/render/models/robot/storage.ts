import { BufferAttribute, CylinderGeometry, Group, Mesh, Shape, Vector3, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuildContext } from '../shared/context';
import {
  extrudeY,
  mat,
  pleatSheet,
  roundedRectHoleXZ,
  roundedRectXZ,
  superEllipsoid,
  tube,
} from '../shared/geometry';
import { createRng } from '../shared/rng';
import { R, TANK_HALF, TANK_OUTER_R } from './layout';

const BIN = { x0: -0.1095, x1: -0.0185, z: 0.0815, y0: 0.034, y1: 0.0738 } as const;

/** Removable smoked-polycarbonate dust bin with a visible debris fill (scaled by dustbinFill). */
export function buildDustbin(ctx: BuildContext): { root: Group; fill: Mesh } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'dustbin';
  const walls = roundedRectXZ(BIN.x0, BIN.x1, -BIN.z, BIN.z, 0.013);
  walls.holes.push(roundedRectHoleXZ(BIN.x0 + 0.0018, BIN.x1 - 0.0018, -BIN.z + 0.0018, BIN.z - 0.0018, 0.0112));
  const shell = ctx.builder();
  shell.add(extrudeY(walls, BIN.y0, BIN.y1, { curveSegments: q.curve }), mats.smokePoly);
  shell.add(extrudeY(roundedRectXZ(BIN.x0, BIN.x1, -BIN.z, BIN.z, 0.013), BIN.y0, BIN.y0 + 0.0016, { bevel: 0.0006, bevelSegments: 1, curveSegments: q.curve }), mats.smokePoly);
  shell.build(root, { name: 'bin-shell', renderOrder: 2 });

  const trim = ctx.builder();
  const gasket = roundedRectXZ(BIN.x0 - 0.0004, BIN.x1 + 0.0004, -BIN.z - 0.0004, BIN.z + 0.0004, 0.0134);
  gasket.holes.push(roundedRectHoleXZ(BIN.x0 + 0.0016, BIN.x1 - 0.0016, -BIN.z + 0.0016, BIN.z - 0.0016, 0.0114));
  trim.add(extrudeY(gasket, BIN.y1 - 0.0008, BIN.y1 + 0.0004, { curveSegments: q.curve }), mats.rubber);
  trim.add(new RoundedBoxGeometry(0.004, 0.0024, 0.1, 2, 0.0009), mats.champagne, mat(-0.1005, BIN.y1 - 0.0004, 0));
  // Inlet flap at the front-bottom (fed by the roller chamber below).
  trim.add(new RoundedBoxGeometry(0.0016, 0.012, 0.13, 1, 0.0006), mats.rubber, mat(-0.027, BIN.y0 + 0.007, 0, 0, 0, 0.5));
  trim.build(root, { name: 'bin-trim' });

  // Debris heap: unit-height lumpy mass, scaled in Y by the fill level.
  const heap = superEllipsoid(0.04, 0.5, 0.077, 0.32, q.level === 'low' ? 16 : 32, q.level === 'low' ? 8 : 16);
  heap.translate(0, 0.5, 0);
  const p = heap.attributes.position as BufferAttribute;
  const rnd = createRng(99);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0.55) p.setY(i, y - rnd() * 0.18 * (y - 0.5));
  }
  heap.computeVertexNormals();
  const fill = new Mesh(ctx.track.track(heap as BufferGeometry), mats.dust);
  fill.name = 'bin-fill';
  fill.position.set(-0.058, BIN.y0 + 0.0017, 0);
  fill.scale.y = 0.0001;
  fill.visible = false;
  root.add(fill);
  return { root, fill };
}

/** Pleated HEPA cartridge sitting in the top-rear of the bin. */
export function buildHepaFilter(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'hepaFilter';
  const frame = roundedRectXZ(-0.1076, -0.0744, -0.0776, 0.0776, 0.004);
  frame.holes.push(roundedRectHoleXZ(-0.1052, -0.0768, -0.0752, 0.0752, 0.002));
  const b = ctx.builder();
  b.add(extrudeY(frame, 0.0636, 0.0733, { bevel: 0.0004, bevelSegments: 1, curveSegments: q.curve }), mats.lightPlastic);
  b.add(new RoundedBoxGeometry(0.007, 0.0015, 0.022, 1, 0.0006), mats.lightPlastic, mat(-0.0725, 0.0727, 0));
  b.add(pleatSheet(0.0284, 0.1504, q.level === 'low' ? 6 : 10, 0.0078), mats.hepa, mat(-0.091, 0.0648, 0));
  b.build(root, { name: 'hepa' });
  return { root };
}

function tankShape(r: number, half: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI - half, Math.PI + half, false);
  s.closePath();
  return s;
}

/** Rear translucent clean-water tank forming the back of the body; water mesh scales with level. */
export function buildWaterTank(ctx: BuildContext): { root: Group; water: Mesh } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'waterTank';
  const shell = ctx.builder();
  shell.add(extrudeY(tankShape(TANK_OUTER_R, TANK_HALF), 0.0235, 0.0665, { bevel: 0.0026, bevelSegments: q.bevel + 1, curveSegments: q.curve * 2 }), mats.clearPoly);
  shell.build(root, { castShadow: true, name: 'tank-shell', renderOrder: 3 });

  const innerR = TANK_OUTER_R - 0.0032;
  const innerHalf = Math.acos((-(-0.1255) + 0.003) / innerR);
  const water = new Mesh(ctx.track.track(extrudeY(tankShape(innerR, innerHalf), 0, 1, { curveSegments: q.curve * 2 })), mats.waterClean);
  water.name = 'tank-water';
  water.position.y = 0.0262;
  water.renderOrder = 1;
  root.add(water);

  const d = ctx.builder();
  d.add(new CylinderGeometry(0.0065, 0.0065, 0.0016, q.radialSmall), mats.rubberGrey, mat(-R - 0.0004, 0.053, 0, 0, 0, Math.PI / 2));
  d.add(new RoundedBoxGeometry(0.0012, 0.0035, 0.007, 1, 0.0004), mats.rubberGrey, mat(-R - 0.0014, 0.053, 0));
  // Micro-pump and feed lines to the mop pads (visible through the tank).
  d.add(new RoundedBoxGeometry(0.011, 0.011, 0.02, 2, 0.002), mats.graphite, mat(-0.138, 0.032, 0));
  d.build(root, { name: 'tank-detail' });
  const hose = ctx.builder();
  for (const s of [1, -1]) {
    hose.add(tube([new Vector3(-0.134, 0.03, s * 0.009), new Vector3(-0.13, 0.028, s * 0.04), new Vector3(-0.128, 0.0245, s * 0.064)], 0.0018, 16, 6), mats.hoseClean);
  }
  hose.build(root, { name: 'tank-hose' });
  return { root, water };
}
