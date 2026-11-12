import type { FloorType } from './world/types';

export type SuctionLevel = 'quiet' | 'standard' | 'turbo' | 'max';
export type WaterLevel = 'low' | 'medium' | 'high';
export type CleanMode = 'vacuum' | 'mop' | 'vacuumMop';

/** All tunable simulation parameters. Units: meters, seconds (simulated), watts, watt-hours, grams, ml. */
export interface SimConfig {
  seed: number;
  stepDt: number;
  robot: {
    maxSpeed: number;
    cleaningSpeed: number;
    edgeSpeed: number;
    maxTurnRate: number;
    accel: number;
    angularAccel: number;
    /** Std-dev of multiplicative wheel slip noise (odometry is perfect-ish; true pose is used for the map — see ROBOTICS.md). */
    wheelSlipNoise: number;
  };
  lidar: {
    range: number;
    minRange: number;
    raysPerRevolution: number;
    spinHz: number;
    /** Range noise std-dev (m). */
    noise: number;
    /** Probability a ray returns nothing (dropout). */
    dropout: number;
    /** Keep this many recent points for visualisation. */
    pointCloudSize: number;
  };
  mapping: {
    cellSize: number;
    inflationRadius: number;
    safetyMargin: number;
    /** Costmap rebuild interval (s). */
    costmapInterval: number;
  };
  navigation: {
    laneSpacing: number;
    replanInterval: number;
    stuckTimeout: number;
    stuckMinProgress: number;
    maxRecoveryAttempts: number;
    waypointSkipAfterFailures: number;
  };
  cleaning: {
    /** Fraction of dust picked per full pass at standard suction on hard floor at nominal speed. */
    baseVacuumEfficiency: number;
    baseMopEfficiency: number;
    nominalSpeed: number;
    /** Dustbin capacity (g). */
    dustbinCapacity: number;
  };
  battery: {
    capacityWh: number;
    /** Charging power (W). */
    chargePower: number;
    lowThreshold: number;
    resumeThreshold: number;
    criticalThreshold: number;
    basePower: number;
    lidarPower: number;
    /** Drive power at max speed (W), scales ~linearly with |v| plus turning. */
    drivePower: number;
    brushPower: number;
    mopPower: number;
    suctionPower: Record<SuctionLevel, number>;
  };
  water: {
    tankCapacity: number;
    dirtyCapacity: number;
    /** ml per second while mopping and moving. */
    flowRate: Record<WaterLevel, number>;
  };
  dock: {
    cleanTankCapacity: number;
    dirtyTankCapacity: number;
    dustBagCapacity: number;
    dustExtractionTime: number;
    mopWashTime: number;
    waterTransferTime: number;
    dryingTime: number;
    /** Wash water used per wash (ml). */
    washWater: number;
  };
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1337,
  stepDt: 1 / 50,
  robot: {
    maxSpeed: 0.35,
    cleaningSpeed: 0.28,
    edgeSpeed: 0.16,
    maxTurnRate: 2.0,
    accel: 0.8,
    angularAccel: 6,
    wheelSlipNoise: 0.01,
  },
  lidar: {
    range: 6,
    minRange: 0.12,
    raysPerRevolution: 360,
    spinHz: 5,
    noise: 0.008,
    dropout: 0.01,
    pointCloudSize: 1440,
  },
  mapping: {
    cellSize: 0.05,
    inflationRadius: 0.45,
    safetyMargin: 0.015,
    costmapInterval: 0.25,
  },
  navigation: {
    laneSpacing: 0.2,
    replanInterval: 1.0,
    stuckTimeout: 6,
    stuckMinProgress: 0.08,
    maxRecoveryAttempts: 3,
    waypointSkipAfterFailures: 2,
  },
  cleaning: {
    baseVacuumEfficiency: 0.72,
    baseMopEfficiency: 0.55,
    nominalSpeed: 0.28,
    dustbinCapacity: 400,
  },
  battery: {
    /** Demo battery (Wh). Real robots carry ~75 Wh; a smaller default makes recharge-and-resume visible in a whole-home run. */
    capacityWh: 30,
    chargePower: 90,
    lowThreshold: 0.2,
    resumeThreshold: 0.8,
    criticalThreshold: 0.05,
    basePower: 3,
    lidarPower: 2,
    drivePower: 9,
    brushPower: 5,
    mopPower: 4,
    suctionPower: { quiet: 12, standard: 22, turbo: 38, max: 55 },
  },
  water: {
    tankCapacity: 200,
    dirtyCapacity: 150,
    flowRate: { low: 0.12, medium: 0.22, high: 0.35 },
  },
  dock: {
    cleanTankCapacity: 4000,
    dirtyTankCapacity: 3500,
    dustBagCapacity: 2500,
    dustExtractionTime: 12,
    mopWashTime: 18,
    waterTransferTime: 8,
    dryingTime: 20,
    washWater: 120,
  },
};

export const SUCTION_FACTOR: Record<SuctionLevel, number> = { quiet: 0.7, standard: 1, turbo: 1.25, max: 1.45 };
export const WATER_FACTOR: Record<WaterLevel, number> = { low: 0.75, medium: 1, high: 1.2 };

/** Surface multipliers for vacuum pickup and mop effectiveness, and the drive resistance factor. */
export const SURFACE: Record<FloorType, { vacuum: number; mop: number; hair: number; drag: number; label: string }> = {
  hardwood: { vacuum: 1.0, mop: 1.0, hair: 0.85, drag: 1.0, label: 'Hardwood' },
  tile: { vacuum: 1.0, mop: 1.05, hair: 0.9, drag: 1.0, label: 'Tile' },
  rug: { vacuum: 0.82, mop: 0, hair: 0.6, drag: 1.15, label: 'Rug' },
  carpet: { vacuum: 0.65, mop: 0, hair: 0.45, drag: 1.3, label: 'Carpet' },
};

export function mergeConfig(base: SimConfig, patch: DeepPartial<SimConfig>): SimConfig {
  return deepMerge(base, patch) as SimConfig;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge(a: unknown, b: unknown): unknown {
  if (b === undefined) return structuredClone(a);
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(b)) return b;
  const out: Record<string, unknown> = { ...(structuredClone(a) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  }
  return out;
}
