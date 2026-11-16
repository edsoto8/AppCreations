import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import type { AssemblyMachineAnim } from './anims';
import { clamp01 } from './anims';
import { Parts, lazy, productAGeometry, productBGeometry } from './geometries';
import { PALETTE, glassMat, guardGlassMat, paintMat, productAMat, productBMat, workLightMat } from './materials';

/** Enclosure footprint: 2.2 (x) x 1.6 (z) x 2.0 (y). Load door + window face +z. */
export const ASSEMBLY_MACHINE_SIZE = { x: 2.2, y: 2.0, z: 1.6 } as const;
/** Where a StackLight sits on the roof (machine-local). */
export const ASSEMBLY_LIGHT_MOUNT: [number, number, number] = [0.85, 2.0, -0.55];
/** Product position on the fixture (machine-local, product bottom centre). */
export const ASSEMBLY_FIXTURE_POS: [number, number, number] = [0, 0.94, 0.15];

const GREY = PALETTE.machineGrey;
const BLUE = PALETTE.machineBlue;
const HEAD_Y = 1.49;
const STROKE = 0.12;
const DOOR_LIFT = 0.47;

const geo = lazy(() => {
  const W = 2.2;
  const D = 1.6;
  const p = new Parts()
    .box(W, 0.1, D, '#3d4349', [0, 0.05, 0], undefined, 0.02)
    .box(W - 0.04, 0.72, D - 0.04, GREY, [0, 0.46, 0], undefined, 0.02)
    // cabinet door seams + handles (front)
    .box(0.01, 0.6, 0.004, '#8d949b', [0, 0.46, D / 2 - 0.018], undefined, 0)
    .box(0.03, 0.16, 0.03, '#2b2f34', [-0.1, 0.5, D / 2 - 0.01], undefined, 0.008)
    .box(0.03, 0.16, 0.03, '#2b2f34', [0.1, 0.5, D / 2 - 0.01], undefined, 0.008)
    .box(0.3, 0.12, 0.005, '#f5c400', [-0.7, 0.62, D / 2 - 0.017], undefined, 0)
    // work plate
    .box(W - 0.2, 0.04, D - 0.2, '#b5bcc3', [0, 0.84, 0], undefined, 0.01)
    // roof with blue fascia
    .box(W + 0.02, 0.18, D + 0.02, BLUE, [0, 1.91, 0], undefined, 0.03)
    .box(W - 0.3, 0.06, D - 0.4, '#c6ccd2', [0, 2.03, 0], undefined, 0.02)
    .cyl(0.16, 0.16, 0.08, '#30353b', [-0.55, 2.06, 0.1], undefined, 20)
    // back wall and solid side walls (lower parts), corner posts
    .box(W - 0.08, 1.0, 0.03, GREY, [0, 1.32, -D / 2 + 0.03])
    .box(0.03, 0.42, D - 0.08, GREY, [-W / 2 + 0.02, 1.03, 0])
    .box(0.03, 0.42, D - 0.08, GREY, [W / 2 - 0.02, 1.03, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.09, 1.0, 0.09, BLUE, [sx * (W / 2 - 0.045), 1.32, sz * (D / 2 - 0.045)], undefined, 0.02);
  // front frame: sill + mid rail
  p.box(W - 0.1, 0.06, 0.06, BLUE, [0, 0.85, D / 2 - 0.03], undefined, 0.01);
  p.box(W - 0.1, 0.04, 0.05, '#a7afb7', [0, 1.33, D / 2 - 0.04], undefined, 0.01);
  // HMI arm + panel on +x side
  p.box(0.06, 0.06, 0.4, '#30353b', [W / 2 + 0.05, 1.45, 0.45], undefined, 0.01);
  p.box(0.08, 0.36, 0.48, '#2b2f34', [W / 2 + 0.11, 1.45, 0.62], [0, 0, 0.12], 0.02);
  // interior: spindle column, arm, fixture
  p.box(0.3, 0.95, 0.3, '#59626b', [0, 1.33, -0.55], undefined, 0.03);
  p.box(0.24, 0.16, 0.8, '#59626b', [0, 1.74, -0.2], undefined, 0.03);
  p.box(0.62, 0.06, 0.48, '#a8b0b8', [0, 0.89, 0.15], undefined, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.06, 0.06, 0.06, '#2f6fe0', [sx * 0.24, 0.95, 0.15 + sz * 0.17], undefined, 0.01);
  // cable tray on roof back
  p.box(1.6, 0.08, 0.16, '#7b848d', [0.1, 2.04, -0.6], undefined, 0.01);
  const body = p.build();

  const glass = new Parts()
    .box(W - 0.2, 0.45, 0.01, '#fff', [0, 1.57, D / 2 - 0.035], undefined, 0)
    .box(0.01, 0.42, D - 0.2, '#fff', [-W / 2 + 0.02, 1.55, 0], undefined, 0)
    .box(0.01, 0.42, D - 0.2, '#fff', [W / 2 - 0.02, 1.55, 0], undefined, 0)
    .build();

  const door = new Parts().box(W - 0.2, 0.46, 0.012, '#fff', [0, 1.1, D / 2 - 0.012], undefined, 0).build();

  const head = new Parts()
    .box(0.26, 0.3, 0.26, BLUE, [0, 0.15, 0], undefined, 0.04)
    .cyl(0.07, 0.07, 0.08, '#30353b', [0, 0.34, 0], undefined, 16)
    .cyl(0.035, 0.035, 0.14, '#c3c9cf', [0, -0.07, 0], undefined, 14)
    .cyl(0.012, 0.03, 0.05, '#e0b000', [0, -0.165, 0], undefined, 10)
    .box(0.27, 0.025, 0.27, '#f5c400', [0, 0.3, 0], undefined, 0)
    .build();

  const light = new Parts()
    .box(1.5, 0.025, 0.05, '#fff', [0, 1.81, 0.2], undefined, 0)
    .box(0.01, 0.28, 0.38, '#fff', [W / 2 + 0.16, 1.46, 0.62], [0, 0, 0.12], 0)
    .build();
  return { body, glass, door, head, light };
});

export type AssemblyMachineProps = ThreeElements['group'] & { anim: AssemblyMachineAnim };

/**
 * Assembly cell machine: enclosure with window and sliding load door facing local +z,
 * press/spindle head over a fixture, internal work light, HMI on the +x side.
 * Draw calls: 6 (+2 shadow). Put a StackLight at ASSEMBLY_LIGHT_MOUNT.
 */
export function AssemblyMachine({ anim, ...props }: AssemblyMachineProps) {
  const g = geo();
  const head = useRef<Group>(null);
  const spindle = useRef<Group>(null);
  const door = useRef<Mesh>(null);
  const prod = useRef<Mesh>(null);
  const lightMat = useMemo(() => workLightMat.clone() as MeshStandardMaterial, []);
  useEffect(() => () => lightMat.dispose(), [lightMat]);

  useFrame(() => {
    if (!head.current || !door.current || !prod.current || !spindle.current) return;
    const p = clamp01(anim.progress);
    let stroke = 0;
    let close = 0;
    if (anim.running) {
      // three press strokes during the middle of the cycle
      const mid = clamp01((p - 0.1) / 0.8);
      stroke = mid > 0 && mid < 1 ? 0.5 - 0.5 * Math.cos(mid * Math.PI * 2 * 3) : 0;
      close = Math.min(1, p / 0.06, (1 - p) / 0.06);
    }
    head.current.position.y = HEAD_Y - STROKE * stroke;
    spindle.current.rotation.y = p * 80;
    door.current.position.y = (1 - clamp01(close)) * DOOR_LIFT;
    lightMat.emissiveIntensity = anim.running ? 2.2 : 0.35;
    const pr = prod.current;
    if (anim.product === 0) pr.visible = false;
    else {
      pr.visible = true;
      const geom = anim.product === 1 ? productAGeometry : productBGeometry;
      if (pr.geometry !== geom) pr.geometry = geom;
      const mat = anim.product === 1 ? productAMat : productBMat;
      if (pr.material !== mat) pr.material = mat;
    }
  });

  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow receiveShadow />
      <mesh geometry={g.glass} material={glassMat} />
      <mesh ref={door} geometry={g.door} material={guardGlassMat} />
      <group ref={head} position={[0, HEAD_Y, 0.15]}>
        <group ref={spindle}>
          <mesh geometry={g.head} material={paintMat} castShadow />
        </group>
      </group>
      <mesh geometry={g.light} material={lightMat} />
      <mesh ref={prod} position={ASSEMBLY_FIXTURE_POS} visible={false} />
    </group>
  );
}
