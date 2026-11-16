import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { DoubleSide, MeshStandardMaterial, type Group, type Mesh } from 'three';
import type { PalletizerAnim } from './anims';
import { CARTON_SIZE, Parts, cartonGeometry } from './geometries';
import { PALETTE, cartonMat, metalMat, paintMat } from './materials';
import { wireTexture } from './textures';

/** Pick point (end of the infeed roller table), palletizer-local. */
export const PALLETIZER_PICK: [number, number, number] = [-1.6, 0.86, 0];
const FRAME_X0 = -2.25;
const FRAME_X1 = 0.85;
const TOP = 3.3;
const MAST_LEN = 3.4;

function build(positions: number[]) {
  const zMax = Math.max(1.5, ...positions.map((z) => Math.abs(z))) + 0.9;
  const Y = PALETTE.safetyYellow;
  const p = new Parts();
  // gantry posts + top rails
  for (const x of [FRAME_X0, FRAME_X1])
    for (const z of [-zMax, zMax]) {
      p.box(0.16, TOP, 0.16, PALETTE.machineBlue, [x, TOP / 2, z], undefined, 0.02);
      p.box(0.32, 0.02, 0.32, '#3d4349', [x, 0.01, z], undefined, 0.004);
    }
  for (const z of [-zMax, zMax]) {
    p.box(FRAME_X1 - FRAME_X0 + 0.3, 0.22, 0.18, PALETTE.darkBlue, [(FRAME_X0 + FRAME_X1) / 2, TOP + 0.05, z], undefined, 0.02);
    p.box(FRAME_X1 - FRAME_X0 + 0.2, 0.03, 0.06, '#c9cfd5', [(FRAME_X0 + FRAME_X1) / 2, TOP + 0.175, z], undefined, 0);
  }
  for (const x of [FRAME_X0, FRAME_X1]) p.box(0.14, 0.14, 2 * zMax, PALETTE.machineBlue, [x, TOP - 0.05, 0], undefined, 0.02);
  // pick roller table at the infeed
  const [px, py] = PALLETIZER_PICK;
  p.box(0.7, 0.1, 0.7, PALETTE.aluminium, [px, py - 0.06, 0], undefined, 0.01);
  for (let i = 0; i < 7; i++) p.cylZ(0.025, 0.62, '#c9cfd5', [px - 0.3 + i * 0.1, py - 0.02, 0], 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.05, py - 0.1, 0.05, PALETTE.aluminium, [px + sx * 0.3, (py - 0.1) / 2, sz * 0.3], undefined, 0.006);
  p.box(0.04, 0.12, 0.66, '#3d4349', [px - 0.36, py + 0.03, 0], undefined, 0.005);
  // build positions: floor corner guides
  for (const z of positions)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        p.box(0.22, 0.06, 0.05, Y, [sx * 0.66 - sx * 0.08, 0.03, z + sz * 0.56], undefined, 0.01);
        p.box(0.05, 0.06, 0.22, Y, [sx * 0.66, 0.03, z + sz * 0.56 - sz * 0.08], undefined, 0.01);
      }
  // control cabinet
  p.box(0.8, 1.8, 0.45, PALETTE.offWhite, [FRAME_X0 - 0.2, 0.9, zMax + 0.75], undefined, 0.02);
  p.box(0.3, 0.2, 0.01, '#202326', [FRAME_X0 - 0.2, 1.4, zMax + 0.98], undefined, 0);
  // safety fence: posts (yellow) + light-curtain posts at forklift openings
  const fx0 = FRAME_X0 - 0.35;
  const fx1 = FRAME_X1 + 0.45;
  const fz = zMax + 0.4;
  const fence = new Parts();
  const panelH = 1.9;
  const run = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const n = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      p.box(0.06, 2.0, 0.06, Y, [ax + (bx - ax) * t, 1.0, az + (bz - az) * t], undefined, 0.01);
    }
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const cx = ax + (bx - ax) * (t0 + t1) * 0.5;
      const cz = az + (bz - az) * (t0 + t1) * 0.5;
      const w = (len / n) - 0.07;
      const rot = Math.abs(bx - ax) > Math.abs(bz - az) ? 0 : Math.PI / 2;
      fence.panel(w, panelH, [cx, 0.1 + panelH / 2, cz], rot, 0.1);
      p.box(rot === 0 ? w : 0.03, 0.04, rot === 0 ? 0.03 : w, Y, [cx, 0.1 + panelH, cz], undefined, 0.005);
    }
  };
  // north / south sides
  run(fx0, -fz, fx1, -fz);
  run(fx0, fz, fx1, fz);
  // west side with a gap for the infeed conveyor
  run(fx0, -fz, fx0, -0.5);
  run(fx0, 0.5, fx0, fz);
  // east side: openings in front of each build position (light curtains)
  const sorted = [...positions].sort((a, b) => a - b);
  let z0 = -fz;
  for (const z of sorted) {
    run(fx1, z0, fx1, z - 0.75);
    for (const zz of [z - 0.75, z + 0.75]) {
      p.box(0.08, 1.9, 0.08, Y, [fx1, 0.95, zz], undefined, 0.01);
      p.box(0.03, 1.6, 0.02, '#202326', [fx1, 0.95, zz + (zz < z ? 0.045 : -0.045)], undefined, 0);
    }
    z0 = z + 0.75;
  }
  run(fx1, z0, fx1, fz);

  const bridge = new Parts()
    .box(0.3, 0.26, 2 * zMax + 0.1, '#e3e7eb', [0, TOP + 0.3, 0], undefined, 0.03)
    .box(0.32, 0.04, 2 * zMax + 0.12, PALETTE.safetyYellow, [0, TOP + 0.45, 0], undefined, 0.005)
    .box(0.4, 0.3, 0.3, '#3d4349', [0, TOP + 0.28, zMax], undefined, 0.03)
    .box(0.4, 0.3, 0.3, '#3d4349', [0, TOP + 0.28, -zMax], undefined, 0.03)
    .build();
  const carriage = new Parts()
    .box(0.5, 0.36, 0.42, PALETTE.machineBlue, [0, TOP + 0.3, 0], undefined, 0.04)
    .cylZ(0.08, 0.2, '#30353b', [0.12, TOP + 0.52, 0], 14)
    .build();
  const mast = new Parts()
    .box(0.16, MAST_LEN, 0.16, '#c9cfd5', [0, MAST_LEN / 2 + 0.12, 0], undefined, 0.02)
    .box(0.17, MAST_LEN * 0.9, 0.05, '#7d868f', [0, MAST_LEN / 2 + 0.12, 0.07], undefined, 0)
    .box(0.48, 0.08, 0.38, '#3d4349', [0, 0.08, 0], undefined, 0.015)
    .box(0.3, 0.06, 0.3, PALETTE.machineBlue, [0, 0.15, 0], undefined, 0.01)
    .build();
  const jaw = new Parts().box(0.44, 0.22, 0.03, '#9aa3ab', [0, -0.07, 0], undefined, 0.006).box(0.4, 0.04, 0.012, '#202326', [0, -0.15, -0.02], undefined, 0).build();
  return { body: p.build(), fence: fence.build(), bridge, carriage, mast, jaw };
}

export type PalletizerProps = ThreeElements['group'] & { anim: PalletizerAnim; positions?: number[] };

/**
 * Gantry palletizer. Pick point at PALLETIZER_PICK (local x = -1.6), pallet build positions at
 * local x = 0, z = positions[k] (pallets sit on the floor). The gripper pad (bottom face) goes
 * to anim.target; a carried carton hangs with its TOP at target.y. Wire-mesh fence with a
 * conveyor gap on -x and light-curtain openings on +x in front of each build position.
 * Draw calls: 8 (+4 shadow).
 */
export function Palletizer({ anim, positions = [-1.5, 1.5], ...props }: PalletizerProps) {
  const key = positions.join(',');
  const g = useMemo(() => build(positions), [key]);
  useEffect(
    () => () => {
      for (const v of Object.values(g)) v.dispose();
    },
    [g],
  );
  const fenceMat = useMemo(
    () => new MeshStandardMaterial({ color: '#30353a', map: wireTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 0.6, metalness: 0.4 }),
    [],
  );
  useEffect(() => () => fenceMat.dispose(), [fenceMat]);
  const bridge = useRef<Group>(null);
  const carriage = useRef<Group>(null);
  const mast = useRef<Group>(null);
  const jawA = useRef<Group>(null);
  const jawB = useRef<Group>(null);
  const load = useRef<Mesh>(null);

  useFrame(() => {
    if (!bridge.current || !carriage.current || !mast.current || !jawA.current || !jawB.current || !load.current) return;
    const [tx, ty, tz] = anim.target;
    bridge.current.position.x = tx;
    carriage.current.position.z = tz;
    mast.current.position.y = ty;
    const half = anim.grip ? CARTON_SIZE.z / 2 + 0.02 : CARTON_SIZE.z / 2 + 0.1;
    jawA.current.position.z = half;
    jawB.current.position.z = -half;
    load.current.visible = anim.carrying;
  });

  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow receiveShadow />
      <mesh geometry={g.fence} material={fenceMat} />
      <group ref={bridge}>
        <mesh geometry={g.bridge} material={paintMat} castShadow />
        <group ref={carriage}>
          <mesh geometry={g.carriage} material={paintMat} castShadow />
          <group ref={mast}>
            <mesh geometry={g.mast} material={metalMat} castShadow />
            <group ref={jawA}>
              <mesh geometry={g.jaw} material={metalMat} />
            </group>
            <group ref={jawB} scale={[1, 1, -1]}>
              <mesh geometry={g.jaw} material={metalMat} />
            </group>
            <mesh ref={load} geometry={cartonGeometry} material={cartonMat} position={[0, -CARTON_SIZE.y, 0]} visible={false} />
          </group>
        </group>
      </group>
    </group>
  );
}
