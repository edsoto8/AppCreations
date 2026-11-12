import { BoxGeometry, CylinderGeometry, Group, Shape, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DOCK, ROBOT } from '../../../sim/robot/robotSpec';
import type { BuildContext } from '../shared/context';
import {
  arcBand,
  extrudeY,
  extrudeZ,
  helixRibbon,
  mat,
  roundedRectHoleXZ,
  roundedRectXZ,
} from '../shared/geometry';
import { BASE_H, BLOWER, HW, TRAY, TX1, VENT_Z, WELL_R } from './layout';

const FRONT = DOCK.baseFrontX;

/** U-shaped base plate (open toward the front), anti-slip well floor and bevelled entry lip. */
export function buildBasePlate(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'basePlate';
  const rc = 0.035;
  // Shape coords are (x, -z).
  const s = new Shape();
  s.moveTo(FRONT, -WELL_R);
  s.lineTo(FRONT, -HW + rc);
  s.quadraticCurveTo(FRONT, -HW, FRONT + rc, -HW);
  s.lineTo(TX1 - 0.012, -HW);
  s.quadraticCurveTo(TX1, -HW, TX1, -HW + 0.012);
  s.lineTo(TX1, HW - 0.012);
  s.quadraticCurveTo(TX1, HW, TX1 - 0.012, HW);
  s.lineTo(FRONT + rc, HW);
  s.quadraticCurveTo(FRONT, HW, FRONT, HW - rc);
  s.lineTo(FRONT, WELL_R);
  s.lineTo(0, WELL_R);
  s.absarc(0, 0, WELL_R, Math.PI / 2, -Math.PI / 2, true);
  s.lineTo(FRONT, -WELL_R);
  const b = ctx.builder();
  b.add(extrudeY(s, 0, BASE_H, { bevel: 0.0028, bevelSegments: q.bevel, curveSegments: q.curve * 3 }), mats.graphite);
  // Polished accent on the well rim.
  b.add(arcBand(WELL_R - 0.0006, WELL_R + 0.0016, BASE_H - 0.0004, BASE_H + 0.0003, 0, Math.PI, Math.ceil(q.radial / 2)), mats.brushedAlu);
  b.build(root, { receiveShadow: true, castShadow: true, name: 'plate' });

  const floor = new Shape();
  floor.moveTo(FRONT + 0.004, WELL_R);
  floor.lineTo(0, WELL_R);
  floor.absarc(0, 0, WELL_R, Math.PI / 2, -Math.PI / 2, true);
  floor.lineTo(FRONT + 0.004, -WELL_R);
  floor.closePath();
  floor.holes.push(roundedRectHoleXZ(TRAY.x0, TRAY.x1, -TRAY.z, TRAY.z, 0.03));
  floor.holes.push(roundedRectHoleXZ(-0.035, -0.005, -0.086, 0.086, 0.004));
  const f = ctx.builder();
  f.add(extrudeY(floor, 0, 0.002, { curveSegments: q.curve * 3 }), mats.dockFloor);
  f.build(root, { receiveShadow: true, name: 'well-floor' });

  const lip = new Shape();
  lip.moveTo(FRONT - 0.006, 0);
  lip.lineTo(FRONT + 0.016, 0);
  lip.lineTo(FRONT + 0.016, 0.0036);
  lip.quadraticCurveTo(FRONT + 0.012, 0.0046, FRONT + 0.006, 0.0042);
  lip.lineTo(FRONT - 0.006, 0.0008);
  lip.closePath();
  const l = ctx.builder();
  l.add(extrudeZ(lip, -WELL_R + 0.001, WELL_R - 0.001, { bevel: 0.0005, bevelSegments: 1 }), mats.brushedAlu);
  l.build(root, { castShadow: true, receiveShadow: true, name: 'lip' });
  return { root };
}

/** Mop wash tray: stainless frame, ribbed basins, spray nozzles, drain grille and a rotating scrubber. */
export function buildWashTray(ctx: BuildContext): { root: Group; scrubber: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'washTray';
  const frame = roundedRectXZ(TRAY.x0 - 0.002, TRAY.x1 + 0.002, -TRAY.z - 0.002, TRAY.z + 0.002, 0.032);
  frame.holes.push(roundedRectHoleXZ(TRAY.x0 + 0.004, TRAY.x1 - 0.004, -TRAY.z + 0.004, TRAY.z - 0.004, 0.026));
  const b = ctx.builder();
  b.add(extrudeY(frame, 0, 0.0055, { bevel: 0.0012, bevelSegments: q.bevel, curveSegments: q.curve }), mats.titanium);
  b.add(extrudeY(roundedRectXZ(TRAY.x0, TRAY.x1, -TRAY.z, TRAY.z, 0.03), 0, 0.0009, { curveSegments: q.curve }), mats.charcoal);
  const ribs = ctx.builder();
  for (const s of [1, -1]) {
    const cz = s * ROBOT.mopZ;
    for (const r of [0.018, 0.033, 0.048]) {
      ribs.add(arcBand(r - 0.0008, r + 0.0008, 0.0008, 0.0032, 0, Math.PI * 2, Math.ceil(q.radial / 3)), mats.titanium, mat(ROBOT.mopX, 0, cz));
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      ribs.add(new BoxGeometry(0.044, 0.0024, 0.0014), mats.titanium, mat(ROBOT.mopX + Math.cos(a) * 0.035, 0.002, cz - Math.sin(a) * 0.035, 0, a, 0));
    }
    // Side spray nozzles.
    ribs.add(new CylinderGeometry(0.0028, 0.0034, 0.005, q.radialSmall), mats.chrome, mat(ROBOT.mopX, 0.0035, s * (TRAY.z - 0.006), Math.PI / 2, 0, 0));
  }
  ribs.add(new CylinderGeometry(0.0028, 0.0034, 0.005, q.radialSmall), mats.chrome, mat(ROBOT.mopX, 0.0035, 0));
  // Drain grille.
  for (let k = 0; k < 7; k++) {
    b.add(new BoxGeometry(0.0015, 0.0006, 0.026), mats.blackMatte, mat(-0.038 - k * 0.003, 0.001, 0));
  }
  b.build(root, { receiveShadow: true, name: 'tray' });
  ribs.build(root, { name: 'tray-ribs' });

  const scrubber = new Group();
  scrubber.position.set(TRAY.x0 + 0.0085, 0.0042, 0);
  root.add(scrubber);
  const sc = ctx.builder();
  const toZ = mat(0, 0, 0, Math.PI / 2, 0, 0);
  sc.add(new CylinderGeometry(0.0022, 0.0022, 0.22, q.radialSmall), mats.titanium, toZ.clone());
  for (let k = 0; k < 3; k++) sc.add(helixRibbon(0.002, 0.0036, 0.214, 2.2, (k / 3) * Math.PI * 2, q.level === 'low' ? 24 : 72, 0.2), mats.rubberDouble, toZ.clone());
  sc.build(scrubber, { name: 'scrubber' });
  return { root, scrubber };
}

/** Drying louvres beside the pads plus the heated blower inside the tower base. */
export function buildDryingVents(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'dryingVents';
  const b = ctx.builder();
  const glow = ctx.builder();
  for (const s of [1, -1]) {
    const z = s * VENT_Z;
    const housing = roundedRectXZ(-0.155, -0.045, z - 0.011, z + 0.011, 0.008);
    housing.holes.push(roundedRectHoleXZ(-0.15, -0.05, z - 0.0075, z + 0.0075, 0.005));
    b.add(extrudeY(housing, 0, 0.0065, { bevel: 0.0012, bevelSegments: q.bevel, curveSegments: q.curve }), mats.graphite);
    glow.add(new BoxGeometry(0.1, 0.0008, 0.015), mats.warmGlow, mat(-0.1, 0.0012, z));
    for (let k = 0; k < 13; k++) {
      b.add(new BoxGeometry(0.0014, 0.0048, 0.0152), mats.titanium, mat(-0.146 + k * 0.0076, 0.0036, z, 0, 0, 0.45));
    }
  }
  // Blower + PTC heater in the tower base.
  b.add(new CylinderGeometry(0.028, 0.028, 0.026, q.radialSmall * 2), mats.graphite, mat(BLOWER.x, BLOWER.y, BLOWER.z));
  b.add(new CylinderGeometry(0.012, 0.012, 0.012, q.radialSmall * 2), mats.steel, mat(BLOWER.x, BLOWER.y + 0.019, BLOWER.z));
  b.add(new RoundedBoxGeometry(0.03, 0.022, 0.02, 2, 0.003), mats.graphite, mat(BLOWER.x - 0.04, BLOWER.y - 0.006, BLOWER.z));
  for (let k = 0; k < 6; k++) {
    b.add(new BoxGeometry(0.001, 0.02, 0.018), mats.brushedAlu, mat(BLOWER.x - 0.065 + k * 0.004, BLOWER.y - 0.006, BLOWER.z));
  }
  b.build(root, { castShadow: true, receiveShadow: true, name: 'vents' });
  glow.build(root, { name: 'vent-glow' });
  return { root };
}

/** Spring-blade charging contacts on two pedestals with status LEDs. */
export function buildDockContacts(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'chargingContacts';
  const b = ctx.builder();
  const glow = ctx.builder();
  for (const s of [1, -1]) {
    const z = s * 0.035;
    b.add(new RoundedBoxGeometry(0.032, 0.014, 0.017, 3, 0.004), mats.graphite, mat(ROBOT.chargeContactX, 0.007, z));
    for (const dz of [-0.0035, 0.0035]) {
      b.add(new TorusGeometry(0.0058, 0.0011, 6, q.radialSmall, Math.PI), mats.gold, mat(ROBOT.chargeContactX, 0.0135, z + dz));
    }
    glow.add(new RoundedBoxGeometry(0.0016, 0.003, 0.009, 1, 0.0006), mats.contactGlow, mat(ROBOT.chargeContactX - 0.016, 0.008, z));
  }
  b.build(root, { castShadow: true, name: 'contacts' });
  glow.build(root, { name: 'contact-glow' });
  return { root };
}
