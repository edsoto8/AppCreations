import { BoxGeometry, CylinderGeometry, Group, Shape, TorusGeometry, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { BuildContext } from '../shared/context';
import { coilSpring, extrudeY, lathe, mat } from '../shared/geometry';
import { WHEEL_Z } from './layout';

const WR = ROBOT.wheelRadius;
const HALF_W = ROBOT.wheelWidth / 2;

/**
 * Drive wheel: treaded chevron tyre, brushed turbine hub, anodized cap. `spin` rotates about the
 * axle (local Z). side = +1 for the left wheel (+Z), -1 for the right wheel.
 */
export function buildWheel(ctx: BuildContext, side: 1 | -1): { root: Group; spin: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = side > 0 ? 'leftWheel' : 'rightWheel';
  root.position.set(0, WR, side * WHEEL_Z);
  const spin = new Group();
  root.add(spin);
  // Built with the axle along +Y (outer face toward +Y) then turned so +Y points away from the robot.
  const toAxle = mat(0, 0, 0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0);
  const b = ctx.builder();
  const add = (g: BufferGeometry, m: Parameters<typeof b.add>[1], local = mat(0, 0, 0)): void => {
    b.add(g, m, local.premultiply(toAxle));
  };
  const base = WR - 0.0024;
  add(lathe([[0.0262, -HALF_W + 0.0002], [base - 0.0012, -HALF_W + 0.0002, 0.002], [base, -HALF_W + 0.0022, 0.0015], [base, HALF_W - 0.0022, 0.0015], [base - 0.0012, HALF_W - 0.0002, 0.002], [0.0262, HALF_W - 0.0002]], q.radial / 2, q.fillet), mats.rubber);
  const lug = q.level === 'low' ? new BoxGeometry(0.0042, 0.0085, 0.0026) : new RoundedBoxGeometry(0.0042, 0.0085, 0.0026, 1, 0.0006);
  for (let k = 0; k < q.treadLugs; k++) {
    const th = (k / q.treadLugs) * Math.PI * 2;
    const r = base + 0.0012;
    for (const s of [1, -1]) {
      const th2 = th + s * 0.035;
      add(lug.clone(), mats.rubber, mat(Math.sin(th2) * r, s * 0.0046, Math.cos(th2) * r, 0, th2, s * 0.42));
    }
  }
  lug.dispose();
  // Sidewall ribs (outer face).
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    add(new BoxGeometry(0.0008, 0.0006, 0.0042), mats.rubber, mat(Math.sin(th) * 0.0295, HALF_W - 0.0001, Math.cos(th) * 0.0295, 0, th, 0));
  }
  // Hub face: turbine disc with five windows.
  const face = new Shape();
  face.absarc(0, 0, 0.0246, 0, Math.PI * 2, false);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const h = new Shape();
    h.absarc(Math.cos(a) * 0.0152, Math.sin(a) * 0.0152, 0.0054, 0, Math.PI * 2, true);
    face.holes.push(h);
  }
  add(extrudeY(face, HALF_W - 0.0048, HALF_W - 0.0014, { bevel: 0.0006, bevelSegments: q.bevel, curveSegments: q.curve }), mats.brushedAlu);
  add(lathe([[0.0238, HALF_W - 0.0032], [0.0266, HALF_W - 0.0032, 0], [0.0268, HALF_W - 0.0008, 0.0006], [0.0238, HALF_W - 0.0008]], q.radial / 2, q.fillet), mats.brushedAlu);
  add(new CylinderGeometry(0.025, 0.025, 0.001, q.radial / 2), mats.titanium, mat(0, -0.001, 0));
  add(new CylinderGeometry(0.0262, 0.0262, ROBOT.wheelWidth - 0.002, q.radial / 2, 1, true), mats.titanium);
  add(lathe([[0.0088, HALF_W - 0.0016], [0.0088, HALF_W - 0.0002, 0.0006], [0.0062, HALF_W + 0.0007, -1], [0, HALF_W + 0.001]], q.radialSmall * 2, q.fillet), mats.champagne);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5;
    add(new CylinderGeometry(0.0009, 0.0009, 0.0012, 8), mats.brushedAlu, mat(Math.sin(a) * 0.0108, HALF_W - 0.001, Math.cos(a) * 0.0108));
  }
  b.build(spin, { castShadow: true, receiveShadow: true, name: root.name });
  return { root, spin };
}

export const PIVOT = { x: 0.058, y: 0.04, z: 0.097 } as const;
const ARM_LEN = Math.hypot(PIVOT.x, PIVOT.y - WR);
const SPRING_AT = 0.03;
const SPRING_TOP_Y = 0.071;

/** Trailing suspension arms with integrated drive gearbox + motor, and coil springs. */
export class Suspension {
  readonly root: Group;
  private readonly arms: Group[] = [];
  private readonly springs: Group[] = [];

  constructor(ctx: BuildContext) {
    const { q, mats } = ctx;
    this.root = new Group();
    this.root.name = 'suspension';
    for (const s of [1, -1] as const) {
      const arm = new Group();
      arm.position.set(PIVOT.x, PIVOT.y, s * PIVOT.z);
      this.root.add(arm);
      this.arms.push(arm);
      const b = ctx.builder();
      b.add(new RoundedBoxGeometry(ARM_LEN + 0.022, 0.02, 0.013, 2, 0.004), mats.titanium, mat(-ARM_LEN / 2 + 0.004, 0, 0));
      b.add(new CylinderGeometry(0.0085, 0.0085, 0.0145, q.radialSmall), mats.titanium, mat(-ARM_LEN, 0, 0, Math.PI / 2, 0, 0));
      b.add(new CylinderGeometry(0.0035, 0.0035, 0.012, q.radialSmall), mats.steel, mat(-ARM_LEN, 0, s * 0.008, Math.PI / 2, 0, 0));
      // Drive motor coaxial with the pivot, extending inboard.
      b.add(new CylinderGeometry(0.0105, 0.0105, 0.03, q.radialSmall * 2), mats.steel, mat(0, 0, -s * 0.021, Math.PI / 2, 0, 0));
      b.add(new CylinderGeometry(0.0108, 0.0108, 0.004, q.radialSmall * 2), mats.titanium, mat(0, 0, -s * 0.03, Math.PI / 2, 0, 0));
      b.add(new CylinderGeometry(0.0075, 0.0075, 0.003, q.radialSmall), mats.titanium, mat(0, 0, -s * 0.0375, Math.PI / 2, 0, 0));
      for (let k = 0; k < 3; k++) {
        b.add(new BoxGeometry(0.008, 0.0012, 0.0135), mats.titanium, mat(-0.012 - k * 0.012, 0.0102, 0));
      }
      b.build(arm, { castShadow: true, name: 'arm' });

      const spring = new Group();
      this.root.add(spring);
      this.springs.push(spring);
      const sb = ctx.builder();
      sb.add(coilSpring(0.0045, 0.0007, 1, 7, q.level === 'low' ? 48 : 96, 6), mats.steel);
      sb.build(spring, { name: 'spring' });
    }
  }

  /** lift = chassis rise (m) relative to the wheels. Allocation-free. */
  update(lift: number): void {
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const arm = this.arms[i];
      const py = PIVOT.y + lift;
      arm.position.y = py;
      const ang = Math.atan2(WR - py, -PIVOT.x) - Math.PI;
      arm.rotation.z = ang;
      // Spring from a point on the arm up to the chassis.
      const ax = PIVOT.x - Math.cos(ang) * SPRING_AT;
      const ay = py - Math.sin(ang) * SPRING_AT + 0.0102;
      const spring = this.springs[i];
      spring.position.set(ax, ay, s * PIVOT.z);
      spring.scale.y = Math.max(0.001, SPRING_TOP_Y + lift - ay);
    }
  }
}

/** Front swivel caster. `swivel` yaws about +Y; `lift` compensation keeps the wheel on the floor. */
export function buildCaster(ctx: BuildContext): { root: Group; swivel: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'caster';
  root.position.set(ROBOT.casterOffsetX, 0, 0);
  const cup = ctx.builder();
  cup.add(lathe([[0, 0.034], [0.019, 0.034, 0], [0.019, 0.0205]], q.radialSmall * 2, 1), mats.blackMatte);
  cup.add(new TorusGeometry(0.0176, 0.0011, 6, q.radialSmall * 2), mats.titanium, mat(0, 0.0198, 0, Math.PI / 2, 0, 0));
  cup.build(root, { name: 'caster-cup' });
  const swivel = new Group();
  swivel.position.y = 0.026;
  root.add(swivel);
  const b = ctx.builder();
  const r = 0.012;
  b.add(new CylinderGeometry(0.011, 0.011, 0.003, q.radialSmall * 2), mats.graphite, mat(0, -0.0015, 0));
  for (const s of [1, -1]) {
    b.add(new RoundedBoxGeometry(0.022, 0.017, 0.0022, 1, 0.0008), mats.graphite, mat(-0.004, -0.0095, s * 0.0062));
  }
  const wheelLocal = (x: number, y: number): ReturnType<typeof mat> => mat(-0.004 + x, -0.014 + y, 0, Math.PI / 2, 0, 0);
  b.add(lathe([[0.0075, -0.0042], [r - 0.001, -0.0042, 0.0015], [r, -0.003, 0.0015], [r, 0.003, 0.0015], [r - 0.001, 0.0042, 0.0015], [0.0075, 0.0042]], q.radialSmall * 2, q.fillet), mats.rubberGrey, wheelLocal(0, 0));
  b.add(new CylinderGeometry(0.0076, 0.0076, 0.0088, q.radialSmall * 2), mats.brushedAlu, wheelLocal(0, 0));
  b.add(new CylinderGeometry(0.0022, 0.0022, 0.0134, q.radialSmall), mats.chrome, wheelLocal(0, 0));
  b.build(swivel, { castShadow: true, name: 'caster' });
  return { root, swivel };
}
