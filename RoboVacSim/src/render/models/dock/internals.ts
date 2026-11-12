import { BoxGeometry, CylinderGeometry, Group, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuildContext } from '../shared/context';
import { lathe, mat, tube } from '../shared/geometry';
import { DECK_TOP, DUCT_X, MOTOR, TX0, TX1 } from './layout';

/** Control points of the self-empty air path (inlet slot -> under-plate channel -> duct -> bag). */
export const DUST_PATH: readonly Vector3[] = [
  new Vector3(-0.02, 0.004, 0),
  new Vector3(0.08, 0.006, 0),
  new Vector3(0.19, 0.012, 0),
  new Vector3(TX0 + 0.01, 0.026, 0),
  new Vector3(0.25, 0.034, 0),
  new Vector3(0.288, 0.07, 0),
  new Vector3(DUCT_X, 0.13, 0),
  new Vector3(DUCT_X, 0.26, 0),
  new Vector3(DUCT_X, DECK_TOP + 0.01, 0),
  new Vector3(0.33, 0.39, 0),
];

/** Visible in-tower portion of the duct. */
const DUCT_TUBE: readonly Vector3[] = [
  new Vector3(TX0 + 0.012, 0.026, 0),
  new Vector3(0.25, 0.034, 0),
  new Vector3(0.288, 0.07, 0),
  new Vector3(DUCT_X, 0.13, 0),
  new Vector3(DUCT_X, 0.26, 0),
  new Vector3(DUCT_X, DECK_TOP + 0.002, 0),
];

export const CLEAN_HOSE: readonly Vector3[] = [
  new Vector3(0.4, DECK_TOP - 0.002, 0.13),
  new Vector3(0.39, 0.3, 0.13),
  new Vector3(0.34, 0.262, 0.125),
  new Vector3(0.3, 0.262, 0.125),
  new Vector3(0.245, 0.2, 0.125),
  new Vector3(0.232, 0.12, 0.15),
  new Vector3(0.218, 0.04, 0.16),
  new Vector3(TX0 + 0.006, 0.016, 0.16),
];

export const DIRTY_HOSE: readonly Vector3[] = [
  new Vector3(TX0 + 0.006, 0.016, -0.16),
  new Vector3(0.222, 0.05, -0.155),
  new Vector3(0.232, 0.12, -0.145),
  new Vector3(0.245, 0.2, -0.125),
  new Vector3(0.3, 0.29, -0.13),
  new Vector3(0.38, 0.318, -0.13),
  new Vector3(0.4, DECK_TOP - 0.002, -0.13),
];

/** Inlet slot with sealing lips, the in-tower duct and the bag-to-motor exhaust duct. */
export function buildSuctionDuct(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'suctionDuct';
  const b = ctx.builder();
  b.add(new BoxGeometry(0.028, 0.0008, 0.17), mats.blackMatte, mat(-0.02, 0.0004, 0));
  for (const x of [-0.033, -0.007]) {
    b.add(new RoundedBoxGeometry(0.003, 0.0045, 0.172, 1, 0.001), mats.rubber, mat(x, 0.0022, 0));
  }
  b.build(root, { name: 'inlet' });
  const d = ctx.builder();
  d.add(tube(DUCT_TUBE, 0.017, q.level === 'low' ? 24 : 64, q.radialSmall * 2), mats.smokePoly);
  d.add(tube([new Vector3(0.42, DECK_TOP - 0.002, -0.03), new Vector3(0.415, 0.24, -0.04), new Vector3(0.39, 0.17, -0.065), new Vector3(MOTOR.x, 0.142, MOTOR.z)], 0.013, 32, q.radialSmall * 2), mats.smokePoly);
  d.build(root, { name: 'duct', renderOrder: 2 });
  const r = ctx.builder();
  for (const y of [0.15, 0.2, 0.25, 0.3]) {
    r.add(new TorusGeometry(0.0178, 0.0018, 8, q.radialSmall * 2), mats.titanium, mat(DUCT_X, y, 0, Math.PI / 2, 0, 0));
  }
  r.add(new RoundedBoxGeometry(0.03, 0.006, 0.05, 2, 0.002), mats.titanium, mat(DUCT_X, 0.1, 0));
  r.build(root, { name: 'duct-rings' });
  return { root };
}

/** Finned evacuation motor with a visible impeller (spins) on rubber isolation mounts. */
export function buildVacuumMotor(ctx: BuildContext): { root: Group; impeller: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'vacuumMotor';
  root.position.set(MOTOR.x, 0, MOTOR.z);
  const b = ctx.builder();
  b.add(lathe([[0.03, 0.03], [0.044, 0.03, 0.003], [0.044, 0.1, 0.003], [0.04, 0.102]], q.radialSmall * 3, q.fillet), mats.brushedAlu);
  const fins = q.level === 'low' ? 16 : 28;
  for (let k = 0; k < fins; k++) {
    const a = (k / fins) * Math.PI * 2;
    b.add(new BoxGeometry(0.0012, 0.058, 0.01), mats.brushedAlu, mat(Math.sin(a) * 0.048, 0.064, Math.cos(a) * 0.048, 0, a, 0));
  }
  b.add(new CylinderGeometry(0.046, 0.046, 0.004, q.radialSmall * 3), mats.graphite, mat(0, 0.022, 0));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(new CylinderGeometry(0.007, 0.008, 0.009, q.radialSmall), mats.rubber, mat(Math.sin(a) * 0.036, 0.0165, Math.cos(a) * 0.036));
  }
  b.add(tube([new Vector3(0.02, 0.06, 0.04), new Vector3(0.04, 0.12, 0.09), new Vector3(0.03, 0.2, 0.17)], 0.0022, 24, 6), mats.wireBlack);
  b.build(root, { castShadow: true, name: 'motor' });
  const h = ctx.builder();
  h.add(lathe([[0.04, 0.102], [0.05, 0.104, 0.004], [0.05, 0.13, 0.006], [0.012, 0.136]], q.radialSmall * 3, q.fillet), mats.smokePoly);
  h.build(root, { name: 'motor-volute', renderOrder: 2 });
  const impeller = new Group();
  root.add(impeller);
  const i = ctx.builder();
  i.add(new CylinderGeometry(0.044, 0.044, 0.0015, q.radialSmall * 3), mats.titanium, mat(0, 0.106, 0));
  i.add(lathe([[0.012, 0.107], [0.012, 0.118, 0.002], [0, 0.124]], q.radialSmall * 2, q.fillet), mats.titanium);
  const blades = q.level === 'low' ? 7 : 11;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2;
    i.add(new BoxGeometry(0.026, 0.018, 0.0012), mats.brushedAlu, mat(Math.cos(a) * 0.026, 0.116, -Math.sin(a) * 0.026, 0, a + 0.55, 0));
  }
  i.build(impeller, { name: 'impeller' });
  return { root, impeller };
}

/** Clean/dirty diaphragm pumps, solenoid valve, inline heater and silicone hoses. */
export function buildPumps(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'pumps';
  const b = ctx.builder();
  for (const s of [1, -1]) {
    const z = s * 0.125;
    b.add(new CylinderGeometry(0.014, 0.014, 0.036, q.radialSmall * 2), mats.steel, mat(0.285, 0.2, z, 0, 0, Math.PI / 2));
    b.add(new CylinderGeometry(0.0145, 0.0145, 0.004, q.radialSmall * 2), mats.blackMatte, mat(0.305, 0.2, z, 0, 0, Math.PI / 2));
    b.add(new RoundedBoxGeometry(0.02, 0.032, 0.032, 2, 0.004), mats.graphite, mat(0.258, 0.2, z));
    b.add(new BoxGeometry(0.05, 0.003, 0.04), mats.graphite, mat(0.285, 0.183, z));
    b.add(new BoxGeometry(0.136, 0.003, 0.012), mats.graphite, mat(0.376, 0.183, z));
    b.add(new BoxGeometry(0.004, 0.03, 0.024), mats.graphite, mat(0.442, 0.19, z));
  }
  b.add(new RoundedBoxGeometry(0.022, 0.024, 0.024, 2, 0.003), mats.graphite, mat(0.34, 0.262, 0.125));
  b.add(new CylinderGeometry(0.004, 0.004, 0.012, q.radialSmall), mats.champagne, mat(0.34, 0.279, 0.125));
  b.add(new CylinderGeometry(0.011, 0.011, 0.05, q.radialSmall * 2), mats.brushedAlu, mat(0.3, 0.262, 0.125, 0, 0, Math.PI / 2));
  for (let k = 0; k < 6; k++) {
    b.add(new TorusGeometry(0.0112, 0.0011, 6, q.radialSmall * 2), mats.copper, mat(0.284 + k * 0.0065, 0.262, 0.125, 0, Math.PI / 2, 0));
  }
  b.build(root, { castShadow: true, name: 'pumps' });
  const hoses = ctx.builder();
  hoses.add(tube(CLEAN_HOSE, 0.0045, q.level === 'low' ? 32 : 96, q.radialSmall), mats.hoseClean);
  hoses.add(tube(DIRTY_HOSE, 0.0045, q.level === 'low' ? 32 : 96, q.radialSmall), mats.hoseDirty);
  hoses.build(root, { name: 'hoses', renderOrder: 2 });
  return { root };
}

/** Switched-mode power supply with heat-sink fins and its control board. */
export function buildPowerSupply(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'powerSupply';
  const b = ctx.builder();
  b.add(new RoundedBoxGeometry(0.07, 0.07, 0.09, 2, 0.004), mats.titanium, mat(0.39, 0.06, 0.11));
  for (let k = 0; k < 9; k++) {
    b.add(new BoxGeometry(0.066, 0.012, 0.0014), mats.titanium, mat(0.39, 0.101, 0.072 + k * 0.0095));
  }
  const px = TX1 - 0.0165;
  b.add(new BoxGeometry(0.0016, 0.07, 0.09), mats.pcb, mat(px, 0.2, 0.05));
  b.add(new BoxGeometry(0.006, 0.012, 0.012), mats.chip, mat(px - 0.0038, 0.205, 0.04));
  b.add(new BoxGeometry(0.008, 0.008, 0.016), mats.connector, mat(px - 0.0048, 0.18, 0.075));
  for (let k = 0; k < 3; k++) b.add(new CylinderGeometry(0.004, 0.004, 0.01, q.radialSmall), mats.brushedAlu, mat(px - 0.0058, 0.222, 0.02 + k * 0.012, 0, 0, Math.PI / 2));
  b.add(tube([new Vector3(0.405, 0.096, 0.1), new Vector3(0.42, 0.15, 0.085), new Vector3(px - 0.002, 0.18, 0.075)], 0.002, 20, 6), mats.wireRed);
  b.build(root, { castShadow: true, name: 'psu' });
  return { root };
}
