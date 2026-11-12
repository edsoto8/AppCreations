import { BoxGeometry, CylinderGeometry, Group } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { BuildContext } from '../shared/context';
import { extrudeY, helixRibbon, lathe, mat, roundedRectXZ } from '../shared/geometry';
import { createRng } from '../shared/rng';

/** Three-arm side brush with splayed nylon bristle fans. `spin` rotates about +Y. */
export function buildSideBrush(ctx: BuildContext): { root: Group; spin: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'sideBrush';
  root.position.set(ROBOT.sideBrushX, 0, ROBOT.sideBrushZ);
  const fixed = ctx.builder();
  fixed.add(lathe([[0.0135, 0.017], [0.0135, 0.0205, 0.001], [0, 0.0205]], q.radialSmall * 2, q.fillet), mats.charcoal);
  fixed.build(root, { name: 'sb-motor' });

  const spin = new Group();
  spin.position.y = 0.0148;
  root.add(spin);
  const b = ctx.builder();
  b.add(lathe([[0, -0.0026], [0.0115, -0.0026, 0.0012], [0.0115, 0.0012, 0.0012], [0.006, 0.0026, -1], [0, 0.003]], q.radialSmall * 2, q.fillet), mats.graphite);
  b.add(new CylinderGeometry(0.0038, 0.0038, 0.0008, q.radialSmall), mats.titanium, mat(0, -0.003, 0));
  const rnd = createRng(17);
  const tipR = ROBOT.sideBrushRadius;
  const rootR = 0.029;
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2;
    b.add(new RoundedBoxGeometry(0.025, 0.0028, 0.0052, 1, 0.001), mats.graphite, mat(Math.cos(a0) * 0.019, -0.0012, -Math.sin(a0) * 0.019, 0, a0, 0));
    b.add(new CylinderGeometry(0.0032, 0.0032, 0.0042, q.radialSmall), mats.titanium, mat(Math.cos(a0) * rootR, -0.0012, -Math.sin(a0) * rootR));
    for (let j = 0; j < q.sideBristles; j++) {
      const a = a0 + (rnd() - 0.5) * 0.42 - 0.1;
      const reach = tipR - rootR - rnd() * 0.006;
      const drop = 0.0118 + rnd() * 0.0018;
      const len = Math.hypot(reach, drop);
      const beta = Math.atan2(drop, reach);
      const sx = Math.cos(a0) * rootR;
      const sz = -Math.sin(a0) * rootR;
      const cx = sx + Math.cos(a) * Math.cos(beta) * (len / 2);
      const cz = sz - Math.sin(a) * Math.cos(beta) * (len / 2);
      const cy = -0.0012 - Math.sin(beta) * (len / 2);
      b.add(new BoxGeometry(len, 0.001, 0.001), j % 5 === 0 ? mats.bristleAccent : mats.bristle, mat(cx, cy, cz, 0, a, -beta));
    }
  }
  b.build(spin, { castShadow: true, name: 'sb-spin' });
  return { root, spin };
}

/** Dual counter-rotating main rollers: bristle helix (front) and rubber chevron flaps (rear). */
export function buildMainBrushes(ctx: BuildContext): { root: Group; front: Group; rear: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'mainBrush';
  const len = ROBOT.mainBrushWidth - 0.006;
  const yC = 0.0145;
  const toZ = mat(0, 0, 0, Math.PI / 2, 0, 0);
  const makeRoller = (x: number, kind: 'bristle' | 'rubber'): Group => {
    const g = new Group();
    g.position.set(x, yC, 0);
    root.add(g);
    const b = ctx.builder();
    const add = (geo: Parameters<typeof b.add>[0], m: Parameters<typeof b.add>[1], local = mat(0, 0, 0)): void => {
      b.add(geo, m, local.premultiply(toZ));
    };
    add(new CylinderGeometry(0.0068, 0.0068, len, q.radialSmall * 2), kind === 'bristle' ? mats.graphite : mats.rubberGrey);
    for (const s of [1, -1]) {
      add(lathe([[0, -0.0016], [0.0104, -0.0016, 0.0006], [0.0104, 0.0016, 0.0006], [0, 0.0016]], q.radialSmall * 2, 1), mats.titanium, mat(0, s * (len / 2 + 0.0016), 0));
    }
    if (kind === 'bristle') {
      const tuft = new BoxGeometry(0.0013, 0.0013, 0.0048);
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < q.rollerTufts; i++) {
          const t = i / (q.rollerTufts - 1);
          const y = -len / 2 + 0.003 + t * (len - 0.006);
          const psi = row * Math.PI + t * Math.PI * 2 * 1.15;
          const r = 0.0068 + 0.0023;
          add(tuft.clone(), i % 4 === 0 ? mats.bristleAccent : mats.bristle, mat(Math.sin(psi) * r, y, Math.cos(psi) * r, 0, psi, 0));
        }
      }
      tuft.dispose();
    } else {
      for (let k = 0; k < 2; k++) {
        add(helixRibbon(0.0066, 0.0115, len * 0.98, 1.05, k * Math.PI, q.level === 'low' ? 24 : 64), mats.rubberDouble);
      }
    }
    b.build(g, { name: `roller-${kind}` });
    return g;
  };
  const front = makeRoller(ROBOT.mainBrushX + 0.0125, 'bristle');
  const rear = makeRoller(ROBOT.mainBrushX - 0.0115, 'rubber');
  return { root, front, rear };
}

const MOP_LIFTED_BOTTOM = 0.0085;

/** Twin rotating microfiber mop pads on a lift linkage. `lower` drops; `pads[i]` spin about +Y. */
export function buildMopModule(ctx: BuildContext): { root: Group; lower: Group; pads: [Group, Group] } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'mopPads';
  const fixed = ctx.builder();
  fixed.add(extrudeY(roundedRectXZ(-0.116, -0.084, -0.056, 0.056, 0.01), 0.0172, 0.0204, { bevel: 0.0008, bevelSegments: q.bevel, curveSegments: q.curve }), mats.graphite);
  for (const s of [1, -1]) {
    fixed.add(lathe([[0, 0.0168], [0.0135, 0.0168, 0.0012], [0.0135, 0.0206]], q.radialSmall * 2, q.fillet), mats.graphite, mat(ROBOT.mopX, 0, s * ROBOT.mopZ));
  }
  fixed.build(root, { name: 'mop-bracket' });

  const lower = new Group();
  root.add(lower);
  const pads: Group[] = [];
  for (const s of [1, -1]) {
    const pad = new Group();
    pad.position.set(ROBOT.mopX, 0, s * ROBOT.mopZ);
    lower.add(pad);
    pads.push(pad);
    const b = ctx.builder();
    const r = ROBOT.mopRadius - 0.0015;
    const y0 = MOP_LIFTED_BOTTOM;
    const padH = 0.0063;
    b.add(new CylinderGeometry(r - 0.0008, r, padH, q.radial / 2), mats.microfiber, mat(0, y0 + padH / 2, 0));
    const p0 = y0 + padH;
    b.add(lathe([[0, p0 - 0.0002], [r - 0.0012, p0 - 0.0002, 0.0008], [r - 0.0010, p0 + 0.0026, 0.0012], [0.05, p0 + 0.003, -1], [0, p0 + 0.003]], q.radial / 2, q.fillet), mats.graphite);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.add(new BoxGeometry(0.034, 0.0016, 0.0018), mats.graphite, mat(Math.cos(a) * 0.031, p0 + 0.0036, -Math.sin(a) * 0.031, 0, a, 0));
    }
    b.add(lathe([[0.0122, p0 + 0.0028], [0.0122, p0 + 0.0042, 0.001], [0.008, p0 + 0.0052, -1], [0, p0 + 0.0054]], q.radialSmall * 2, q.fillet), mats.titanium);
    b.add(new CylinderGeometry(0.0042, 0.0042, 0.012, q.radialSmall), mats.titanium, mat(0, p0 + 0.008, 0));
    b.build(pad, { castShadow: true, name: 'mop-pad' });
  }
  return { root, lower, pads: [pads[0], pads[1]] };
}
