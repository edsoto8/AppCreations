import type { SimConfig, SuctionLevel, WaterLevel } from '../config';
import { clamp } from '../core/math';

export interface PowerInputs {
  /** |linear velocity| (m/s) */
  speed: number;
  /** |angular velocity| (rad/s) */
  turnRate: number;
  /** Surface drag multiplier (carpet > 1). */
  drag: number;
  lidarOn: boolean;
  brushesOn: boolean;
  suction: SuctionLevel | null;
  mopping: boolean;
  /** Robot is on the dock contacts receiving power. */
  charging: boolean;
}

export interface PowerBreakdown {
  base: number;
  lidar: number;
  drive: number;
  brushes: number;
  suction: number;
  mop: number;
  total: number;
  charge: number;
}

/**
 * Battery and consumables, integrated purely in simulated time. Energy bookkeeping in Wh;
 * state of charge = energy / capacity. Charging uses a CC/CV-like taper above 80 %.
 */
export class Resources {
  energyWh: number;
  readonly power: PowerBreakdown = { base: 0, lidar: 0, drive: 0, brushes: 0, suction: 0, mop: 0, total: 0, charge: 0 };
  /** Solids in the robot's dustbin (g). */
  dustbin = 0;
  /** Robot clean water (ml). */
  cleanWater: number;
  /** Robot dirty water / recovered liquid (ml). */
  dirtyWater = 0;
  /** Mop pad soiling 0..1. */
  padSoil = 0;
  /** Mop pad wetness 0..1. */
  padWetness = 0;
  /** Lifetime accumulators (Wh, ml). */
  energyUsedWh = 0;
  waterUsed = 0;

  constructor(private readonly cfg: SimConfig) {
    this.energyWh = cfg.battery.capacityWh;
    this.cleanWater = cfg.water.tankCapacity;
  }

  get soc(): number {
    return clamp(this.energyWh / this.cfg.battery.capacityWh, 0, 1);
  }

  set soc(v: number) {
    this.energyWh = clamp(v, 0, 1) * this.cfg.battery.capacityWh;
  }

  get binFill(): number {
    return clamp(this.dustbin / this.cfg.cleaning.dustbinCapacity, 0, 1);
  }

  get cleanWaterFrac(): number {
    return clamp(this.cleanWater / this.cfg.water.tankCapacity, 0, 1);
  }

  get dirtyWaterFrac(): number {
    return clamp(this.dirtyWater / this.cfg.water.dirtyCapacity, 0, 1);
  }

  /** Integrate power draw / charging for one step. Returns the net power (W, positive = discharge). */
  step(dt: number, p: PowerInputs): number {
    const b = this.cfg.battery;
    const pw = this.power;
    pw.base = b.basePower;
    pw.lidar = p.lidarOn ? b.lidarPower : 0;
    pw.drive = b.drivePower * (Math.min(1, p.speed / this.cfg.robot.maxSpeed) * 0.85 + Math.min(1, p.turnRate / this.cfg.robot.maxTurnRate) * 0.35) * p.drag;
    pw.brushes = p.brushesOn ? b.brushPower * p.drag : 0;
    pw.suction = p.suction ? b.suctionPower[p.suction] : 0;
    pw.mop = p.mopping ? b.mopPower : 0;
    pw.total = pw.base + pw.lidar + pw.drive + pw.brushes + pw.suction + pw.mop;
    pw.charge = 0;
    if (p.charging) {
      const soc = this.soc;
      // Constant power to 80 %, then linear taper to 15 % of rated power near full.
      const taper = soc < 0.8 ? 1 : Math.max(0.15, 1 - (soc - 0.8) / 0.2);
      pw.charge = soc >= 1 ? 0 : b.chargePower * taper;
    }
    const net = pw.total - pw.charge;
    const dWh = (net * dt) / 3600;
    if (dWh > 0) this.energyUsedWh += dWh;
    this.energyWh = clamp(this.energyWh - dWh, 0, b.capacityWh);
    return net;
  }

  /** Dispense mop water for one step; returns the wetness achieved (0..1). */
  dispenseWater(dt: number, level: WaterLevel, moving: boolean): number {
    if (!moving) {
      this.padWetness = Math.max(0, this.padWetness - dt * 0.002);
      return this.padWetness;
    }
    const want = this.cfg.water.flowRate[level] * dt;
    const got = Math.min(want, this.cleanWater);
    this.cleanWater -= got;
    this.waterUsed += got;
    // Half the dispensed water ends up wrung back into the recovery tank.
    this.dirtyWater = Math.min(this.cfg.water.dirtyCapacity, this.dirtyWater + got * 0.5);
    const target = got >= want * 0.99 ? 1 : got / Math.max(1e-9, want);
    this.padWetness += (target - this.padWetness) * Math.min(1, dt * 0.5);
    return this.padWetness;
  }

  collect(solids: number, liquid: number, stain: number): void {
    this.dustbin = Math.min(this.cfg.cleaning.dustbinCapacity, this.dustbin + solids);
    this.dirtyWater = Math.min(this.cfg.water.dirtyCapacity, this.dirtyWater + liquid);
    this.padSoil = clamp(this.padSoil + liquid * 0.0015 + stain * 0.02 + solids * 0.0002, 0, 1);
  }

  /** Watt-hours needed to drive `distance` meters back to the dock at travel speed (with margin). */
  energyForTravel(distance: number): number {
    const b = this.cfg.battery;
    const speed = this.cfg.robot.maxSpeed * 0.85;
    const watts = b.basePower + b.lidarPower + b.drivePower * 0.85;
    return ((distance / speed) * watts) / 3600;
  }
}
