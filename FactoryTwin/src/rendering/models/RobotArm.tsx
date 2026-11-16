import { useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import type { RobotAnim } from './anims';
import { clamp01 } from './anims';
import { Parts, lazy, kitToteGeometry, productAGeometry, productBGeometry, PRODUCT_A_SIZE, PRODUCT_B_SIZE, TOTE_SIZE } from './geometries';
import { PALETTE, metalMat, paintMat, productAMat, productBMat, toteMat } from './materials';
import { ROBOT } from './robotKinematics';

const Y = PALETTE.robotYellow;
const G = PALETTE.darkGrey;
const C = PALETTE.charcoal;
const SH_LOCAL_Y = ROBOT.SHOULDER_HEIGHT - ROBOT.TURNTABLE_Y;

const geo = lazy(() => {
  const L1 = ROBOT.UPPER_ARM;
  const L2 = ROBOT.FOREARM;
  const base = new Parts()
    .box(0.8, 0.33, 0.8, '#5b636b', [0, 0.165, 0], undefined, 0.03)
    .box(0.86, 0.02, 0.86, '#3a4047', [0, 0.01, 0], undefined, 0.005)
    .cyl(0.34, 0.36, 0.14, Y, [0, 0.35 + 0.07, 0], undefined, 32)
    .box(0.18, 0.12, 0.12, C, [-0.36, 0.42, 0], undefined, 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.cyl(0.025, 0.025, 0.03, '#9aa3ab', [sx * 0.33, 0.345, sz * 0.33], undefined, 8);

  const turntable = new Parts()
    .cyl(0.31, 0.33, 0.04, '#2d3137', [0, 0.02, 0], undefined, 32)
    .cyl(0.3, 0.31, 0.16, Y, [0, 0.12, 0], undefined, 32)
    .box(0.46, 0.42, 0.52, Y, [0.06, 0.36, 0], undefined, 0.08)
    // J2 hub
    .cylZ(0.2, 0.56, Y, [ROBOT.SHOULDER_OFFSET, SH_LOCAL_Y, 0], 28)
    .cylZ(0.15, 0.04, '#2d3137', [ROBOT.SHOULDER_OFFSET, SH_LOCAL_Y, 0.3], 24)
    // J2 motor + J1 motor
    .cylZ(0.11, 0.2, G, [ROBOT.SHOULDER_OFFSET - 0.05, SH_LOCAL_Y - 0.02, -0.38], 20)
    .cylZ(0.085, 0.03, '#15171a', [ROBOT.SHOULDER_OFFSET - 0.05, SH_LOCAL_Y - 0.02, -0.495], 20)
    .cyl(0.09, 0.09, 0.2, G, [-0.22, 0.32, 0.18], undefined, 18)
    .cyl(0.07, 0.07, 0.025, '#15171a', [-0.22, 0.43, 0.18], undefined, 18);

  const upper = new Parts()
    .box(L1, 0.26, 0.24, Y, [L1 / 2, 0, 0], undefined, 0.07)
    .box(L1 * 0.62, 0.17, 0.25, '#e3a800', [L1 * 0.5, 0, 0], undefined, 0.05)
    .cylZ(0.16, 0.42, Y, [L1, 0, 0], 26)
    .cylZ(0.11, 0.03, '#2d3137', [L1, 0, 0.22], 20)
    .cylZ(0.11, 0.03, '#2d3137', [L1, 0, -0.22], 20)
    // cable dress
    .cylX(0.025, L1 * 0.8, C, [L1 * 0.5, 0.15, 0.06], 8);

  const fore = new Parts()
    .box(0.62, 0.3, 0.3, Y, [-0.03, 0, 0], undefined, 0.09)
    .cylX(0.1, 0.2, G, [-0.42, 0.02, 0], 18)
    .cylX(0.08, 0.025, '#15171a', [-0.53, 0.02, 0], 18)
    .cyl(0.075, 0.105, L2 - 0.3, Y, [0.3 + (L2 - 0.3) / 2 - 0.02, 0, 0], [0, 0, -Math.PI / 2], 22)
    .cylZ(0.095, 0.2, Y, [L2, 0, 0], 22)
    .cylZ(0.07, 0.21, '#2d3137', [L2, 0, 0], 18);

  const wrist = new Parts()
    .cylX(0.065, 0.1, '#3a4047', [0.06, 0, 0], 20)
    .cylX(0.07, 0.02, '#9aa3ab', [0.115, 0, 0], 20)
    .box(0.08, 0.11, 0.24, C, [0.165, 0, 0], undefined, 0.015)
    .box(0.015, 0.02, 0.26, '#9aa3ab', [0.21, 0, 0], undefined, 0.003);

  const finger = new Parts()
    .box(0.14, 0.05, 0.022, '#b8c0c8', [0.07, 0, 0], undefined, 0.006)
    .box(0.03, 0.05, 0.012, '#2a2c30', [0.125, 0, -0.012], undefined, 0.003);

  return {
    base: base.build(),
    turntable: turntable.build(),
    upper: upper.build(),
    fore: fore.build(),
    wrist: wrist.build(),
    finger: finger.build(),
  };
});

/** Carried item offset along the tool axis so the grip point sits between the finger tips. */
const CARRY_X = [0, ROBOT.TOOL_LENGTH - 0.02 + TOTE_SIZE.y, ROBOT.TOOL_LENGTH + PRODUCT_A_SIZE.height / 2, ROBOT.TOOL_LENGTH + PRODUCT_B_SIZE.height / 2];

export type RobotArmProps = ThreeElements['group'] & { anim: RobotAnim };

/**
 * 6-axis-style industrial robot. Base at local origin (floor), reaching +x at base = 0.
 * Draw calls: 8 (+6 shadow). Joint conventions in robotKinematics.ts.
 */
export function RobotArm({ anim, ...props }: RobotArmProps) {
  const g = geo();
  const turn = useRef<Group>(null);
  const shoulder = useRef<Group>(null);
  const elbow = useRef<Group>(null);
  const wrist = useRef<Group>(null);
  const fA = useRef<Group>(null);
  const fB = useRef<Group>(null);
  const carry = useRef<Mesh>(null);

  useFrame(() => {
    if (!turn.current || !shoulder.current || !elbow.current || !wrist.current || !fA.current || !fB.current || !carry.current) return;
    turn.current.rotation.y = anim.base;
    shoulder.current.rotation.z = anim.shoulder;
    elbow.current.rotation.z = anim.elbow;
    wrist.current.rotation.z = anim.wrist;
    const half = 0.04 + clamp01(anim.grip) * 0.08;
    fA.current.position.z = half;
    fB.current.position.z = -half;
    const c = carry.current;
    if (anim.carry === 0) {
      c.visible = false;
    } else {
      c.visible = true;
      const geom = anim.carry === 1 ? kitToteGeometry : anim.carry === 2 ? productAGeometry : productBGeometry;
      const mat = anim.carry === 1 ? toteMat : anim.carry === 2 ? productAMat : productBMat;
      if (c.geometry !== geom) c.geometry = geom;
      if (c.material !== mat) c.material = mat;
      // item "up" (+y) maps to -x of the tool frame; its origin is its bottom centre
      c.position.x = CARRY_X[anim.carry];
    }
  });

  return (
    <group {...props}>
      <mesh geometry={g.base} material={paintMat} castShadow receiveShadow />
      <group ref={turn} position={[0, ROBOT.TURNTABLE_Y, 0]}>
        <mesh geometry={g.turntable} material={paintMat} castShadow />
        <group ref={shoulder} position={[ROBOT.SHOULDER_OFFSET, SH_LOCAL_Y, 0]}>
          <mesh geometry={g.upper} material={paintMat} castShadow />
          <group ref={elbow} position={[ROBOT.UPPER_ARM, 0, 0]}>
            <mesh geometry={g.fore} material={paintMat} castShadow />
            <group ref={wrist} position={[ROBOT.FOREARM, 0, 0]}>
              <mesh geometry={g.wrist} material={paintMat} castShadow />
              <group ref={fA} position={[0.2, 0, 0.08]}>
                <mesh geometry={g.finger} material={metalMat} />
              </group>
              <group ref={fB} position={[0.2, 0, -0.08]} scale={[1, 1, -1]}>
                <mesh geometry={g.finger} material={metalMat} />
              </group>
              <mesh ref={carry} rotation={[0, 0, Math.PI / 2]} visible={false} castShadow />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
