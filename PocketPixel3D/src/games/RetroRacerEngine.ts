/**
 * Pure rules for Retro Racer (no drawing, no sound): a top-down road that scrolls toward the
 * player, with curves, traffic, fuel and lives.
 *
 * World coordinates: `wy` grows up the road (forward). The player's front bumper is at
 * wy = `distance` and is drawn at screen row PLAYER_SCREEN_Y; a screen row y shows world
 * wy = distance + (PLAYER_SCREEN_Y - y). Objects store the wy of their front (top) edge.
 */
import type { InputFrame } from './GameInterface';
import { randomInt, randomRange } from './common/Rng';

// ---- Tuning -------------------------------------------------------------------------------
/** Width of the road area on screen (the HUD sits to the right of it). */
export const ROAD_AREA_W = 120;
export const PLAYER_SCREEN_Y = 108;
export const CAR_W = 9;
export const CAR_H = 14;
export const TRUCK_H = 20;
export const LANE_COUNT = 3;

/** Speeds are pixels per tick. Shown on the HUD as speed * SPEED_DISPLAY_FACTOR. */
export const MAX_SPEED = 4;
export const SPEED_DISPLAY_FACTOR = 50;
export const ACCELERATION = 0.04;
export const BRAKE_DECELERATION = 0.14;
export const COAST_DECELERATION = 0.012;
export const OFFROAD_MAX_SPEED = 1.4;
export const OFFROAD_DRAG = 0.09;
/** Sideways pixels per tick: base + perSpeed * speed (no steering while stopped). */
export const STEER_BASE = 0.6;
export const STEER_PER_SPEED = 0.35;
export const MIN_STEER_SPEED = 0.05;

export const ROAD_HALF_START = 34;
export const ROAD_HALF_MIN = 28;
export const ROAD_NARROW_DISTANCE = 30000;
export const CURVE_AMP_START = 6;
export const CURVE_AMP_MAX = 22;
export const CURVE_AMP_DISTANCE = 20000;
const CURVE_PERIOD_1 = 900;
const CURVE_PERIOD_2 = 370;

export const FUEL_MAX = 100;
export const FUEL_IDLE_DRAIN = 0.012;
export const FUEL_SPEED_DRAIN = 0.01;
/** Extra drain at full difficulty, as a fraction. */
export const FUEL_DIFFICULTY_DRAIN = 0.3;
export const FUEL_CAN_AMOUNT = 35;
export const FUEL_LOW = 25;
export const FUEL_GAP_MIN = 1300;
export const FUEL_GAP_MAX = 2100;
const FUEL_CAN_H = 8;

export const TRAFFIC_POOL_SIZE = 8;
export const TRAFFIC_GAP_START = 260;
export const TRAFFIC_GAP_END = 110;
export const TRAFFIC_SPEED_MIN = 1.1;
export const TRAFFIC_SPEED_MAX = 2.6;
export const TRAFFIC_SPEED_DIFFICULTY_BONUS = 0.5;
export const TRUCK_CHANCE = 0.25;
/** No two cars closer than this (world px) in one lane at spawn. */
const LANE_SPACING = 50;

export const START_LIVES = 3;
export const CRASH_TICKS = 72;
export const INVULNERABLE_TICKS = 120;
export const DISTANCE_PER_POINT = 10;
export const OVERTAKE_POINTS = 25;
export const FUEL_POINTS = 50;
export const STAGE_LENGTH = 5000;
/** Distance at which difficulty reaches 1. */
export const DIFFICULTY_DISTANCE = 24000;
export const MAX_RACER_SCORE = 999999;

export type RacerEvent =
  | 'overtake'
  | 'fuel'
  | 'crash'
  | 'respawn'
  | 'stage'
  | 'lowfuel'
  | 'offroad'
  | 'over';
export type RacerListener = (event: RacerEvent, value: number) => void;
export type RacerState = 'driving' | 'crashed' | 'over';
export type RacerOverReason = '' | 'crash' | 'fuel';

export interface TrafficCar {
  active: boolean;
  lane: number;
  /** World position of the car's front edge. */
  wy: number;
  speed: number;
  /** Length on screen (CAR_H or TRUCK_H). */
  length: number;
  kind: 0 | 1;
  passed: boolean;
}

export interface FuelCan {
  active: boolean;
  lane: number;
  wy: number;
}

export class RetroRacerEngine {
  /** Set false in tests to stop random traffic and fuel cans. */
  autoSpawn = true;
  /** Fixed pool; check `active`. */
  readonly traffic: readonly TrafficCar[];
  readonly fuelCan: FuelCan = { active: false, lane: 1, wy: 0 };

  private stateValue: RacerState = 'driving';
  private overReasonValue: RacerOverReason = '';
  private distanceValue = 0;
  private speedValue = 0;
  private playerXValue = 0;
  private fuelValue = FUEL_MAX;
  private livesValue = START_LIVES;
  private bonusScore = 0;
  private overtakesValue = 0;
  private stageValue = 1;
  private crashTimerValue = 0;
  private invulnerableValue = 0;
  private offroadValue = false;
  private ticks = 0;
  private nextTrafficAt = 0;
  private nextFuelAt = 0;
  private phase1 = 0;
  private phase2 = 0;
  private crashXValue = 0;

  constructor(
    private readonly random: () => number,
    private readonly listener: RacerListener = () => {},
  ) {
    const pool: TrafficCar[] = [];
    for (let i = 0; i < TRAFFIC_POOL_SIZE; i++) {
      pool.push({ active: false, lane: 0, wy: 0, speed: 0, length: CAR_H, kind: 0, passed: false });
    }
    this.traffic = pool;
    this.reset();
  }

  // ---- Read-only state ---------------------------------------------------------------------------
  get state(): RacerState {
    return this.stateValue;
  }
  get isOver(): boolean {
    return this.stateValue === 'over';
  }
  get overReason(): RacerOverReason {
    return this.overReasonValue;
  }
  get distance(): number {
    return this.distanceValue;
  }
  get speed(): number {
    return this.speedValue;
  }
  /** Speed for the HUD (0..200). */
  get displaySpeed(): number {
    return Math.round(this.speedValue * SPEED_DISPLAY_FACTOR);
  }
  /** Left edge of the player's car on screen. */
  get playerX(): number {
    return this.playerXValue;
  }
  get fuel(): number {
    return this.fuelValue;
  }
  get lives(): number {
    return this.livesValue;
  }
  get overtakes(): number {
    return this.overtakesValue;
  }
  get stage(): number {
    return this.stageValue;
  }
  get crashTimer(): number {
    return this.crashTimerValue;
  }
  /** Screen x (centre) where the last crash happened. */
  get crashX(): number {
    return this.crashXValue;
  }
  get invulnerableTicks(): number {
    return this.invulnerableValue;
  }
  get isOffroad(): boolean {
    return this.offroadValue;
  }
  /** 0 at the start, 1 at DIFFICULTY_DISTANCE and beyond. */
  get difficulty(): number {
    return Math.min(1, this.distanceValue / DIFFICULTY_DISTANCE);
  }
  get score(): number {
    return Math.min(MAX_RACER_SCORE, Math.floor(this.distanceValue / DISTANCE_PER_POINT) + this.bonusScore);
  }

  // ---- Road geometry ---------------------------------------------------------------------------
  roadCenterAt(wy: number): number {
    const amp = Math.min(CURVE_AMP_MAX, CURVE_AMP_START + ((CURVE_AMP_MAX - CURVE_AMP_START) * Math.max(0, wy)) / CURVE_AMP_DISTANCE);
    const wave =
      0.65 * Math.sin((wy * 2 * Math.PI) / CURVE_PERIOD_1 + this.phase1) +
      0.35 * Math.sin((wy * 2 * Math.PI) / CURVE_PERIOD_2 + this.phase2);
    const half = this.roadHalfAt(wy);
    const c = ROAD_AREA_W / 2 + amp * wave;
    return Math.min(ROAD_AREA_W - half - 4, Math.max(half + 4, c));
  }

  roadHalfAt(wy: number): number {
    const t = Math.min(1, Math.max(0, wy) / ROAD_NARROW_DISTANCE);
    return ROAD_HALF_START - (ROAD_HALF_START - ROAD_HALF_MIN) * t;
  }

  /** Screen-x centre of a lane (0..LANE_COUNT-1) at a world position. */
  laneCenterX(lane: number, wy: number): number {
    const laneWidth = (2 * this.roadHalfAt(wy)) / LANE_COUNT;
    return this.roadCenterAt(wy) + (lane - (LANE_COUNT - 1) / 2) * laneWidth;
  }

  /** Screen row of an object's front edge. */
  screenY(wy: number): number {
    return PLAYER_SCREEN_Y - (wy - this.distanceValue);
  }

  /** Left edge on screen of a traffic car or can of the given length. */
  objectX(lane: number, wy: number, length: number): number {
    return this.laneCenterX(lane, wy - length / 2) - CAR_W / 2;
  }

  // ---- Setup -------------------------------------------------------------------------------------
  reset(): void {
    this.stateValue = 'driving';
    this.overReasonValue = '';
    this.distanceValue = 0;
    this.speedValue = 0;
    this.fuelValue = FUEL_MAX;
    this.livesValue = START_LIVES;
    this.bonusScore = 0;
    this.overtakesValue = 0;
    this.stageValue = 1;
    this.crashTimerValue = 0;
    this.invulnerableValue = 0;
    this.offroadValue = false;
    this.ticks = 0;
    this.phase1 = this.random() * Math.PI * 2;
    this.phase2 = this.random() * Math.PI * 2;
    for (const car of this.traffic) car.active = false;
    this.fuelCan.active = false;
    this.nextTrafficAt = 120;
    this.nextFuelAt = FUEL_GAP_MIN;
    this.playerXValue = this.laneCenterX(1, -CAR_H / 2) - CAR_W / 2;
  }

  /** Test hook: put a traffic car in a lane with its front edge at a screen row. */
  spawnTraffic(lane: number, screenY: number, speed: number, kind: 0 | 1 = 0): TrafficCar | undefined {
    const car = this.freeCar();
    if (!car) return undefined;
    car.active = true;
    car.lane = lane;
    car.wy = this.distanceValue + (PLAYER_SCREEN_Y - screenY);
    car.speed = speed;
    car.kind = kind;
    car.length = kind === 1 ? TRUCK_H : CAR_H;
    car.passed = false;
    return car;
  }

  /** Test hook: place the fuel can in a lane with its top at a screen row. */
  spawnFuelCan(lane: number, screenY: number): void {
    this.fuelCan.active = true;
    this.fuelCan.lane = lane;
    this.fuelCan.wy = this.distanceValue + (PLAYER_SCREEN_Y - screenY);
  }

  /** Test hooks. */
  setFuel(value: number): void {
    this.fuelValue = Math.max(0, Math.min(FUEL_MAX, value));
  }
  setSpeed(value: number): void {
    this.speedValue = Math.max(0, Math.min(MAX_SPEED, value));
  }
  setPlayerX(value: number): void {
    this.playerXValue = Math.max(0, Math.min(ROAD_AREA_W - CAR_W, value));
  }

  // ---- Per-tick update -------------------------------------------------------------------------
  update(input: InputFrame): void {
    if (this.stateValue === 'over') return;
    this.ticks++;
    if (this.stateValue === 'crashed') {
      this.moveTraffic();
      this.crashTimerValue--;
      if (this.crashTimerValue <= 0) this.afterCrash();
      return;
    }
    this.drive(input);
    if (this.isOver) return;
    this.moveTraffic();
    if (this.autoSpawn) this.spawnObjects();
    this.checkTraffic();
    this.checkFuelCan();
    if (this.invulnerableValue > 0) this.invulnerableValue--;
  }

  private drive(input: InputFrame): void {
    const hasFuel = this.fuelValue > 0;
    let speed = this.speedValue;
    if (input.isDown('a') && hasFuel) speed += ACCELERATION;
    else speed -= COAST_DECELERATION;
    if (input.isDown('b')) speed -= BRAKE_DECELERATION;

    const centreWy = this.distanceValue - CAR_H / 2;
    const roadCenter = this.roadCenterAt(centreWy);
    const half = this.roadHalfAt(centreWy);
    const carCenter = this.playerXValue + CAR_W / 2;
    this.offroadValue = carCenter < roadCenter - half || carCenter > roadCenter + half;
    if (this.offroadValue && speed > OFFROAD_MAX_SPEED) speed = Math.max(OFFROAD_MAX_SPEED, speed - OFFROAD_DRAG);
    this.speedValue = speed = Math.max(0, Math.min(MAX_SPEED, speed));
    if (this.offroadValue && speed > 0.5 && this.ticks % 10 === 0) this.listener('offroad', 0);

    const steer = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    if (steer !== 0 && speed > MIN_STEER_SPEED) {
      this.setPlayerX(this.playerXValue + steer * (STEER_BASE + STEER_PER_SPEED * speed));
    }

    this.distanceValue += speed;
    const drain = (FUEL_IDLE_DRAIN + FUEL_SPEED_DRAIN * speed) * (1 + FUEL_DIFFICULTY_DRAIN * this.difficulty);
    this.fuelValue = Math.max(0, this.fuelValue - drain);
    if (this.fuelValue > 0 && this.fuelValue < FUEL_LOW && this.ticks % 40 === 0) this.listener('lowfuel', 0);
    if (this.fuelValue <= 0 && this.speedValue <= 0) {
      this.finish('fuel');
      return;
    }

    const stage = 1 + Math.floor(this.distanceValue / STAGE_LENGTH);
    if (stage !== this.stageValue) {
      this.stageValue = stage;
      this.listener('stage', stage);
    }
  }

  private moveTraffic(): void {
    for (const car of this.traffic) {
      if (!car.active) continue;
      car.wy += car.speed;
      const sy = this.screenY(car.wy);
      if (sy > 150 || sy < -140) car.active = false;
    }
    if (this.fuelCan.active && this.screenY(this.fuelCan.wy) > 150) {
      this.fuelCan.active = false;
      this.nextFuelAt = this.distanceValue + randomRange(this.random, FUEL_GAP_MIN, FUEL_GAP_MAX) * 0.5;
    }
  }

  private checkTraffic(): void {
    const px = this.playerXValue;
    for (const car of this.traffic) {
      if (!car.active) continue;
      const sy = this.screenY(car.wy);
      if (!car.passed && sy > PLAYER_SCREEN_Y + CAR_H) {
        car.passed = true;
        this.overtakesValue++;
        this.bonusScore += OVERTAKE_POINTS;
        this.listener('overtake', this.overtakesValue);
      }
      if (this.invulnerableValue > 0) continue;
      const cx = this.objectX(car.lane, car.wy, car.length);
      if (rectsOverlap(px + 1, PLAYER_SCREEN_Y + 1, CAR_W - 2, CAR_H - 2, cx + 1, sy + 1, CAR_W - 2, car.length - 2)) {
        car.passed = true;
        this.crash();
        return;
      }
    }
  }

  private checkFuelCan(): void {
    const can = this.fuelCan;
    if (!can.active) return;
    const sy = this.screenY(can.wy);
    const cx = this.objectX(can.lane, can.wy, FUEL_CAN_H);
    if (rectsOverlap(this.playerXValue, PLAYER_SCREEN_Y, CAR_W, CAR_H, cx + 1, sy, CAR_W - 2, FUEL_CAN_H)) {
      can.active = false;
      this.fuelValue = Math.min(FUEL_MAX, this.fuelValue + FUEL_CAN_AMOUNT);
      this.bonusScore += FUEL_POINTS;
      this.nextFuelAt = this.distanceValue + randomRange(this.random, FUEL_GAP_MIN, FUEL_GAP_MAX);
      this.listener('fuel', this.fuelValue);
    }
  }

  private spawnObjects(): void {
    const d = this.difficulty;
    if (this.distanceValue >= this.nextTrafficAt) {
      const kind: 0 | 1 = this.random() < TRUCK_CHANCE ? 1 : 0;
      const length = kind === 1 ? TRUCK_H : CAR_H;
      const spawnWy = this.distanceValue + PLAYER_SCREEN_Y + 4 + length;
      const lane = this.pickLane(spawnWy);
      if (lane >= 0) {
        const car = this.freeCar();
        if (car) {
          car.active = true;
          car.lane = lane;
          car.wy = spawnWy;
          car.kind = kind;
          car.length = length;
          car.passed = false;
          const base = randomRange(this.random, TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX) + TRAFFIC_SPEED_DIFFICULTY_BONUS * d;
          car.speed = kind === 1 ? base * 0.8 : base;
        }
      }
      const gap = TRAFFIC_GAP_START + (TRAFFIC_GAP_END - TRAFFIC_GAP_START) * d;
      this.nextTrafficAt = this.distanceValue + gap * (0.7 + 0.6 * this.random());
    }
    if (!this.fuelCan.active && this.distanceValue >= this.nextFuelAt) {
      const wy = this.distanceValue + PLAYER_SCREEN_Y + 12;
      const lane = this.pickLane(wy);
      if (lane >= 0) {
        this.fuelCan.active = true;
        this.fuelCan.lane = lane;
        this.fuelCan.wy = wy;
      }
      this.nextFuelAt = this.distanceValue + randomRange(this.random, FUEL_GAP_MIN, FUEL_GAP_MAX);
    }
  }

  /**
   * A random lane with no car near `wy`, never closing the last open lane. Returns -1 if none.
   */
  private pickLane(wy: number): number {
    let blockedMask = 0;
    for (const car of this.traffic) {
      if (car.active && Math.abs(car.wy - wy) < LANE_SPACING + car.length) blockedMask |= 1 << car.lane;
    }
    if (this.fuelCan.active && Math.abs(this.fuelCan.wy - wy) < LANE_SPACING) blockedMask |= 1 << this.fuelCan.lane;
    let openLanes = 0;
    for (let l = 0; l < LANE_COUNT; l++) if ((blockedMask & (1 << l)) === 0) openLanes++;
    if (openLanes < 2) return -1;
    const start = randomInt(this.random, LANE_COUNT);
    for (let i = 0; i < LANE_COUNT; i++) {
      const lane = (start + i) % LANE_COUNT;
      if ((blockedMask & (1 << lane)) === 0) return lane;
    }
    return -1;
  }

  private freeCar(): TrafficCar | undefined {
    for (const car of this.traffic) if (!car.active) return car;
    return undefined;
  }

  private crash(): void {
    this.livesValue--;
    this.stateValue = 'crashed';
    this.crashTimerValue = CRASH_TICKS;
    this.crashXValue = this.playerXValue + CAR_W / 2;
    this.speedValue = 0;
    this.listener('crash', this.livesValue);
  }

  private afterCrash(): void {
    if (this.livesValue <= 0) {
      this.finish('crash');
      return;
    }
    this.stateValue = 'driving';
    this.invulnerableValue = INVULNERABLE_TICKS;
    this.setPlayerX(this.roadCenterAt(this.distanceValue - CAR_H / 2) - CAR_W / 2);
    this.listener('respawn', this.livesValue);
  }

  private finish(reason: RacerOverReason): void {
    this.stateValue = 'over';
    this.overReasonValue = reason;
    this.listener('over', 0);
  }
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}
