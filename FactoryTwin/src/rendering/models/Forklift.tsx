import { useLayoutEffect, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { Matrix4, type Group, type InstancedMesh, type Mesh } from 'three';
import type { ForkliftAnim } from './anims';
import { blink } from './anims';
import { Parts, cartonGeometry, cartonStackOffsets, lazy, materialLotGeometry, palletGeometry } from './geometries';
import { PALETTE, ROLE_VEST, cartonMat, lampMats, materialLotMat, metalMat, paintMat, palletMat } from './materials';

const MAST_X = 0.82;
const OUTER_H = 2.2;
/** Pallet centre on the forks (forklift-local x). */
export const FORKLIFT_LOAD_X = 1.55;

const geo = lazy(() => {
  const Y = '#f5b400';
  const DG = '#34393f';
  const p = new Parts()
    // chassis + body
    .box(1.75, 0.35, 1.04, DG, [-0.2, 0.33, 0], undefined, 0.04)
    .box(1.25, 0.5, 1.0, Y, [-0.05, 0.72, 0], undefined, 0.06)
    // counterweight
    .box(0.55, 0.9, 1.08, '#3d4349', [-0.88, 0.6, 0], undefined, 0.14)
    .box(0.4, 0.06, 0.6, PALETTE.safetyYellow, [-0.9, 1.06, 0], undefined, 0.02)
    // hood + battery cover + step
    .box(0.6, 0.14, 0.9, '#e0a200', [0.25, 1.0, 0], undefined, 0.05)
    .box(0.3, 0.05, 0.2, '#202326', [0.25, 0.48, 0.52], undefined, 0.01)
    // seat
    .box(0.42, 0.1, 0.46, '#1d1f22', [-0.32, 1.02, 0], undefined, 0.04)
    .box(0.1, 0.48, 0.46, '#1d1f22', [-0.55, 1.28, 0], [0, 0, 0.12], 0.04)
    // dashboard + steering
    .box(0.18, 0.3, 0.6, '#2b2f34', [0.5, 1.15, 0], undefined, 0.03)
    .cyl(0.025, 0.025, 0.42, '#202326', [0.32, 1.32, 0], [0, 0, 0.6], 8)
    .torus(0.15, 0.02, '#202326', [0.2, 1.5, 0], [Math.PI / 2, 0.6, 0])
    // overhead guard
    .box(1.35, 0.06, 1.04, '#2b2f34', [-0.1, 2.12, 0], undefined, 0.02);
  for (const z of [-0.5, 0.5]) {
    p.bar([0.55, 1.0, z], [0.5, 2.1, z], 0.07, DG);
    p.bar([-0.72, 1.05, z], [-0.72, 2.1, z], 0.07, DG);
  }
  for (let i = 0; i < 5; i++) p.box(0.04, 0.03, 0.96, '#4b525b', [-0.6 + i * 0.25, 2.165, 0], undefined, 0);
  // wheels
  for (const z of [-0.5, 0.5]) {
    p.cylZ(0.3, 0.24, '#151618', [0.45, 0.3, z], 22).cylZ(0.17, 0.25, '#9aa3ab', [0.45, 0.3, z], 16);
    p.cylZ(0.23, 0.2, '#151618', [-0.78, 0.23, z * 0.98], 20).cylZ(0.12, 0.21, '#9aa3ab', [-0.78, 0.23, z * 0.98], 14);
  }
  // outer mast (static)
  for (const z of [-0.33, 0.33]) p.box(0.1, OUTER_H, 0.08, '#4b525b', [MAST_X, OUTER_H / 2 + 0.05, z], undefined, 0.01);
  p.box(0.12, 0.1, 0.74, '#4b525b', [MAST_X, OUTER_H, 0], undefined, 0.01);
  p.box(0.12, 0.12, 0.74, '#4b525b', [MAST_X, 0.15, 0], undefined, 0.01);
  p.bar([0.55, 0.55, 0.42], [MAST_X - 0.05, 1.05, 0.38], 0.06, '#9aa3ab');
  p.bar([0.55, 0.55, -0.42], [MAST_X - 0.05, 1.05, -0.38], 0.06, '#9aa3ab');
  // seated driver (driver vest)
  const vest = ROLE_VEST.driver;
  p.capsule(0.15, 0.28, vest, [-0.36, 1.35, 0], [0, 0, 0.12], [0.75, 1, 1.12]);
  p.sphere(0.1, PALETTE.skin, [-0.33, 1.72, 0], [1, 1.1, 1]);
  p.addPrebuilt(hat(), [-0.33, 1.76, 0]);
  for (const z of [-0.1, 0.1]) {
    p.capsule(0.07, 0.36, '#26314a', [-0.12, 1.1, z], [0, 0, Math.PI / 2 - 0.1]);
    p.capsule(0.065, 0.32, '#26314a', [0.1, 0.85, z], [0, 0, 0.2]);
    p.capsule(0.05, 0.36, '#3b4a63', [-0.12, 1.42, z * 2.2], [0, 0, 1.1]);
  }
  const body = p.build();

  const inner = new Parts();
  for (const z of [-0.25, 0.25]) inner.box(0.08, 2.0, 0.07, '#5d656d', [MAST_X + 0.06, 1.05, z], undefined, 0.01);
  inner.box(0.1, 0.1, 0.6, '#5d656d', [MAST_X + 0.06, 2.0, 0], undefined, 0.01);
  inner.cyl(0.04, 0.04, 1.4, '#c3c9cf', [MAST_X + 0.02, 0.8, 0], undefined, 10);

  const carriage = new Parts()
    .box(0.06, 0.45, 1.0, '#3d4349', [MAST_X + 0.12, 0.25, 0], undefined, 0.01)
    .box(0.03, 0.03, 1.0, '#3d4349', [MAST_X + 0.12, 0.9, 0], undefined, 0)
    .box(0.03, 0.03, 1.0, '#3d4349', [MAST_X + 0.12, 1.15, 0], undefined, 0);
  for (let i = -3; i <= 3; i++) carriage.box(0.03, 0.7, 0.03, '#3d4349', [MAST_X + 0.12, 0.8, i * 0.15], undefined, 0);
  for (const z of [-0.3, 0.3]) {
    carriage.box(0.05, 0.5, 0.12, '#2b2f34', [MAST_X + 0.17, 0.25, z], undefined, 0.01);
    carriage.box(1.15, 0.05, 0.12, '#2b2f34', [MAST_X + 0.17 + 0.575, 0.025, z], undefined, 0.01);
  }
  return { body, inner: inner.build(), carriage: carriage.build() };
});

function hat() {
  return new Parts()
    .sphere(0.12, '#f5c400', [0, 0, 0], [1, 0.75, 1])
    .cyl(0.135, 0.135, 0.015, '#f5c400', [0.02, -0.005, 0], undefined, 18)
    .build();
}

const _m = new Matrix4();

export type ForkliftProps = ThreeElements['group'] & { anim: ForkliftAnim };

/**
 * Counterbalance forklift, front (forks) = +x, seated driver, two-stage mast. Load centre at
 * FORKLIFT_LOAD_X. Pallet shows 1..24 cartons, or a shrink-wrapped lot when pallet = -1.
 * Beacon flashes amber while moving, red when failed. Draw calls: 7 (+5 shadow).
 */
export function Forklift({ anim, ...props }: ForkliftProps) {
  const g = geo();
  const inner = useRef<Group>(null);
  const carriage = useRef<Group>(null);
  const pallet = useRef<Mesh>(null);
  const lot = useRef<Mesh>(null);
  const cartons = useRef<InstancedMesh>(null);
  const beacon = useRef<Mesh>(null);

  useLayoutEffect(() => {
    const im = cartons.current;
    if (!im) return;
    cartonStackOffsets(24).forEach(([x, y, z], i) => im.setMatrixAt(i, _m.makeTranslation(x, y, z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, []);

  useFrame(() => {
    if (!inner.current || !carriage.current || !pallet.current || !lot.current || !cartons.current || !beacon.current) return;
    const fh = Math.max(0, Math.min(3, anim.forkHeight));
    carriage.current.position.y = fh;
    inner.current.position.y = Math.max(0, fh - 1.1);
    const n = Math.round(anim.pallet);
    pallet.current.visible = n > 0;
    lot.current.visible = n < 0;
    cartons.current.visible = n > 0;
    cartons.current.count = n > 0 ? Math.min(24, n) : 0;
    const on = anim.failed ? blink(anim.clock, 2) : anim.moving ? blink(anim.clock, 1.5) : false;
    const m = !on ? lampMats.off : anim.failed ? lampMats.red : lampMats.amber;
    if (beacon.current.material !== m) beacon.current.material = m;
  });

  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow />
      <group ref={inner}>
        <mesh geometry={g.inner} material={metalMat} castShadow />
      </group>
      <group ref={carriage}>
        <mesh geometry={g.carriage} material={metalMat} castShadow />
        <group position={[FORKLIFT_LOAD_X, 0.0, 0]}>
          <mesh ref={pallet} geometry={palletGeometry} material={palletMat} castShadow visible={false} />
          <instancedMesh ref={cartons} args={[cartonGeometry, cartonMat, 24]} castShadow visible={false} />
          <mesh ref={lot} geometry={materialLotGeometry} material={materialLotMat} castShadow visible={false} />
        </group>
      </group>
      <mesh ref={beacon} position={[-0.7, 2.22, 0]} material={lampMats.off}>
        <sphereGeometry args={[0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
    </group>
  );
}
