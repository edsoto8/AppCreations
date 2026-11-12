import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Shape,
  TorusGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { BuildContext } from '../shared/context';
import {
  arcBand,
  circleHoleXZ,
  extrudeY,
  lathe,
  mat,
  roundedRectHoleXZ,
  roundedRectPath,
  roundedRectXZ,
  screwHeadGeometry,
} from '../shared/geometry';
import {
  BUMPER_PHI0,
  BUMPER_PHI_LEN,
  PHI_FWD,
  PHI_REAR,
  R,
  TANK_HALF,
  WHEEL_Z,
  Y,
  phiOf,
} from './layout';

const WELL_X = 0.044;
const WELL_Z0 = WHEEL_Z - 0.016;
const WELL_Z1 = WHEEL_Z + 0.016;
export const INTAKE = { x0: -0.05, x1: 0.01, z: 0.114 } as const;
const PAN_R = 0.166;
const PAN_CHORD_X = -0.124;

/** Underside pan, side shell, wheel wells, intake chamber, exhaust vents and underside screws. */
export function buildChassis(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'chassis';

  // --- Underside pan (chord-cut at the rear where the water tank sits) with functional openings.
  const pan = new Shape();
  const a = Math.PI - Math.acos(-PAN_CHORD_X / PAN_R);
  pan.absarc(0, 0, PAN_R, -a, a, false);
  pan.closePath();
  for (const s of [1, -1]) pan.holes.push(roundedRectHoleXZ(-WELL_X, WELL_X, s > 0 ? WELL_Z0 : -WELL_Z1, s > 0 ? WELL_Z1 : -WELL_Z0, 0.008));
  pan.holes.push(roundedRectHoleXZ(INTAKE.x0, INTAKE.x1, -INTAKE.z, INTAKE.z, 0.008));
  pan.holes.push(circleHoleXZ(ROBOT.casterOffsetX, 0, 0.017));
  const shell = ctx.builder();
  shell.add(extrudeY(pan, Y.pan0, Y.pan1, { bevel: 0.0016, bevelSegments: q.bevel, curveSegments: q.curve * 2 }), mats.charcoal);

  // Battery access door (slightly proud) and moulded skid ribs.
  shell.add(extrudeY(roundedRectXZ(0.028, 0.112, -0.062, 0.062, 0.01), Y.pan0 - 0.0006, Y.pan0 + 0.001, { bevel: 0.0004, bevelSegments: 1, curveSegments: q.curve }), mats.graphite);
  for (const s of [1, -1]) {
    shell.add(extrudeY(roundedRectXZ(-0.03, 0.06, s * 0.145 - 0.006, s * 0.145 + 0.006, 0.006), Y.pan0 - 0.0008, Y.pan0 + 0.001, { bevel: 0.0005, bevelSegments: 1 }), mats.graphite);
  }
  shell.build(root, { receiveShadow: true, xray: true, name: 'pan' });

  // --- Side shell behind the bumper (both flanks, leaving the rear for the translucent tank).
  const sideProfile = [[0.166, Y.shell0], [R, Y.shell0, 0.006], [R, Y.shellTop, 0.002], [R - 0.004, Y.shellTop]] as const;
  const gap = 0.006;
  const sideA0 = BUMPER_PHI0 + BUMPER_PHI_LEN + gap;
  const sideA1 = PHI_REAR - TANK_HALF - 0.002;
  const sideB0 = PHI_REAR + TANK_HALF + 0.002;
  const sideB1 = BUMPER_PHI0 + Math.PI * 2 - gap;
  const sides = ctx.builder();
  sides.add(lathe(sideProfile, Math.ceil(q.radial / 4), q.fillet, sideA0, sideA1 - sideA0), mats.pearl);
  sides.add(lathe(sideProfile, Math.ceil(q.radial / 4), q.fillet, sideB0, sideB1 - sideB0), mats.pearl);
  sides.build(root, { castShadow: true, receiveShadow: true, xray: true, name: 'side-shell' });

  // --- Dark inner core (visible through panel seams), wheel wells and the brush chamber.
  const core = ctx.builder();
  const coreA = PHI_REAR + TANK_HALF;
  core.add(new CylinderGeometry(0.1715, 0.1715, Y.coverStart + 0.006 - Y.shell0, q.radial, 1, true, coreA, Math.PI * 2 - 2 * TANK_HALF), mats.blackMatte, mat(0, (Y.coverStart + 0.006 + Y.shell0) / 2, 0));
  core.add(new BoxGeometry(0.0012, 0.042, 0.236), mats.blackMatte, mat(-0.1265, 0.046, 0));
  for (const s of [1, -1]) {
    const zc = s * WHEEL_Z;
    const h = 0.074 - Y.pan1;
    const yc = Y.pan1 + h / 2;
    core.add(new BoxGeometry(2 * WELL_X, 0.0015, WELL_Z1 - WELL_Z0), mats.blackMatte, mat(0, 0.074, zc));
    core.add(new BoxGeometry(0.0015, h, WELL_Z1 - WELL_Z0), mats.blackMatte, mat(WELL_X, yc, zc));
    core.add(new BoxGeometry(0.0015, h, WELL_Z1 - WELL_Z0), mats.blackMatte, mat(-WELL_X, yc, zc));
    core.add(new BoxGeometry(2 * WELL_X, h, 0.0015), mats.blackMatte, mat(0, yc, s * WELL_Z0));
    core.add(new BoxGeometry(2 * WELL_X, h, 0.0015), mats.blackMatte, mat(0, yc, s * WELL_Z1));
  }
  const chamberH = 0.034 - Y.pan1;
  const icx = (INTAKE.x0 + INTAKE.x1) / 2;
  core.add(new BoxGeometry(INTAKE.x1 - INTAKE.x0, 0.0015, INTAKE.z * 2), mats.blackMatte, mat(icx, 0.034, 0));
  core.add(new BoxGeometry(0.0015, chamberH, INTAKE.z * 2), mats.blackMatte, mat(INTAKE.x0, Y.pan1 + chamberH / 2, 0));
  core.add(new BoxGeometry(0.0015, chamberH, INTAKE.z * 2), mats.blackMatte, mat(INTAKE.x1, Y.pan1 + chamberH / 2, 0));
  core.build(root, { xray: true, name: 'core' });

  // --- Intake guard frame.
  const frame = new Shape();
  roundedRectPath(frame, INTAKE.x0 - 0.006, -INTAKE.z - 0.006, INTAKE.x1 + 0.006, INTAKE.z + 0.006, 0.012);
  frame.holes.push(roundedRectHoleXZ(INTAKE.x0, INTAKE.x1, -INTAKE.z, INTAKE.z, 0.008));
  const trim = ctx.builder();
  trim.add(extrudeY(frame, Y.pan0 - 0.0025, Y.pan0 + 0.0005, { bevel: 0.0008, bevelSegments: q.bevel, curveSegments: q.curve }), mats.titanium);
  for (const s of [1, -1]) {
    trim.add(new RoundedBoxGeometry(0.014, 0.003, 0.006, 2, 0.001), mats.titanium, mat(icx, Y.pan0 - 0.0018, s * (INTAKE.z + 0.003)));
  }

  // --- Exhaust vent inserts on both rear flanks.
  const ventSpan = 0.42;
  const slatSegs = Math.ceil(q.radial / 10);
  const glow = ctx.builder();
  for (const centre of [phiOf((Math.PI * 2) / 3), phiOf((-Math.PI * 2) / 3)]) {
    const p0 = centre - ventSpan / 2;
    trim.add(arcBand(R - 0.002, R + 0.0022, 0.0315, 0.0335, p0, ventSpan, slatSegs), mats.titanium);
    trim.add(arcBand(R - 0.002, R + 0.0022, 0.0595, 0.0615, p0, ventSpan, slatSegs), mats.titanium);
    trim.add(arcBand(R - 0.002, R + 0.0022, 0.0315, 0.0615, p0 - 0.03, 0.03, 2), mats.titanium);
    trim.add(arcBand(R - 0.002, R + 0.0022, 0.0315, 0.0615, p0 + ventSpan, 0.03, 2), mats.titanium);
    for (let k = 0; k < 5; k++) {
      const y = 0.0365 + k * 0.0048;
      trim.add(arcBand(R + 0.0002, R + 0.0019, y, y + 0.0019, p0, ventSpan, slatSegs), mats.titanium);
    }
    trim.add(arcBand(R - 0.001, R + 0.0003, 0.0335, 0.0595, p0, ventSpan, slatSegs), mats.blackMatte);
    glow.add(arcBand(R + 0.0003, R + 0.0005, 0.035, 0.058, p0, ventSpan, slatSegs), mats.ventGlow);
  }
  trim.build(root, { castShadow: true, name: 'trim' });
  glow.build(root, { name: 'vent-glow' });

  // --- Underside screws (one instanced draw call).
  if (q.detail) {
    const screwPos: [number, number][] = [
      [0.032, 0.056], [0.032, -0.056], [0.108, 0.056], [0.108, -0.056],
      [0.03, 0.15], [0.03, -0.15], [-0.07, 0.137], [-0.07, -0.137],
      [-0.152, 0.03], [-0.152, -0.03], [0.14, 0.09], [0.14, -0.09],
    ];
    const screws = new InstancedMesh(ctx.track.track(screwHeadGeometry(0.0021, 0.0009, q.radialSmall)), mats.screw, screwPos.length);
    const m = new Matrix4();
    screwPos.forEach(([x, z], i) => {
      m.copy(mat(x, Y.pan0 - (x > 0.02 && x < 0.12 && Math.abs(z) < 0.07 ? 0.0006 : 0), z, Math.PI, 0, 0));
      screws.setMatrixAt(i, m);
    });
    screws.name = 'screws';
    root.add(screws);
  }
  return { root };
}

/** Top cover: chamfered pearl outer ring, gloss inner deck and the hinged dust-bin lid. */
export function buildTopCover(ctx: BuildContext): { root: Group; lid: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'topCover';

  const ring = ctx.builder();
  ring.add(
    lathe(
      [[0.1715, Y.coverStart], [R, Y.coverStart, 0.0015], [R, 0.0705, 0.0025], [0.1625, Y.top - 0.0005, 0.004], [0.1572, Y.top - 0.0002, 0.0008], [0.1566, Y.ledFloor]],
      q.radial,
      q.fillet,
    ),
    mats.pearl,
  );
  ring.build(root, { castShadow: true, receiveShadow: true, xray: true, name: 'cover-ring' });

  // Inner deck with LiDAR opening and bin-lid opening.
  const deck = new Shape();
  deck.absarc(0, 0, 0.1488, 0, Math.PI * 2, false);
  deck.holes.push(circleHoleXZ(ROBOT.lidarOffsetX, 0, 0.0458));
  deck.holes.push(roundedRectHoleXZ(-0.112, -0.016, -0.084, 0.084, 0.016));
  const d = ctx.builder();
  d.add(extrudeY(deck, 0.0742, Y.top + 0.0002, { bevel: 0.0013, bevelSegments: q.bevel, curveSegments: q.curve * 2 }), mats.gloss);
  // Speaker grille micro-perforation.
  if (q.detail) {
    for (let i = -3; i <= 3; i++) {
      for (let j = -2; j <= 2; j++) {
        const x = 0.075 + j * 0.0034 + (i % 2 === 0 ? 0 : 0.0017);
        const z = -0.098 + i * 0.003;
        d.add(new CylinderGeometry(0.0007, 0.0007, 0.0004, 8), mats.blackMatte, mat(x, Y.top + 0.0001, z));
      }
    }
  }
  // Hinge barrel for the lid.
  d.add(new CylinderGeometry(0.0022, 0.0022, 0.07, q.radialSmall), mats.titanium, mat(-0.1112, 0.0796, 0, Math.PI / 2, 0, 0));
  d.build(root, { castShadow: true, receiveShadow: true, xray: true, name: 'deck' });

  // Lid hinged on its rear edge.
  const lid = new Group();
  lid.name = 'binLid';
  lid.position.set(-0.1112, Y.top + 0.0002, 0);
  root.add(lid);
  const l = ctx.builder();
  const lidGeo = extrudeY(roundedRectXZ(-0.1112, -0.0168, -0.0832, 0.0832, 0.0152), 0.0745, Y.top + 0.0002, { bevel: 0.0013, bevelSegments: q.bevel, curveSegments: q.curve });
  lidGeo.translate(0.1112, -(Y.top + 0.0002), 0);
  l.add(lidGeo, mats.gloss);
  l.build(lid, { castShadow: true, xray: true, name: 'lid' });
  const inlay = ctx.builder();
  inlay.add(new RoundedBoxGeometry(0.003, 0.0008, 0.06, 1, 0.0003), mats.champagne, mat(0.1112 - 0.0215, 0.0002, 0));
  inlay.add(new BoxGeometry(0.06, 0.0008, 0.12), mats.blackMatte, mat(0.047, -0.0074, 0));
  inlay.build(lid, { name: 'lid-inlay' });
  return { root, lid };
}

/** Two physical buttons (power / dock) with backlit icons. */
export function buildButtons(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'buttons';
  const b = ctx.builder();
  for (const s of [1, -1]) {
    const z = s * 0.024;
    b.add(extrudeY(roundedRectXZ(0.1005, 0.1195, z - 0.0055, z + 0.0055, 0.0055), Y.top, Y.top + 0.0006, { curveSegments: q.curve }), mats.blackMatte);
    b.add(extrudeY(roundedRectXZ(0.1015, 0.1185, z - 0.0045, z + 0.0045, 0.0045), Y.top + 0.0004, Y.top + 0.0017, { bevel: 0.0005, bevelSegments: q.bevel, curveSegments: q.curve }), mats.brushedAlu);
  }
  b.add(new TorusGeometry(0.0022, 0.00035, 6, q.radialSmall, Math.PI * 1.6), mats.iconGlow, mat(0.11, Y.top + 0.0018, 0.024, -Math.PI / 2, 0, Math.PI / 2 + Math.PI * 0.2));
  b.add(new BoxGeometry(0.0026, 0.0003, 0.0007), mats.iconGlow, mat(0.1112, Y.top + 0.0018, 0.024));
  const house = new Shape();
  house.moveTo(0.0026, 0);
  house.lineTo(0.0002, 0.0024);
  house.lineTo(-0.0022, 0);
  house.lineTo(-0.0022, -0.0022);
  house.lineTo(0.0026, -0.0022);
  house.closePath();
  b.add(extrudeY(house, Y.top + 0.0017, Y.top + 0.0020), mats.iconGlow, mat(0.11, 0, -0.024));
  b.build(root, { castShadow: true, name: 'buttons' });
  return { root };
}

/** Front bumper shell with rubber impact strip and internal micro-switches. Animated via `move`. */
export function buildBumper(ctx: BuildContext): { root: Group; move: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'bumper';
  const move = new Group();
  root.add(move);
  const seg = Math.ceil(q.radial * 0.6);
  const b = ctx.builder();
  b.add(lathe([[0.166, Y.shell0], [R + 0.0005, Y.shell0, 0.006], [R + 0.0005, Y.shellTop, 0.0025], [0.17, Y.shellTop]], seg, q.fillet, BUMPER_PHI0, BUMPER_PHI_LEN), mats.pearl);
  b.build(move, { castShadow: true, receiveShadow: true, xray: true, name: 'bumper-shell' });
  const r = ctx.builder();
  r.add(lathe([[R + 0.0002, 0.0385], [R + 0.0022, 0.039, 0.0008], [R + 0.0022, 0.0455, 0.0008], [R + 0.0002, 0.046]], seg, q.fillet, BUMPER_PHI0 + 0.03, BUMPER_PHI_LEN - 0.06), mats.rubber);
  // Bumper micro-switches (visible in x-ray / exploded view).
  for (const ang of [0.8, -0.8]) {
    const phi = phiOf(ang);
    const x = 0.158 * Math.sin(phi);
    const z = 0.158 * Math.cos(phi);
    r.add(new RoundedBoxGeometry(0.008, 0.006, 0.012, 1, 0.001), mats.graphite, mat(x, 0.045, z, 0, phi, 0));
    r.add(new CylinderGeometry(0.0012, 0.0012, 0.006, 8), mats.steel, mat(x * 1.035, 0.045, z * 1.035, Math.PI / 2, phi, 0, 1, 'YXZ'));
  }
  r.build(move, { castShadow: true, name: 'bumper-detail' });
  return { root, move };
}

/** Front sensor fascia: RGB camera, two structured-light emitters and a ToF receiver behind black glass. */
export function buildCamera(ctx: BuildContext): { root: Group; move: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'camera';
  const move = new Group();
  root.add(move);
  const half = 0.25;
  const b = ctx.builder();
  b.add(lathe([[R + 0.0003, 0.0495], [R + 0.0016, 0.0497, 0.0008], [R + 0.0016, 0.0605, 0.0008], [R + 0.0003, 0.0607]], Math.ceil(q.radial / 6), q.fillet, PHI_FWD - half, half * 2), mats.darkGlass);
  const lensAt = (dir: number, r: number, m: Material, depth: number): void => {
    const phi = phiOf(dir);
    const rr = R + 0.0016 + depth / 2;
    b.add(new CylinderGeometry(r, r, depth, q.radialSmall), m, mat(rr * Math.sin(phi), 0.0551, rr * Math.cos(phi), Math.PI / 2, phi, 0, 1, 'YXZ'));
  };
  lensAt(0, 0.0046, mats.titanium, 0.0008);
  lensAt(0, 0.0036, mats.lens, 0.0012);
  lensAt(0.11, 0.0022, mats.irGlow, 0.0006);
  lensAt(-0.11, 0.0022, mats.irGlow, 0.0006);
  lensAt(0.19, 0.0018, mats.lens, 0.0006);
  lensAt(-0.19, 0.0013, mats.titanium, 0.0005);
  b.build(move, { castShadow: false, name: 'camera' });
  return { root, move };
}

/** Six downward IR cliff sensors. */
export function buildCliffSensors(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'cliffSensors';
  const b = ctx.builder();
  for (const p of ROBOT.cliffSensors) {
    const yaw = Math.atan2(-p.z, p.x);
    const m = mat(p.x, 0, p.z, 0, yaw, 0);
    const bezel = extrudeY(roundedRectXZ(-0.004, 0.004, -0.0075, 0.0075, 0.003), Y.pan0 - 0.0016, Y.pan0 + 0.0004, { bevel: 0.0004, bevelSegments: 1, curveSegments: q.curve });
    b.add(bezel, mats.graphite, m);
    b.add(extrudeY(roundedRectXZ(-0.0028, 0.0028, -0.0062, 0.0062, 0.0022), Y.pan0 - 0.0019, Y.pan0 - 0.0012, { curveSegments: q.curve }), mats.darkGlass, m);
    for (const s of [1, -1]) {
      b.add(new CylinderGeometry(0.0013, 0.0013, 0.0004, q.radialSmall), mats.lens, mat(0, Y.pan0 - 0.002, s * 0.0033).premultiply(m));
    }
  }
  b.build(root, { name: 'cliff' });
  return { root };
}

/** Gold-plated charging contacts on the front underside. */
export function buildChargeContacts(ctx: BuildContext): { root: Group } {
  const { mats } = ctx;
  const root = new Group();
  root.name = 'chargingContacts';
  const b = ctx.builder();
  for (const s of [1, -1]) {
    b.add(new RoundedBoxGeometry(0.026, 0.0016, 0.012, 1, 0.0005), mats.blackMatte, mat(ROBOT.chargeContactX, Y.pan0 - 0.0006, s * 0.035));
    b.add(new RoundedBoxGeometry(0.02, 0.0016, 0.0065, 2, 0.0006), mats.gold, mat(ROBOT.chargeContactX, Y.pan0 - 0.0013, s * 0.035));
  }
  b.build(root, { name: 'contacts' });
  return { root };
}
