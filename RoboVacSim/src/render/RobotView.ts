import type { Simulation } from '../sim/Simulation';
import type { RobotMode } from '../sim/mission/types';
import { wrapAngle } from '../sim/core/math';
import { createRobotModel } from './models/robot';
import { createDockModel } from './models/dock';
import type { DockAnimState, DockModel, LedMode, RobotAnimState, RobotModel } from './models/types';
import type { Quality } from '../app/types';
import { DOCK } from '../sim/robot/robotSpec';

const LED: Record<RobotMode, LedMode> = {
  idle: 'idle',
  undocking: 'cleaning',
  mapping: 'mapping',
  cleaning: 'cleaning',
  returning: 'returning',
  docking: 'returning',
  maintenance: 'maintenance',
  charging: 'charging',
  manual: 'manual',
  paused: 'paused',
  recovering: 'recovering',
  diagnostic: 'maintenance',
  error: 'error',
};

/** Places the robot model from the simulation pose (smoothed) and maps sim state to its animation. */
export class RobotView {
  readonly model: RobotModel;
  private readonly anim: RobotAnimState = {
    leftWheelAngle: 0,
    rightWheelAngle: 0,
    casterYaw: 0,
    mainBrushAngle: 0,
    sideBrushAngle: 0,
    lidarAngle: 0,
    mopAngle: 0,
    mopLowered: 0,
    bumperCompression: 0,
    bumperHitAngle: 0,
    ledMode: 'idle',
    battery: 1,
    dustbinOpen: 0,
    dustbinFill: 0,
    waterLevel: 1,
    suspensionLift: 0,
    suction: 0,
  };
  /** Smoothed visual pose. */
  readonly pose = { x: 0, y: 0, theta: 0 };
  dustbinTarget = 0;
  private explode = 0;
  private explodeTarget = 0;

  constructor(quality: Quality) {
    this.model = createRobotModel({ quality });
    this.model.root.name = 'robot';
  }

  snap(sim: Simulation): void {
    this.pose.x = sim.body.x;
    this.pose.y = sim.body.y;
    this.pose.theta = sim.body.theta;
  }

  setExplode(t: number): void {
    this.explodeTarget = t;
  }

  update(sim: Simulation, dt: number, time: number): void {
    const b = sim.body;
    // Smooth only small differences (fixed-step jitter at low speeds); snap on large jumps.
    const jump = Math.hypot(b.x - this.pose.x, b.y - this.pose.y);
    const k = sim.clock.speed <= 2 && jump < 0.2 ? Math.min(1, dt * 25) : 1;
    this.pose.x += (b.x - this.pose.x) * k;
    this.pose.y += (b.y - this.pose.y) * k;
    this.pose.theta += wrapAngle(b.theta - this.pose.theta) * k;
    const root = this.model.root;
    const onDock = sim.ctrl.docked || Math.hypot(b.x - sim.layout.dock.x, b.y - sim.layout.dock.y) < 0.2;
    root.position.set(this.pose.x, onDock ? DOCK.baseHeight : 0, this.pose.y);
    root.rotation.y = -this.pose.theta;

    const a = this.anim;
    a.leftWheelAngle = b.leftWheelAngle;
    a.rightWheelAngle = b.rightWheelAngle;
    a.casterYaw = b.casterYaw;
    a.mainBrushAngle = sim.anim.mainBrushAngle;
    a.sideBrushAngle = sim.anim.sideBrushAngle;
    a.lidarAngle = sim.lidar.turretAngle;
    a.mopAngle = sim.anim.mopAngle;
    a.mopLowered = sim.anim.mopLowered;
    a.bumperCompression = b.bumperCompression;
    a.bumperHitAngle = b.bumpAngle;
    a.ledMode = LED[sim.ctrl.mode];
    a.battery = sim.res.soc;
    a.dustbinOpen += (this.dustbinTarget - a.dustbinOpen) * Math.min(1, dt * 4);
    a.dustbinFill = sim.res.binFill;
    a.waterLevel = sim.res.cleanWaterFrac;
    a.suspensionLift = b.suspensionLift;
    a.suction = sim.anim.suction;
    this.explode += (this.explodeTarget - this.explode) * Math.min(1, dt * 4);
    this.model.setExplode(this.explode < 0.001 ? 0 : this.explode);
    this.model.update(a, time, dt);
  }

  dispose(): void {
    this.model.dispose();
  }
}

export class DockView {
  readonly model: DockModel;
  private readonly anim: DockAnimState = { phase: 'idle', phaseProgress: 0, robotDocked: false, cleanWater: 1, dirtyWater: 0, dustBag: 0, robotBattery: 1, statusText: 'READY' };
  private panels = 0;
  panelsTarget = 0;

  constructor(quality: Quality) {
    this.model = createDockModel({ quality });
    this.model.root.name = 'dock';
  }

  place(sim: Simulation): void {
    const d = sim.layout.dock;
    this.model.root.position.set(d.x, 0, d.y);
    this.model.root.rotation.y = -d.theta;
  }

  update(sim: Simulation, dt: number, time: number): void {
    const a = this.anim;
    const dock = sim.dock;
    const cfg = sim.cfg.dock;
    a.phase = dock.phase;
    a.phaseProgress = dock.phaseProgress;
    a.robotDocked = dock.robotDocked;
    a.cleanWater = dock.cleanTank / cfg.cleanTankCapacity;
    a.dirtyWater = dock.dirtyTank / cfg.dirtyTankCapacity;
    a.dustBag = dock.dustBag / cfg.dustBagCapacity;
    a.robotBattery = sim.res.soc;
    const pct = Math.round(sim.res.soc * 100);
    a.statusText = {
      idle: 'READY',
      charging: `CHARGING ${pct}%`,
      dustExtraction: 'SELF-EMPTY',
      mopWash: 'WASHING MOPS',
      waterTransfer: 'WATER EXCHANGE',
      drying: 'DRYING',
      ready: pct < 100 ? `CHARGING ${pct}%` : 'READY',
    }[dock.phase];
    this.panels += (this.panelsTarget - this.panels) * Math.min(1, dt * 4);
    this.model.setPanelsOpen(this.panels < 0.001 ? 0 : this.panels);
    this.model.update(a, time, dt);
  }

  dispose(): void {
    this.model.dispose();
  }
}
