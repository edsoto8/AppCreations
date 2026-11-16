import { useLayoutEffect, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3, type Group, type InstancedMesh, type Mesh } from 'three';
import type { GantryAnim } from './anims';
import { blink, clamp01 } from './anims';
import { Parts, lazy, unitCylinderGeometry } from './geometries';
import { PALETTE, aluminiumMat, lampMats, metalMat, paintMat, scanBeamMat, screenMat } from './materials';

/** Bed top height (matches conveyors). Products sit at local [x, BED_TOP, 0]. */
export const GANTRY_BED_TOP = 0.86;
const BED_LEN = 2.4;
const BED_W = 0.7;
const TOP = 2.3;
const SWEEP = 0.8;
const N_ROLLERS = 22;

const geo = lazy(() => {
  const Y = PALETTE.safetyYellow;
  const p = new Parts();
  // roller bed frame
  for (const side of [-1, 1]) {
    p.box(BED_LEN, 0.12, 0.05, PALETTE.aluminium, [0, GANTRY_BED_TOP - 0.07, side * (BED_W / 2 + 0.025)], undefined, 0.008);
    for (const x of [-1.05, 0, 1.05]) p.box(0.05, GANTRY_BED_TOP - 0.13, 0.05, PALETTE.aluminium, [x, (GANTRY_BED_TOP - 0.13) / 2, side * (BED_W / 2 + 0.02)], undefined, 0.008);
  }
  for (const x of [-1.05, 0, 1.05]) p.box(0.04, 0.04, BED_W, PALETTE.aluminium, [x, 0.25, 0], undefined, 0.005);
  // portal frame (machine blue) with yellow base plates
  for (const x of [-1.15, 1.15]) {
    for (const z of [-0.75, 0.75]) {
      p.box(0.12, TOP, 0.12, PALETTE.machineBlue, [x, TOP / 2, z], undefined, 0.02);
      p.box(0.24, 0.02, 0.24, Y, [x, 0.01, z], undefined, 0.004);
    }
    p.box(0.14, 0.16, 1.62, PALETTE.machineBlue, [x, TOP - 0.02, 0], undefined, 0.02);
  }
  for (const z of [-0.62, 0.62]) {
    p.box(2.44, 0.14, 0.1, PALETTE.darkBlue, [0, TOP + 0.02, z], undefined, 0.02);
    p.box(2.3, 0.02, 0.03, '#c9cfd5', [0, TOP + 0.1, z], undefined, 0);
  }
  // cable chain on top
  p.box(1.4, 0.05, 0.08, '#202326', [-0.4, TOP + 0.13, -0.62], undefined, 0.01);
  // result-lamp post
  p.cyl(0.02, 0.02, 0.25, '#c3c9cf', [1.15, TOP + 0.2, 0.75], undefined, 10);
  // operator console beside the gantry (local -z), screen facing -z
  p.box(0.5, 0.95, 0.4, '#3d4349', [0, 0.475, -1.35], undefined, 0.03);
  p.box(0.6, 0.04, 0.5, '#a9b0b7', [0, 0.97, -1.38], undefined, 0.01);
  p.box(0.42, 0.02, 0.16, '#202326', [0, 1.0, -1.48], undefined, 0.005);
  p.box(0.05, 0.35, 0.05, '#2b2f34', [0, 1.15, -1.25], undefined, 0.01);
  p.box(0.62, 0.4, 0.05, '#202326', [0, 1.45, -1.27], [-0.18, 0, 0], 0.015);
  // reject chute on the +z side
  p.box(0.5, 0.04, 0.6, '#9aa3ab', [0.6, 0.55, 0.75], [0.4, 0, 0], 0.01);
  p.box(0.5, 0.25, 0.04, PALETTE.red, [0.6, 0.66, 1.05], undefined, 0.01);
  const body = p.build();

  const carriage = new Parts()
    .box(0.36, 0.12, 1.4, '#3d4349', [0, TOP + 0.1, 0], undefined, 0.02)
    .box(0.24, 0.5, 0.24, PALETTE.offWhite, [0, TOP - 0.25, 0], undefined, 0.04)
    .box(0.26, 0.04, 0.26, PALETTE.machineBlue, [0, TOP - 0.02, 0], undefined, 0.01)
    .cyl(0.07, 0.08, 0.14, '#1d2024', [0, TOP - 0.57, 0], undefined, 18)
    .cyl(0.05, 0.05, 0.01, '#3aa0ff', [0, TOP - 0.645, 0], undefined, 16)
    // ring light
    .torus(0.11, 0.015, '#e8eef4', [0, TOP - 0.62, 0], [Math.PI / 2, 0, 0])
    .build();

  const screen = new Parts().box(0.54, 0.32, 0.01, '#fff', [0, 1.45, -1.30], [-0.18, 0, 0], 0).build();

  // scan fan: triangle from the lens down to the bed, spread across z
  const fan = new BufferGeometry();
  const ly = TOP - 0.65;
  const by = GANTRY_BED_TOP + 0.01;
  fan.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, ly, 0, 0, by, -0.34, 0, by, 0.34, -0.03, by, -0.34, 0.03, by, -0.34, 0.03, by, 0.34, -0.03, by, -0.34, 0.03, by, 0.34, -0.03, by, 0.34]), 3),
  );
  fan.computeVertexNormals();

  const rollers: Matrix4[] = [];
  const q = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
  for (let i = 0; i < N_ROLLERS; i++) {
    const x = -BED_LEN / 2 + 0.06 + (i * (BED_LEN - 0.12)) / (N_ROLLERS - 1);
    rollers.push(new Matrix4().compose(new Vector3(x, GANTRY_BED_TOP - 0.03, 0), q, new Vector3(0.028, BED_W, 0.028)));
  }
  return { body, carriage, screen, fan, rollers };
});

export type InspectionGantryProps = ThreeElements['group'] & { anim: GantryAnim };

/**
 * Vision inspection station: roller bed along x (top at GANTRY_BED_TOP), portal frame,
 * camera carriage sweeping x by progress, additive scan fan while scanning, result lamp
 * (green pass / red reject, flashing on anim.clock), operator console at local -z.
 * Draw calls: 6 (+2 shadow).
 */
export function InspectionGantry({ anim, ...props }: InspectionGantryProps) {
  const g = geo();
  const carriage = useRef<Group>(null);
  const fan = useRef<Mesh>(null);
  const lamp = useRef<Mesh>(null);
  const rollers = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const im = rollers.current;
    if (!im) return;
    g.rollers.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [g]);

  useFrame(() => {
    if (!carriage.current || !fan.current || !lamp.current) return;
    carriage.current.position.x = -SWEEP + 2 * SWEEP * clamp01(anim.progress);
    fan.current.visible = anim.scanning;
    const on = anim.result !== 0 && blink(anim.clock, 2);
    const m = !on ? lampMats.off : anim.result === 1 ? lampMats.green : lampMats.red;
    if (lamp.current.material !== m) lamp.current.material = m;
  });

  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow receiveShadow />
      <instancedMesh ref={rollers} args={[unitCylinderGeometry, aluminiumMat, N_ROLLERS]} />
      <group ref={carriage}>
        <mesh geometry={g.carriage} material={metalMat} castShadow />
        <mesh ref={fan} geometry={g.fan} material={scanBeamMat} visible={false} />
      </group>
      <mesh geometry={g.screen} material={screenMat} />
      <mesh ref={lamp} position={[1.15, TOP + 0.36, 0.75]} material={lampMats.off}>
        <sphereGeometry args={[0.07, 14, 10]} />
      </mesh>
    </group>
  );
}
