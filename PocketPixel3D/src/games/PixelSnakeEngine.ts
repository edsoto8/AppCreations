/**
 * Pure rules for Pixel Snake (no drawing, no sound): a grid snake with an input queue, food,
 * a timed bonus item, rising speed, and either solid walls or wrap-around edges.
 */
import type { ButtonId, InputFrame } from './GameInterface';
import { randomInt } from './common/Rng';

// ---- Tuning -------------------------------------------------------------------------------
export const SNAKE_COLS = 26;
export const SNAKE_ROWS = 21;
export const SNAKE_START_LENGTH = 4;
/** Ticks per step at the start... */
export const START_STEP_TICKS = 9;
/** ...never faster than this... */
export const MIN_STEP_TICKS = 3;
/** ...one tick faster every this many foods. */
export const FOODS_PER_SPEEDUP = 4;
/** Holding A moves at this fraction of the current step time (rounded, at least 2 ticks). */
export const BOOST_FACTOR = 0.5;
export const GROWTH_PER_FOOD = 2;
export const GROWTH_PER_BONUS = 1;
export const FOOD_POINTS = 10;
/** Extra points per food for each speed-up reached. */
export const FOOD_POINTS_PER_SPEED_LEVEL = 2;
/** A bonus item appears after every this many foods... */
export const BONUS_EVERY_FOODS = 5;
/** ...and stays this many ticks. */
export const BONUS_LIFETIME_TICKS = 360;
export const BONUS_MIN_POINTS = 20;
export const BONUS_MAX_POINTS = 100;
/** Turns buffered ahead of the snake so quick double-turns register. */
export const INPUT_QUEUE_SIZE = 3;
export const MAX_SNAKE_SCORE = 999999;

export type SnakeMode = 'walls' | 'wrap';

/** 0 = up, 1 = right, 2 = down, 3 = left. */
export type Direction = 0 | 1 | 2 | 3;
export const DIR_UP: Direction = 0;
export const DIR_RIGHT: Direction = 1;
export const DIR_DOWN: Direction = 2;
export const DIR_LEFT: Direction = 3;
export const DIR_DX: readonly number[] = [0, 1, 0, -1];
export const DIR_DY: readonly number[] = [-1, 0, 1, 0];
const DIR_BUTTONS: readonly ButtonId[] = ['up', 'right', 'down', 'left'];

export type SnakeEvent = 'turn' | 'step' | 'eat' | 'bonus-appear' | 'bonus-eat' | 'bonus-expire' | 'speedup' | 'die';
export type SnakeListener = (event: SnakeEvent, value: number) => void;
export type SnakeDeath = '' | 'wall' | 'self' | 'full';

const CELL_COUNT = SNAKE_COLS * SNAKE_ROWS;

export class PixelSnakeEngine {
  mode: SnakeMode = 'walls';

  /** Ring buffer of cell indices; the head is at `headSlot`, body follows backwards. */
  private readonly ring = new Int16Array(CELL_COUNT);
  /** Number of snake segments on each cell (0 or 1 in normal play). */
  private readonly occupied = new Uint8Array(CELL_COUNT);
  private headSlot = 0;
  private lengthValue = 0;
  private directionValue: Direction = DIR_RIGHT;
  private readonly queue = new Int8Array(INPUT_QUEUE_SIZE);
  private queueLength = 0;
  private pendingGrowth = 0;
  private stepCounter = 0;
  private foodCell = -1;
  private bonusCell = -1;
  private bonusTimerValue = 0;
  private scoreValue = 0;
  private foodsEaten = 0;
  private deathValue: SnakeDeath = '';

  constructor(
    private readonly random: () => number,
    private readonly listener: SnakeListener = () => {},
  ) {
    this.reset();
  }

  // ---- Read-only state ---------------------------------------------------------------------------
  get length(): number {
    return this.lengthValue;
  }
  get direction(): Direction {
    return this.directionValue;
  }
  get score(): number {
    return this.scoreValue;
  }
  get foodEaten(): number {
    return this.foodsEaten;
  }
  get isDead(): boolean {
    return this.deathValue !== '';
  }
  get death(): SnakeDeath {
    return this.deathValue;
  }
  get food(): number {
    return this.foodCell;
  }
  get bonus(): number {
    return this.bonusCell;
  }
  get bonusTimer(): number {
    return this.bonusTimerValue;
  }
  get queuedTurns(): number {
    return this.queueLength;
  }
  get speedLevel(): number {
    return Math.floor(this.foodsEaten / FOODS_PER_SPEEDUP);
  }
  /** Ticks between steps at the current speed (without boost). */
  get stepTicks(): number {
    return Math.max(MIN_STEP_TICKS, START_STEP_TICKS - this.speedLevel);
  }
  get headX(): number {
    return this.segmentX(0);
  }
  get headY(): number {
    return this.segmentY(0);
  }

  /** Cell index of segment `i` (0 = head). */
  segment(i: number): number {
    return this.ring[(this.headSlot - i + CELL_COUNT * 2) % CELL_COUNT] ?? 0;
  }
  segmentX(i: number): number {
    return this.segment(i) % SNAKE_COLS;
  }
  segmentY(i: number): number {
    return Math.floor(this.segment(i) / SNAKE_COLS);
  }
  isOccupied(x: number, y: number): boolean {
    return (this.occupied[y * SNAKE_COLS + x] ?? 0) > 0;
  }

  // ---- Setup -------------------------------------------------------------------------------------
  reset(mode: SnakeMode = this.mode): void {
    this.mode = mode;
    this.occupied.fill(0);
    this.lengthValue = 0;
    this.headSlot = -1;
    const y = Math.floor(SNAKE_ROWS / 2);
    for (let i = 0; i < SNAKE_START_LENGTH; i++) this.pushHead(y * SNAKE_COLS + 4 + i);
    this.directionValue = DIR_RIGHT;
    this.queueLength = 0;
    this.pendingGrowth = 0;
    this.stepCounter = 0;
    this.bonusCell = -1;
    this.bonusTimerValue = 0;
    this.scoreValue = 0;
    this.foodsEaten = 0;
    this.deathValue = '';
    this.foodCell = -1;
    this.placeFood();
  }

  /**
   * Test/setup hook: replace the snake with the given cells (head first) heading `direction`.
   * Cells are [x, y] pairs.
   */
  setSnake(cells: readonly (readonly [number, number])[], direction: Direction): void {
    this.occupied.fill(0);
    this.lengthValue = 0;
    this.headSlot = -1;
    for (let i = cells.length - 1; i >= 0; i--) {
      const [x, y] = cells[i]!;
      this.pushHead(y * SNAKE_COLS + x);
    }
    this.directionValue = direction;
    this.queueLength = 0;
    this.pendingGrowth = 0;
    this.stepCounter = 0;
  }

  /** Test/setup hook: put the food on a cell (-1 removes it). */
  setFood(x: number, y: number): void {
    this.foodCell = x < 0 ? -1 : y * SNAKE_COLS + x;
  }

  /** Test/setup hook: put the bonus item on a cell for `ticks` ticks. */
  setBonus(x: number, y: number, ticks = BONUS_LIFETIME_TICKS): void {
    this.bonusCell = y * SNAKE_COLS + x;
    this.bonusTimerValue = ticks;
  }

  // ---- Per-tick update -------------------------------------------------------------------------
  update(input: InputFrame): void {
    if (this.isDead) return;
    for (let d = 0; d < 4; d++) {
      if (input.wasPressed(DIR_BUTTONS[d]!)) this.queueTurn(d as Direction);
    }
    if (this.bonusCell >= 0) {
      this.bonusTimerValue--;
      if (this.bonusTimerValue <= 0) {
        this.bonusCell = -1;
        this.listener('bonus-expire', 0);
      }
    }
    const interval = input.isDown('a')
      ? Math.max(2, Math.round(this.stepTicks * BOOST_FACTOR))
      : this.stepTicks;
    this.stepCounter++;
    if (this.stepCounter >= interval) {
      this.stepCounter = 0;
      this.step();
    }
  }

  /**
   * Buffers a turn. Ignored when it repeats or reverses the last queued direction (so a 180 degree
   * turn into the neck is impossible) or when the queue is full. Returns true if queued.
   */
  queueTurn(direction: Direction): boolean {
    const last = this.queueLength > 0 ? (this.queue[this.queueLength - 1] as Direction) : this.directionValue;
    if (direction === last || direction === ((last + 2) & 3)) return false;
    if (this.queueLength >= INPUT_QUEUE_SIZE) return false;
    this.queue[this.queueLength++] = direction;
    return true;
  }

  /** Advances the snake one cell. */
  step(): void {
    if (this.isDead) return;
    if (this.queueLength > 0) {
      this.directionValue = (this.queue[0] ?? 0) as Direction;
      this.queue.copyWithin(0, 1);
      this.queueLength--;
      this.listener('turn', this.directionValue);
    }
    let nx = this.headX + (DIR_DX[this.directionValue] ?? 0);
    let ny = this.headY + (DIR_DY[this.directionValue] ?? 0);
    if (nx < 0 || ny < 0 || nx >= SNAKE_COLS || ny >= SNAKE_ROWS) {
      if (this.mode === 'walls') {
        this.die('wall');
        return;
      }
      nx = (nx + SNAKE_COLS) % SNAKE_COLS;
      ny = (ny + SNAKE_ROWS) % SNAKE_ROWS;
    }
    const target = ny * SNAKE_COLS + nx;
    const growing = this.pendingGrowth > 0;
    // The tail moves away this step unless growing, so its cell is free to enter.
    const tail = this.segment(this.lengthValue - 1);
    if (!growing) this.occupied[tail] = (this.occupied[tail] ?? 1) - 1;
    if ((this.occupied[target] ?? 0) > 0) {
      if (!growing) this.occupied[tail] = (this.occupied[tail] ?? 0) + 1;
      this.die('self');
      return;
    }
    if (growing) {
      this.pendingGrowth--;
      this.pushHead(target);
    } else {
      this.headSlot = (this.headSlot + 1) % CELL_COUNT;
      this.ring[this.headSlot] = target;
      this.occupied[target] = (this.occupied[target] ?? 0) + 1;
    }
    this.listener('step', 0);

    if (target === this.foodCell) this.eatFood();
    if (target === this.bonusCell) this.eatBonus();
  }

  private eatFood(): void {
    const stepTicksBefore = this.stepTicks;
    this.addScore(FOOD_POINTS + FOOD_POINTS_PER_SPEED_LEVEL * this.speedLevel);
    this.pendingGrowth += GROWTH_PER_FOOD;
    this.foodsEaten++;
    this.listener('eat', this.foodsEaten);
    if (this.stepTicks < stepTicksBefore) this.listener('speedup', this.speedLevel);
    this.foodCell = -1;
    this.placeFood();
    if (!this.isDead && this.foodsEaten % BONUS_EVERY_FOODS === 0 && this.bonusCell < 0) this.placeBonus();
  }

  private eatBonus(): void {
    const t = this.bonusTimerValue / BONUS_LIFETIME_TICKS;
    const points = Math.round(BONUS_MIN_POINTS + (BONUS_MAX_POINTS - BONUS_MIN_POINTS) * Math.min(1, t));
    this.addScore(points);
    this.pendingGrowth += GROWTH_PER_BONUS;
    this.bonusCell = -1;
    this.bonusTimerValue = 0;
    this.listener('bonus-eat', points);
  }

  private placeFood(): void {
    const cell = this.findFreeCell();
    if (cell < 0) {
      this.die('full');
      return;
    }
    this.foodCell = cell;
  }

  private placeBonus(): void {
    const cell = this.findFreeCell();
    if (cell < 0) return;
    this.bonusCell = cell;
    this.bonusTimerValue = BONUS_LIFETIME_TICKS;
    this.listener('bonus-appear', 0);
  }

  /** Random free cell (not snake, food or bonus), scanning forward from a random start. */
  private findFreeCell(): number {
    const start = randomInt(this.random, CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      const c = (start + i) % CELL_COUNT;
      if ((this.occupied[c] ?? 0) === 0 && c !== this.foodCell && c !== this.bonusCell) return c;
    }
    return -1;
  }

  private pushHead(cell: number): void {
    this.headSlot = (this.headSlot + 1 + CELL_COUNT) % CELL_COUNT;
    this.ring[this.headSlot] = cell;
    this.occupied[cell] = (this.occupied[cell] ?? 0) + 1;
    this.lengthValue++;
  }

  private die(reason: SnakeDeath): void {
    this.deathValue = reason;
    this.listener('die', 0);
  }

  private addScore(points: number): void {
    this.scoreValue = Math.min(MAX_SNAKE_SCORE, this.scoreValue + points);
  }
}
