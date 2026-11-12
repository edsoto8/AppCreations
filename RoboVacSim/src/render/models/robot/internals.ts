import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Matrix4, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuildContext } from '../shared/context';
import { extrudeY, lathe, mat, polyXZ, tube } from '../shared/geometry';
import { createRng } from '../shared/rng';

/** 4S2P Li-ion pack: instanced 18650 cells, holders, nickel strips and a BMS board. */
export function buildBattery(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'battery';
  const cellGeo = ctx.track.track(new CylinderGeometry(0.0088, 0.0088, 0.0628, q.radialSmall * 2).rotateX(Math.PI / 2));
  const capGeo = ctx.track.track(new CylinderGeometry(0.0079, 0.0079, 0.0652, q.radialSmall * 2).rotateX(Math.PI / 2));
  const cells = new InstancedMesh(cellGeo, mats.batteryWrap, 8);
  const caps = new InstancedMesh(capGeo, mats.nickel, 8);
  cells.name = 'battery-cells';
  caps.name = 'battery-caps';
  const m = new Matrix4();
  let i = 0;
  for (let k = 0; k < 4; k++) {
    for (const s of [1, -1]) {
      m.makeTranslation(0.0385 + k * 0.0188, 0.0405, s * 0.0335);
      cells.setMatrixAt(i, m);
      caps.setMatrixAt(i, m);
      i++;
    }
  }
  cells.castShadow = true;
  root.add(cells, caps);

  const b = ctx.builder();
  for (const z of [0.0672, 0, -0.0672]) {
    b.add(new RoundedBoxGeometry(0.079, 0.021, 0.0026, 2, 0.0008), mats.graphite, mat(0.0667, 0.0405, z));
  }
  b.add(new BoxGeometry(0.078, 0.0012, 0.004), mats.graphite, mat(0.0667, 0.0302, 0.04));
  b.add(new BoxGeometry(0.078, 0.0012, 0.004), mats.graphite, mat(0.0667, 0.0302, -0.04));
  for (const z of [0.0691, -0.0691]) {
    for (let k = 0; k < 2; k++) {
      b.add(new BoxGeometry(0.034, 0.0055, 0.0004), mats.nickel, mat(0.0479 + k * 0.0376, 0.0405, z));
    }
  }
  b.add(new BoxGeometry(0.07, 0.0012, 0.026), mats.pcb, mat(0.0667, 0.0507, 0.0));
  b.add(new BoxGeometry(0.006, 0.0015, 0.004), mats.chip, mat(0.06, 0.0518, 0.005));
  b.add(new BoxGeometry(0.004, 0.0015, 0.004), mats.chip, mat(0.075, 0.0518, -0.006));
  b.build(root, { name: 'battery-frame' });
  const w = ctx.builder();
  w.add(tube([new Vector3(0.035, 0.0515, 0.008), new Vector3(0.024, 0.054, 0.012), new Vector3(0.016, 0.0565, 0.016)], 0.0011, 12, 6), mats.wireRed);
  w.add(tube([new Vector3(0.035, 0.0515, 0.002), new Vector3(0.024, 0.054, 0.005), new Vector3(0.016, 0.0565, 0.008)], 0.0011, 12, 6), mats.wireBlack);
  w.build(root, { name: 'battery-wires' });
  return { root };
}

/** Main controller board: SoC with finned heat-sink, memory, PMIC, Wi-Fi can, capacitors, connectors. */
export function buildMainboard(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'mainboard';
  const y0 = 0.0556;
  const y1 = 0.0572;
  const b = ctx.builder();
  b.add(extrudeY(polyXZ([[-0.004, -0.094], [0.112, -0.094], [0.136, -0.07], [0.136, 0.07], [0.112, 0.094], [-0.004, 0.094]]), y0, y1, { bevel: 0.0003, bevelSegments: 1 }), mats.pcb);
  const top = y1;
  const chip = (x: number, z: number, w: number, d: number, h = 0.0012): void => {
    b.add(new BoxGeometry(w, h, d), mats.chip, mat(x, top + h / 2, z));
  };
  chip(0.07, -0.02, 0.014, 0.014, 0.0016);
  b.add(new BoxGeometry(0.018, 0.0012, 0.018), mats.brushedAlu, mat(0.07, top + 0.0022, -0.02));
  for (let k = 0; k < 7; k++) {
    b.add(new BoxGeometry(0.018, 0.0055, 0.0007), mats.brushedAlu, mat(0.07, top + 0.0055, -0.0278 + k * 0.0026));
  }
  chip(0.07, 0.004, 0.012, 0.007);
  chip(0.07, 0.014, 0.012, 0.007);
  chip(0.1, 0.03, 0.008, 0.008);
  chip(0.04, 0.05, 0.01, 0.006);
  chip(0.105, -0.004, 0.006, 0.006);
  b.add(new BoxGeometry(0.016, 0.002, 0.012), mats.nickel, mat(0.112, top + 0.001, -0.055));
  b.add(new BoxGeometry(0.014, 0.0006, 0.002), mats.brushedAlu, mat(0.124, top + 0.0003, -0.075));
  for (let k = 0; k < 5; k++) {
    b.add(new CylinderGeometry(0.0026, 0.0026, 0.0055, q.radialSmall), mats.brushedAlu, mat(0.018 + k * 0.0068, top + 0.00275, -0.07));
  }
  for (let k = 0; k < 3; k++) chip(0.03 + k * 0.008, -0.045, 0.005, 0.005, 0.0035);
  const conn: [number, number, number, number][] = [
    [0.002, 0.06, 0.006, 0.014], [0.002, -0.06, 0.006, 0.014], [0.125, 0.04, 0.008, 0.012], [0.04, 0.088, 0.014, 0.005], [0.04, -0.088, 0.014, 0.005],
  ];
  for (const [x, z, w, d] of conn) b.add(new BoxGeometry(w, 0.0042, d), mats.connector, mat(x, top + 0.0021, z));
  for (const [x, z] of [[0.004, 0.088], [0.004, -0.088], [0.128, 0.064], [0.128, -0.064]] as const) {
    b.add(new CylinderGeometry(0.0021, 0.0021, 0.0012, q.radialSmall), mats.nickel, mat(x, top + 0.0006, z));
  }
  if (q.detail) {
    const rnd = createRng(5);
    for (let k = 0; k < 40; k++) {
      chip(0.01 + rnd() * 0.115, -0.08 + rnd() * 0.16, 0.0016, 0.0008, 0.0005);
    }
  }
  b.build(root, { name: 'mainboard' });
  return { root };
}

/** 6-axis IMU daughter board near the rotation centre. */
export function buildImu(ctx: BuildContext): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'imu';
  const b = ctx.builder();
  b.add(new RoundedBoxGeometry(0.014, 0.0012, 0.014, 1, 0.0004), mats.pcb, mat(0.012, 0.0584, 0.03));
  b.add(new BoxGeometry(0.0045, 0.001, 0.0045), mats.chip, mat(0.012, 0.0595, 0.03));
  for (let k = 0; k < 4; k++) {
    b.add(new CylinderGeometry(0.0005, 0.0005, 0.0018, q.radialSmall / 2), mats.gold, mat(0.0065 + k * 0.0025, 0.0578, 0.0245));
  }
  b.build(root, { name: 'imu' });
  return { root };
}

export const FAN_CENTRE = { x: -0.068, z: 0.112 } as const;

/** Centrifugal suction fan: BLDC motor, backward-curved impeller (spins) in a smoked volute. */
export function buildSuctionFan(ctx: BuildContext): { root: Group; impeller: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'suctionFan';
  root.position.set(FAN_CENTRE.x, 0, FAN_CENTRE.z);
  const motor = ctx.builder();
  motor.add(lathe([[0, 0.0285], [0.0125, 0.0285, 0.001], [0.0125, 0.0438, 0.0008], [0.004, 0.0442]], q.radialSmall * 2, q.fillet), mats.steel);
  motor.add(new CylinderGeometry(0.0128, 0.0128, 0.0024, q.radialSmall * 2), mats.steel, mat(0, 0.0405, 0));
  motor.add(new CylinderGeometry(0.0128, 0.0128, 0.0024, q.radialSmall * 2), mats.steel, mat(0, 0.0335, 0));
  motor.build(root, { name: 'fan-motor' });

  const housing = ctx.builder();
  housing.add(lathe([[0.0225, 0.0443], [0.0262, 0.0443, 0], [0.0262, 0.0655, 0.003], [0.0068, 0.0662]], q.radialSmall * 3, q.fillet), mats.smokePoly);
  const dir = Math.atan2(-0.0396, -0.0195);
  housing.add(new RoundedBoxGeometry(0.03, 0.016, 0.014, 2, 0.003), mats.smokePoly, mat(Math.cos(dir) * 0.027, 0.053, -Math.sin(dir) * 0.027, 0, dir, 0));
  housing.add(tube([new Vector3(0.006, 0.0668, -0.03), new Vector3(0.002, 0.068, -0.016), new Vector3(0, 0.0672, -0.004)], 0.0062, 16, q.radialSmall), mats.smokePoly);
  housing.build(root, { name: 'fan-housing', renderOrder: 2 });

  const impeller = new Group();
  root.add(impeller);
  const imp = ctx.builder();
  imp.add(new CylinderGeometry(0.0235, 0.0235, 0.0009, q.radialSmall * 3), mats.titanium, mat(0, 0.0458, 0));
  imp.add(lathe([[0.0085, 0.0462], [0.0085, 0.052, 0.001], [0.004, 0.0565, -1], [0, 0.057]], q.radialSmall * 2, q.fillet), mats.titanium);
  const blades = q.level === 'low' ? 7 : 11;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2;
    imp.add(new BoxGeometry(0.0125, 0.0145, 0.0007), mats.brushedAlu, mat(Math.cos(a) * 0.0158, 0.0535, -Math.sin(a) * 0.0158, 0, a + 0.62, 0));
  }
  imp.build(impeller, { name: 'fan-impeller' });
  return { root, impeller };
}
