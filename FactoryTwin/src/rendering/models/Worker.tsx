import { useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { CylinderGeometry, SphereGeometry, type BufferGeometry, type Group } from 'three';
import type { WorkerRole } from '../../simulation/types';
import type { WorkerAnim } from './anims';
import { Parts, lazy } from './geometries';
import { PALETTE, ROLE_HAT, ROLE_VEST, matteMat } from './materials';

const HIP_Y = 0.92;
const SHOULDER_Y = 1.41;
/** Metres per full gait cycle (two steps). */
const GAIT = 1.4;

const PANTS = '#2a3550';
const SHIRT = '#3b4a63';

const bodyCache = new Map<WorkerRole, BufferGeometry>();

function bodyGeometry(role: WorkerRole): BufferGeometry {
  const hit = bodyCache.get(role);
  if (hit) return hit;
  const vest = ROLE_VEST[role];
  const hatC = ROLE_HAT[role];
  const p = new Parts()
    .box(0.22, 0.2, 0.34, PANTS, [0, 0.98, 0], undefined, 0.06)
    .capsule(0.16, 0.3, vest, [0, 1.24, 0], undefined, [0.72, 1, 1.12])
    .add(new CylinderGeometry(0.163, 0.163, 0.035, 16), '#dfe6ea', [0, 1.14, 0], undefined, [0.73, 1, 1.13])
    .add(new CylinderGeometry(0.163, 0.163, 0.035, 16), '#dfe6ea', [0, 1.3, 0], undefined, [0.73, 1, 1.13])
    .sphere(0.075, SHIRT, [0, SHOULDER_Y, 0.2])
    .sphere(0.075, SHIRT, [0, SHOULDER_Y, -0.2])
    .cyl(0.05, 0.055, 0.1, PALETTE.skin, [0, 1.5, 0], undefined, 10)
    .sphere(0.102, PALETTE.skin, [0, 1.62, 0], [1, 1.12, 0.95])
    // safety glasses (shows facing direction)
    .box(0.03, 0.022, 0.15, '#1a1c20', [0.092, 1.64, 0], undefined, 0)
    // hard hat: dome + brim + peak
    .add(new SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatC, [0, 1.66, 0], undefined, [1.04, 0.95, 1])
    .cyl(0.13, 0.13, 0.014, hatC, [0.01, 1.662, 0], undefined, 18)
    .box(0.08, 0.012, 0.16, hatC, [0.13, 1.664, 0], undefined, 0.005);
  const g = p.build();
  bodyCache.set(role, g);
  return g;
}

const limbs = lazy(() => {
  const leg = new Parts()
    .capsule(0.075, 0.66, PANTS, [0, -0.42, 0])
    .box(0.27, 0.1, 0.12, '#2a211a', [0.05, -HIP_Y + 0.05, 0], undefined, 0.035)
    .build();
  const arm = new Parts()
    .capsule(0.056, 0.4, SHIRT, [0, -0.26, 0])
    .sphere(0.052, PALETTE.skin, [0, -0.56, 0])
    .build();
  return { leg, arm };
});

export type WorkerProps = ThreeElements['group'] & { anim: WorkerAnim; role: WorkerRole };

/**
 * Stylised worker (~1.75 m) facing local +x. Hi-vis vest by role. Gait from anim.stride when
 * walking, arms-forward working pose with small motion from anim.clock when working.
 * 5 meshes, one shared material. Draw calls: 5 (+1 shadow: only the body casts).
 */
export function Worker({ anim, role, ...props }: WorkerProps) {
  const body = bodyGeometry(role);
  const { leg, arm } = limbs();
  const bob = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);

  useFrame(() => {
    if (!bob.current || !legL.current || !legR.current || !armL.current || !armR.current) return;
    let lA = 0;
    let aL = 0.06;
    let aR = 0.06;
    let y = 0;
    if (anim.walking) {
      const ph = (anim.stride / GAIT) * Math.PI * 2;
      const s = Math.sin(ph);
      lA = 0.42 * s;
      aL = -0.38 * s;
      aR = 0.38 * s;
      y = Math.abs(Math.cos(ph)) * 0.025;
    } else if (anim.working) {
      aL = 1.05 + 0.12 * Math.sin(anim.clock * 4.2);
      aR = 1.05 + 0.12 * Math.sin(anim.clock * 4.2 + 2.1);
    }
    bob.current.position.y = y;
    legL.current.rotation.z = lA;
    legR.current.rotation.z = -lA;
    armL.current.rotation.z = aL;
    armR.current.rotation.z = aR;
  });

  return (
    <group {...props}>
      <group ref={bob}>
        <mesh geometry={body} material={matteMat} castShadow />
        <group ref={legL} position={[0, HIP_Y, 0.095]}>
          <mesh geometry={leg} material={matteMat} />
        </group>
        <group ref={legR} position={[0, HIP_Y, -0.095]}>
          <mesh geometry={leg} material={matteMat} />
        </group>
        <group ref={armL} position={[0, SHOULDER_Y, 0.215]}>
          <mesh geometry={arm} material={matteMat} />
        </group>
        <group ref={armR} position={[0, SHOULDER_Y, -0.215]}>
          <mesh geometry={arm} material={matteMat} />
        </group>
      </group>
    </group>
  );
}
