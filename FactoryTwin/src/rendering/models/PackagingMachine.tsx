import { useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import type { Group } from 'three';
import type { PackagingAnim } from './anims';
import { clamp01, smooth01 } from './anims';
import { CARTON_SIZE, Parts, lazy } from './geometries';
import { PALETTE, cartonMat, guardGlassMat, paintMat, screenMat } from './materials';

/** Machine spans local x in [-3, 3]; bed top (carton bottom) at this height. */
export const PACKAGING_BED_TOP = 0.86;
export const PACKAGING_LENGTH = 6;
/** Where a StackLight sits (machine-local). */
export const PACKAGING_LIGHT_MOUNT: [number, number, number] = [2.75, 2.2, -0.7];
const PRESS_X = 1.0;
const PRESS_UP = 1.62;
const CARTON_X0 = -2.7;
const CARTON_X1 = 2.8;

const geo = lazy(() => {
  const L = PACKAGING_LENGTH;
  const W = 1.3;
  const top = 2.15;
  const body = PALETTE.offWhite;
  const accent = PALETTE.teal;
  const p = new Parts()
    // base cabinet
    .box(L, 0.1, W, '#3d4349', [0, 0.05, 0], undefined, 0.02)
    .box(L - 0.04, 0.68, W - 0.1, body, [0, 0.44, 0], undefined, 0.02)
    .box(L - 0.02, 0.06, W - 0.06, accent, [0, 0.8, 0], undefined, 0.01)
    // internal transport: twin side lugs on a dark bed
    .box(L - 0.2, 0.03, 0.62, '#26292d', [0, PACKAGING_BED_TOP - 0.015, 0], undefined, 0.005);
  for (const z of [-0.33, 0.33]) p.box(L - 0.2, 0.06, 0.04, '#9aa3ab', [0, PACKAGING_BED_TOP + 0.03, z], undefined, 0.005);
  // cabinet door seams
  for (let i = -2; i <= 2; i++) {
    p.box(0.008, 0.56, 0.004, '#9ba3ab', [i * 1.2, 0.44, W / 2 - 0.048], undefined, 0);
    p.box(0.008, 0.56, 0.004, '#9ba3ab', [i * 1.2, 0.44, -W / 2 + 0.048], undefined, 0);
  }
  // guard frame: posts and rails (aluminium) along both long sides, roof rails
  const xs = [-3, -1.8, -0.6, 0.6, 1.8, 3];
  for (const x of xs)
    for (const z of [-W / 2 + 0.03, W / 2 - 0.03]) p.box(0.05, top - 0.82, 0.05, '#aab2ba', [Math.max(-2.975, Math.min(2.975, x)), 0.82 + (top - 0.82) / 2, z], undefined, 0.008);
  for (const z of [-W / 2 + 0.03, W / 2 - 0.03]) {
    p.box(L, 0.05, 0.05, '#aab2ba', [0, top, z], undefined, 0.008);
    p.box(L, 0.04, 0.05, '#aab2ba', [0, 1.45, z], undefined, 0.008);
  }
  for (const x of [-2.975, 2.975]) p.box(0.05, 0.05, W - 0.06, '#aab2ba', [x, top, 0], undefined, 0.008);
  // roof panels (solid over the press and the erector)
  p.box(1.3, 0.05, W - 0.04, body, [PRESS_X, top + 0.03, 0], undefined, 0.01);
  p.box(1.5, 0.05, W - 0.04, body, [-2.2, top + 0.03, 0], undefined, 0.01);
  // carton blank magazine (infeed end, -z side, outside the guard)
  p.box(0.9, 1.0, 0.5, body, [-2.3, 0.5, -W / 2 - 0.25], undefined, 0.02);
  p.box(0.92, 0.04, 0.52, accent, [-2.3, 1.0, -W / 2 - 0.25], undefined, 0.01);
  for (let i = 0; i < 9; i++) p.box(0.6, 0.012, 0.46, i % 2 ? PALETTE.kraft : PALETTE.kraftDark, [-2.3, 1.03 + i * 0.013, -W / 2 - 0.25], [0, 0, 0.15], 0);
  // press: pneumatic cylinder housing above the press station
  p.box(0.5, 0.25, 0.5, PALETTE.machineBlue, [PRESS_X, top - 0.1, 0], undefined, 0.03);
  p.cyl(0.07, 0.07, 0.35, '#c3c9cf', [PRESS_X, top - 0.35, 0], undefined, 16);
  // tape head after the press
  p.box(0.12, 0.42, 0.18, '#3d4349', [2.15, PACKAGING_BED_TOP + 0.6, 0], undefined, 0.02);
  p.cylZ(0.1, 0.05, '#c8a46e', [2.15, PACKAGING_BED_TOP + 0.68, 0.11], 20);
  p.cylZ(0.04, 0.052, '#e9e2d0', [2.15, PACKAGING_BED_TOP + 0.68, 0.11], 14);
  // flap folding rails
  for (const z of [-0.2, 0.2]) p.bar([-0.6, 1.25, z * 1.6], [0.6, PACKAGING_BED_TOP + CARTON_SIZE.y + 0.04, z * 0.5], 0.025, '#c3c9cf');
  // HMI pedestal on +z side near infeed
  p.box(0.08, 0.6, 0.08, '#3d4349', [-1.2, 1.15, W / 2 + 0.08], undefined, 0.01);
  p.box(0.45, 0.32, 0.07, '#24282d', [-1.2, 1.55, W / 2 + 0.1], [0.2, 0, 0], 0.015);
  // e-stops
  for (const x of [-2.9, 2.9]) {
    p.box(0.1, 0.1, 0.06, '#f5c400', [x, 1.25, W / 2 + 0.02], undefined, 0.01);
    p.cylZ(0.03, 0.04, '#d32f2f', [x, 1.25, W / 2 + 0.06], 12);
  }
  const bodyGeo = p.build();

  const glass = new Parts();
  for (const z of [-W / 2 + 0.03, W / 2 - 0.03]) {
    for (let i = 0; i < 5; i++) {
      const x0 = -3 + i * 1.2;
      glass.box(1.15, top - 0.88, 0.01, '#fff', [x0 + 0.6, 0.85 + (top - 0.88) / 2, z], undefined, 0);
    }
  }
  glass.box(1.6, 0.01, W - 0.1, '#fff', [-0.3, top + 0.02, 0], undefined, 0);
  glass.box(1.3, 0.01, W - 0.1, '#fff', [2.3, top + 0.02, 0], undefined, 0);
  const glassGeo = glass.build();

  const press = new Parts()
    .cyl(0.035, 0.035, 0.5, '#d9dee3', [0, 0.25, 0], undefined, 12)
    .box(0.46, 0.05, 0.5, '#59626b', [0, 0, 0], undefined, 0.01)
    .box(0.4, 0.03, 0.44, '#202326', [0, -0.035, 0], undefined, 0.005)
    .build();

  const flap = new Parts().box(CARTON_SIZE.x - 0.01, 0.006, CARTON_SIZE.z / 2 - 0.005, PALETTE.kraft, [0, 0, -(CARTON_SIZE.z / 4)], undefined, 0).build();
  const carton = new Parts()
    .box(CARTON_SIZE.x, CARTON_SIZE.y, CARTON_SIZE.z, PALETTE.kraft, [0, CARTON_SIZE.y / 2, 0], undefined, 0.004)
    .box(CARTON_SIZE.x - 0.02, 0.003, CARTON_SIZE.z - 0.02, '#4a3820', [0, CARTON_SIZE.y + 0.0005, 0], undefined, 0)
    .build();
  const screen = new Parts().box(0.38, 0.25, 0.01, '#fff', [-1.2, 1.55, W / 2 + 0.14], [0.2, 0, 0], 0).build();
  return { body: bodyGeo, glass: glassGeo, press, flap, carton, screen };
});

/** Carton x along the line for a cycle progress (erect+fill, fold, press dwell, tape+exit). */
export function packagingCartonX(progress: number): number {
  const p = clamp01(progress);
  if (p < 0.4) return CARTON_X0 + ((PRESS_X - 0.6 - CARTON_X0) * smooth01(p / 0.4));
  if (p < 0.55) return PRESS_X - 0.6 + 0.6 * smooth01((p - 0.4) / 0.15);
  if (p < 0.75) return PRESS_X;
  return PRESS_X + (CARTON_X1 - PRESS_X) * smooth01((p - 0.75) / 0.25);
}

export type PackagingMachineProps = ThreeElements['group'] & { anim: PackagingAnim };

/**
 * Case packer, 6 m along local x (infeed at -x). Carton travels through the machine with
 * progress, flaps fold, the top press strokes, then it exits. Guards with amber windows.
 * Draw calls: 7 (+3 shadow).
 */
export function PackagingMachine({ anim, ...props }: PackagingMachineProps) {
  const g = geo();
  const press = useRef<Group>(null);
  const carton = useRef<Group>(null);
  const flapA = useRef<Group>(null);
  const flapB = useRef<Group>(null);

  useFrame(() => {
    if (!press.current || !carton.current || !flapA.current || !flapB.current) return;
    const p = clamp01(anim.progress);
    const run = anim.running;
    // press strokes between 0.58 and 0.72
    const s = run && p > 0.58 && p < 0.72 ? Math.sin(((p - 0.58) / 0.14) * Math.PI) : 0;
    const cartonTop = PACKAGING_BED_TOP + CARTON_SIZE.y;
    press.current.position.y = PRESS_UP - (PRESS_UP - cartonTop - 0.06) * s;
    const c = carton.current;
    c.visible = anim.hasCarton;
    if (anim.hasCarton) {
      c.position.x = packagingCartonX(p);
      // flaps: open (2.3 rad) until 0.4, folded flat by 0.56
      const f = 2.3 * (1 - smooth01((p - 0.4) / 0.16));
      flapA.current.rotation.x = f;
      flapB.current.rotation.x = f;
    }
  });

  const hz = CARTON_SIZE.z / 2;
  return (
    <group {...props}>
      <mesh geometry={g.body} material={paintMat} castShadow receiveShadow />
      <mesh geometry={g.glass} material={guardGlassMat} />
      <mesh geometry={g.screen} material={screenMat} />
      <group ref={press} position={[PRESS_X, PRESS_UP, 0]}>
        <mesh geometry={g.press} material={paintMat} castShadow />
      </group>
      <group ref={carton} position={[CARTON_X0, PACKAGING_BED_TOP, 0]} visible={false}>
        <mesh geometry={g.carton} material={cartonMat} castShadow />
        <group ref={flapA} position={[0, CARTON_SIZE.y, hz]}>
          <mesh geometry={g.flap} material={cartonMat} />
        </group>
        <group rotation={[0, Math.PI, 0]} position={[0, CARTON_SIZE.y, -hz]}>
          <group ref={flapB}>
            <mesh geometry={g.flap} material={cartonMat} />
          </group>
        </group>
      </group>
    </group>
  );
}
