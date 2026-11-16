import { useLayoutEffect, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { Matrix4, type Group, type InstancedMesh, type Mesh } from 'three';
import type { AGVAnim } from './anims';
import { blink } from './anims';
import { Parts, kitToteGeometry, lazy } from './geometries';
import { PALETTE, lampMats, paintMat, reworkToteMat, toteMat } from './materials';

/** Deck top height; totes sit here. */
export const AGV_DECK_TOP = 0.335;
/** Tote slot centres on the deck (AGV-local x, z). */
export const AGV_TOTE_SLOTS: [number, number][] = [
  [0.15, -0.16],
  [0.15, 0.16],
  [-0.27, -0.16],
  [-0.27, 0.16],
];

const geo = lazy(() => {
  const body = '#4b525b';
  const p = new Parts()
    .box(1.2, 0.24, 0.8, body, [0, 0.17, 0], undefined, 0.06)
    .box(1.12, 0.03, 0.74, '#b9c0c7', [0, 0.315, 0], undefined, 0.01)
    .box(1.0, 0.012, 0.66, '#8f98a1', [-0.06, 0.329, 0], undefined, 0.004)
    // bumpers
    .box(0.06, 0.1, 0.78, PALETTE.safetyYellow, [0.61, 0.12, 0], undefined, 0.02)
    .box(0.06, 0.1, 0.78, PALETTE.safetyYellow, [-0.61, 0.12, 0], undefined, 0.02)
    // scanner windows
    .box(0.02, 0.05, 0.36, '#0e1013', [0.64, 0.2, 0], undefined, 0.005)
    .box(0.02, 0.05, 0.36, '#0e1013', [-0.64, 0.2, 0], undefined, 0.005)
    // side panels with logo strip
    .box(0.5, 0.06, 0.005, '#2d6cdf', [0, 0.17, 0.403], undefined, 0)
    .box(0.5, 0.06, 0.005, '#2d6cdf', [0, 0.17, -0.403], undefined, 0)
    // e-stop
    .box(0.07, 0.04, 0.07, PALETTE.safetyYellow, [0.5, 0.35, 0.32], undefined, 0.01)
    .cyl(0.025, 0.025, 0.03, PALETTE.red, [0.5, 0.38, 0.32], undefined, 12)
    // lidar mast
    .cyl(0.03, 0.04, 0.05, '#2b2f34', [0.5, 0.36, 0], undefined, 12);
  // wheels peeking out at the sides
  for (const x of [-0.38, 0.38]) for (const z of [-0.37, 0.37]) p.cylZ(0.07, 0.07, '#18191b', [x, 0.07, z], 14);
  const strip = new Parts()
    .box(1.215, 0.022, 0.01, '#fff', [0, 0.235, 0.402], undefined, 0)
    .box(1.215, 0.022, 0.01, '#fff', [0, 0.235, -0.402], undefined, 0)
    .box(0.01, 0.022, 0.6, '#fff', [0.642, 0.235, 0], undefined, 0)
    .box(0.01, 0.022, 0.6, '#fff', [-0.642, 0.235, 0], undefined, 0)
    .build();
  const lidar = new Parts()
    .cyl(0.055, 0.055, 0.06, '#1b1d20', [0, 0.03, 0], undefined, 18)
    .cyl(0.045, 0.055, 0.02, '#3a3f45', [0, 0.07, 0], undefined, 18)
    .box(0.015, 0.03, 0.05, '#e0283a', [0.052, 0.03, 0], undefined, 0)
    .build();
  return { body: p.build(), strip, lidar };
});

const _m = new Matrix4();

export type AGVProps = ThreeElements['group'] & { anim: AGVAnim };

/**
 * Low autonomous mobile robot 1.2 x 0.8 x 0.35 m, front = +x. Lidar spins with anim.clock,
 * light strip: cyan moving / green idle / flashing red failed. Up to 4 totes on the deck
 * (blue kits or orange rework). Draw calls: 4 (+2 shadow).
 */
export function AGV({ anim, ...props }: AGVProps) {
  const g = geo();
  const strip = useRef<Mesh>(null);
  const lidar = useRef<Group>(null);
  const totes = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const im = totes.current;
    if (!im) return;
    AGV_TOTE_SLOTS.forEach(([x, z], i) => im.setMatrixAt(i, _m.makeTranslation(x, AGV_DECK_TOP, z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, []);

  useFrame(() => {
    if (!strip.current || !lidar.current || !totes.current) return;
    const m = anim.failed ? (blink(anim.clock, 2) ? lampMats.red : lampMats.off) : anim.moving ? lampMats.cyan : lampMats.green;
    if (strip.current.material !== m) strip.current.material = m;
    lidar.current.rotation.y = anim.failed ? 0 : anim.clock * 9;
    const n = Math.max(0, Math.min(4, Math.round(anim.cargo)));
    totes.current.count = n;
    totes.current.visible = n > 0;
    const tm = anim.cargoKind === 1 ? reworkToteMat : toteMat;
    if (totes.current.material !== tm) totes.current.material = tm;
  });

  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow />
      <mesh ref={strip} geometry={g.strip} material={lampMats.green} />
      <group ref={lidar} position={[0.5, 0.385, 0]}>
        <mesh geometry={g.lidar} material={paintMat} />
      </group>
      <instancedMesh ref={totes} args={[kitToteGeometry, toteMat, 4]} castShadow />
    </group>
  );
}
