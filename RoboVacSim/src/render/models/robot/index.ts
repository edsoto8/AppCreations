import { Group, type Vector3 } from 'three';
import { ROBOT } from '../../../sim/robot/robotSpec';
import type { RobotAnimState, RobotModel } from '../types';
import { createBuildContext } from '../shared/context';
import { ExplodeRig } from '../shared/ExplodeRig';
import { ParticleStream, type ParticlePath } from '../shared/ParticleStream';
import { PartRegistry } from '../shared/PartRegistry';
import type { ModelQuality } from '../shared/quality';
import {
  buildBumper,
  buildButtons,
  buildCamera,
  buildChargeContacts,
  buildChassis,
  buildCliffSensors,
  buildTopCover,
} from './body';
import { buildMainBrushes, buildMopModule, buildSideBrush } from './cleaning';
import { ROBOT_PARTS } from './descriptions';
import { buildCaster, buildWheel, Suspension } from './drive';
import { buildBattery, buildImu, buildMainboard, buildSuctionFan } from './internals';
import { LIFT_TRAVEL, MOP_DROP } from './layout';
import { LedRing } from './led';
import { buildLidar } from './lidar';
import { buildDustbin, buildHepaFilter, buildWaterTank } from './storage';

export type { ModelQuality } from '../shared/quality';

export interface RobotModelOptions {
  quality?: ModelQuality;
}

const EXPLODE_LIFT = 0.12;
const LID_MAX = (105 * Math.PI) / 180;
const FILL_MAX_H = 0.034;
const WATER_MAX_H = 0.0362;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Debris drawn from the floor (and from the side brush) into the roller intake, then up to the bin. */
const intakePath: ParticlePath = (p, a, b, c, out: Vector3) => {
  let sx: number;
  let sz: number;
  if (c < 0.3) {
    const th = a * Math.PI * 2;
    sx = ROBOT.sideBrushX + Math.cos(th) * 0.06;
    sz = ROBOT.sideBrushZ + Math.sin(th) * 0.06;
  } else {
    sx = 0.02 + a * 0.1;
    sz = (b - 0.5) * 0.25;
  }
  const mx = ROBOT.mainBrushX + (a - 0.5) * 0.03;
  const mz = (b - 0.5) * 0.18;
  if (p < 0.75) {
    const t = p / 0.75;
    const e = t * t;
    out.set(sx + (mx - sx) * e, 0.0018 + Math.sin(t * Math.PI) * 0.003 + e * 0.004, sz + (mz - sz) * e);
  } else {
    const t = (p - 0.75) / 0.25;
    out.set(mx + (-0.03 - mx) * t, 0.0058 + t * 0.027, mz * (1 - t * 0.5));
  }
};

export function createRobotModel(opts?: RobotModelOptions): RobotModel {
  const ctx = createBuildContext(opts?.quality);
  const { mats, q } = ctx;
  const root = new Group();
  root.name = 'RobotModel';
  const assembly = new Group();
  assembly.name = 'assembly';
  root.add(assembly);
  const body = new Group();
  body.name = 'sprungBody';
  assembly.add(body);

  const chassis = buildChassis(ctx);
  const cover = buildTopCover(ctx);
  const buttons = buildButtons(ctx);
  const lidar = buildLidar(ctx);
  const led = new LedRing(ctx);
  const bumper = buildBumper(ctx);
  const camera = buildCamera(ctx);
  const cliff = buildCliffSensors(ctx);
  const contacts = buildChargeContacts(ctx);
  const caster = buildCaster(ctx);
  const sideBrush = buildSideBrush(ctx);
  const brushes = buildMainBrushes(ctx);
  const mop = buildMopModule(ctx);
  const bin = buildDustbin(ctx);
  const hepa = buildHepaFilter(ctx);
  const tank = buildWaterTank(ctx);
  const battery = buildBattery(ctx);
  const board = buildMainboard(ctx);
  const imu = buildImu(ctx);
  const fan = buildSuctionFan(ctx);
  const leftWheel = buildWheel(ctx, 1);
  const rightWheel = buildWheel(ctx, -1);
  const suspension = new Suspension(ctx);

  const bodyParts = [
    chassis.root, cover.root, buttons.root, lidar.root, led.root, bumper.root, camera.root, cliff.root, contacts.root,
    caster.root, sideBrush.root, brushes.root, mop.root, bin.root, hepa.root, tank.root, battery.root, board.root,
    imu.root, fan.root,
  ];
  body.add(...bodyParts);
  assembly.add(leftWheel.root, rightWheel.root, suspension.root);

  const intake = new ParticleStream(
    {
      count: 120 * q.particles,
      color: 0xd8d2c4,
      size: 0.0028,
      opacity: 0.9,
      speed: 0.85,
      speedJitter: 0.5,
      sprite: ctx.tex.get('sprite'),
    },
    intakePath,
    ctx.track,
  );
  intake.points.name = 'intakeParticles';
  body.add(intake.points);

  const registry = new PartRegistry();
  const register = (id: string, object: Group): void => {
    const info = ROBOT_PARTS[id];
    registry.addPart(id, info.name, info.description, object);
  };
  register('topCover', cover.root);
  register('lidar', lidar.root);
  register('ledRing', led.root);
  register('buttons', buttons.root);
  register('bumper', bumper.root);
  register('camera', camera.root);
  register('cliffSensors', cliff.root);
  register('chargingContacts', contacts.root);
  register('leftWheel', leftWheel.root);
  register('rightWheel', rightWheel.root);
  register('suspension', suspension.root);
  register('caster', caster.root);
  register('sideBrush', sideBrush.root);
  register('mainBrush', brushes.root);
  register('mopPads', mop.root);
  register('dustbin', bin.root);
  register('hepaFilter', hepa.root);
  register('waterTank', tank.root);
  register('battery', battery.root);
  register('mainboard', board.root);
  register('imu', imu.root);
  register('suctionFan', fan.root);
  register('chassis', chassis.root);
  registry.markDynamic(mats.ventGlow);
  registry.markDynamic(led.diffuserMaterial);

  const rig = new ExplodeRig();
  rig.add(cover.root, [0, 0.17, 0], 0.2);
  rig.add(buttons.root, [0, 0.185, 0], 0.2);
  rig.add(lidar.root, [0, 0.235, 0], 0.3);
  rig.add(led.root, [0, 0.14, 0], 0.15);
  rig.add(bumper.root, [0.11, 0.03, 0], 0.1);
  rig.add(camera.root, [0.155, 0.045, 0], 0.15);
  rig.add(bin.root, [-0.02, 0.105, 0], 0.15);
  rig.add(hepa.root, [-0.07, 0.135, 0], 0.25);
  rig.add(tank.root, [-0.12, 0.02, 0], 0.1);
  rig.add(battery.root, [0, 0.04, 0], 0);
  rig.add(board.root, [0.02, 0.1, 0], 0.1);
  rig.add(imu.root, [0.02, 0.13, 0], 0.15);
  rig.add(fan.root, [-0.02, 0.075, 0.075], 0.1);
  rig.add(leftWheel.root, [0, -0.02, 0.09], 0);
  rig.add(rightWheel.root, [0, -0.02, -0.09], 0);
  rig.add(suspension.root, [0, -0.012, 0], 0);
  rig.add(caster.root, [0.02, -0.05, 0], 0);
  rig.add(sideBrush.root, [0.03, -0.06, -0.04], 0);
  rig.add(brushes.root, [0, -0.07, 0], 0);
  rig.add(mop.root, [-0.03, -0.1, 0], 0);
  rig.add(cliff.root, [0, -0.03, 0], 0);
  rig.add(contacts.root, [0.02, -0.04, 0], 0);

  let fanAngle = 0;
  suspension.update(0);

  return {
    root,
    parts: registry.parts,

    update(state: RobotAnimState, time: number, dt: number): void {
      const lift = clamp01(state.suspensionLift) * LIFT_TRAVEL;
      body.position.y = lift;
      suspension.update(lift);
      caster.swivel.position.y = 0.026 - lift;
      caster.swivel.rotation.y = state.casterYaw;
      leftWheel.spin.rotation.z = -state.leftWheelAngle;
      rightWheel.spin.rotation.z = -state.rightWheelAngle;
      lidar.rotor.rotation.y = state.lidarAngle;
      sideBrush.spin.rotation.y = state.sideBrushAngle;
      brushes.front.rotation.z = state.mainBrushAngle;
      brushes.rear.rotation.z = -state.mainBrushAngle;
      mop.lower.position.y = -clamp01(state.mopLowered) * MOP_DROP;
      mop.pads[0].rotation.y = state.mopAngle;
      mop.pads[1].rotation.y = -state.mopAngle;

      const push = -clamp01(state.bumperCompression) * ROBOT.bumperTravel;
      bumper.move.position.set(Math.cos(state.bumperHitAngle) * push, 0, Math.sin(state.bumperHitAngle) * push);
      camera.move.position.copy(bumper.move.position);

      cover.lid.rotation.z = clamp01(state.dustbinOpen) * LID_MAX;
      const fill = clamp01(state.dustbinFill);
      bin.fill.visible = fill > 0.01;
      bin.fill.scale.y = Math.max(0.0005, fill * FILL_MAX_H);
      const water = clamp01(state.waterLevel);
      tank.water.visible = water > 0.005;
      tank.water.scale.y = Math.max(0.0005, water * WATER_MAX_H);

      led.update(state.ledMode, state.battery, time);
      const suction = clamp01(state.suction);
      fanAngle = (fanAngle + dt * suction * 240) % (Math.PI * 2);
      fan.impeller.rotation.y = fanAngle;
      mats.ventGlow.emissiveIntensity = suction * (0.75 + 0.08 * Math.sin(time * 11));
      intake.update(dt, suction);
      registry.syncDynamic();
    },

    setExplode(amount: number): void {
      rig.set(amount);
      const t = clamp01(amount);
      assembly.position.y = EXPLODE_LIFT * t * t * (3 - 2 * t);
    },

    setXray(on: boolean): void {
      registry.setXray(on);
    },

    highlight(partId: string | null): void {
      registry.highlight(partId);
    },

    dispose(): void {
      registry.dispose();
      ctx.track.dispose();
      root.clear();
    },
  };
}
