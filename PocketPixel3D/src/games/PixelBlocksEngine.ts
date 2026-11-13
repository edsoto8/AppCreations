/**
 * Pure rules for Pixel Blocks (no drawing, no sound): board, pieces, gravity, locking,
 * line clears, scoring and levels. Driven one tick at a time by {@link PixelBlocksEngine.update}.
 *
 * Coordinates: x = column 0..BOARD_COLS-1 (left to right), y = row 0..BOARD_ROWS-1 (top to
 * bottom). The top HIDDEN_ROWS rows are above the visible well.
 */
import type { InputFrame } from './GameInterface';
import { DirectionalRepeat } from './common/AutoRepeat';
import { shuffleInPlace } from './common/Rng';

// ---- Tuning -------------------------------------------------------------------------------
export const BOARD_COLS = 10;
export const VISIBLE_ROWS = 18;
export const HIDDEN_ROWS = 2;
export const BOARD_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
/** Delayed auto-shift: first repeat after this many ticks of holding left/right... */
export const SHIFT_DELAY_TICKS = 10;
/** ...then one step every this many ticks. */
export const SHIFT_INTERVAL_TICKS = 3;
/** Ticks per row while Down is held. */
export const SOFT_DROP_TICKS = 2;
/** Ticks a grounded piece waits before locking. */
export const LOCK_DELAY_TICKS = 30;
/** Moves/rotations on the ground that may restart the lock delay. */
export const MAX_LOCK_RESETS = 15;
/** Length of the line-clear flash. */
export const CLEAR_ANIMATION_TICKS = 24;
export const LINES_PER_LEVEL = 10;
/** Points for clearing 1..4 lines at once, multiplied by the level. */
export const LINE_CLEAR_POINTS: readonly number[] = [0, 50, 150, 350, 1000];
export const SOFT_DROP_POINTS_PER_ROW = 1;
export const HARD_DROP_POINTS_PER_ROW = 2;
export const MAX_SCORE = 999999;

/** Ticks per row of gravity at a level (level 1 = 48 ticks, speeding up ~20% per level). */
export function gravityTicksForLevel(level: number): number {
  return Math.max(2, Math.round(48 * Math.pow(0.8, level - 1)));
}

// ---- Pieces ---------------------------------------------------------------------------------
/** Piece ids stored in the board. 0 is an empty cell. */
export const PIECE_I = 1;
export const PIECE_O = 2;
export const PIECE_T = 3;
export const PIECE_S = 4;
export const PIECE_Z = 5;
export const PIECE_J = 6;
export const PIECE_L = 7;
export const PIECE_COUNT = 7;
export const PIECE_NAMES: readonly string[] = ['', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** Rotation-0 cells [x, y] inside each piece's square box, and the box size. */
const PIECE_DEFS: readonly { size: number; cells: readonly (readonly [number, number])[] }[] = [
  { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // I
  { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }, // O
  { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // T
  { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // S
  { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // Z
  { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // J
  { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // L
];

/** PIECE_CELLS[((type - 1) * 4 + rotation) * 8 + cell * 2 + (0 = x, 1 = y)] */
const PIECE_CELLS = new Int8Array(PIECE_COUNT * 4 * 8);
for (let t = 0; t < PIECE_COUNT; t++) {
  const def = PIECE_DEFS[t]!;
  for (let rot = 0; rot < 4; rot++) {
    def.cells.forEach(([cx, cy], i) => {
      let x = cx;
      let y = cy;
      for (let r = 0; r < rot; r++) {
        const nx = def.size - 1 - y; // clockwise turn inside the box
        y = x;
        x = nx;
      }
      PIECE_CELLS[(t * 4 + rot) * 8 + i * 2] = x;
      PIECE_CELLS[(t * 4 + rot) * 8 + i * 2 + 1] = y;
    });
  }
}

export function pieceBoxSize(type: number): number {
  return PIECE_DEFS[type - 1]?.size ?? 3;
}

/** X offset of cell `i` (0..3) of a piece in a rotation. */
export function pieceCellX(type: number, rotation: number, i: number): number {
  return PIECE_CELLS[((type - 1) * 4 + (rotation & 3)) * 8 + i * 2] ?? 0;
}

/** Y offset of cell `i` (0..3) of a piece in a rotation. */
export function pieceCellY(type: number, rotation: number, i: number): number {
  return PIECE_CELLS[((type - 1) * 4 + (rotation & 3)) * 8 + i * 2 + 1] ?? 0;
}

/** Offsets tried, in order, when a rotation is blocked: stay, sideways, up, then two sideways. */
export const KICK_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0],
];

export type BlocksEvent =
  | 'move'
  | 'rotate'
  | 'harddrop'
  | 'lock'
  | 'clear'
  | 'levelup'
  | 'spawn'
  | 'gameover';

/** `value` is the number of lines for 'clear', the new level for 'levelup', else 0. */
export type BlocksListener = (event: BlocksEvent, value: number) => void;

export type BlocksState = 'falling' | 'clearing' | 'over';

export class PixelBlocksEngine {
  /** Row-major board of piece ids (0 = empty), BOARD_COLS x BOARD_ROWS. */
  readonly board = new Uint8Array(BOARD_COLS * BOARD_ROWS);
  /** Rows being cleared during the 'clearing' state (first `clearCount` entries valid). */
  readonly clearingRows = new Int8Array(4);

  private stateValue: BlocksState = 'falling';
  private pieceType = 0;
  private pieceRot = 0;
  private pieceX = 0;
  private pieceY = 0;
  private nextType = 0;
  private readonly bag = new Uint8Array(PIECE_COUNT);
  private bagIndex = PIECE_COUNT;

  private scoreValue = 0;
  private linesValue = 0;
  private levelValue = 1;
  private startLevel = 1;
  private clearCountValue = 0;
  private clearTimerValue = 0;

  private gravityCounter = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private readonly shift = new DirectionalRepeat(SHIFT_DELAY_TICKS, SHIFT_INTERVAL_TICKS);

  constructor(
    private readonly random: () => number,
    private readonly listener: BlocksListener = () => {},
  ) {
    this.reset();
  }

  // ---- Read-only state -------------------------------------------------------------------------
  get state(): BlocksState {
    return this.stateValue;
  }
  get isOver(): boolean {
    return this.stateValue === 'over';
  }
  get score(): number {
    return this.scoreValue;
  }
  get lines(): number {
    return this.linesValue;
  }
  get level(): number {
    return this.levelValue;
  }
  /** Active piece type, or 0 while clearing / after game over. */
  get currentType(): number {
    return this.stateValue === 'falling' ? this.pieceType : 0;
  }
  get currentRotation(): number {
    return this.pieceRot;
  }
  get currentX(): number {
    return this.pieceX;
  }
  get currentY(): number {
    return this.pieceY;
  }
  get nextPiece(): number {
    return this.nextType;
  }
  get clearCount(): number {
    return this.clearCountValue;
  }
  get clearTimer(): number {
    return this.clearTimerValue;
  }
  get gravityTicks(): number {
    return gravityTicksForLevel(this.levelValue);
  }

  getCell(x: number, y: number): number {
    if (x < 0 || x >= BOARD_COLS || y < 0 || y >= BOARD_ROWS) return 8; // outside = wall
    return this.board[y * BOARD_COLS + x] ?? 0;
  }

  /** Test/setup hook: write one board cell. */
  setCell(x: number, y: number, type: number): void {
    if (x < 0 || x >= BOARD_COLS || y < 0 || y >= BOARD_ROWS) return;
    this.board[y * BOARD_COLS + x] = type;
  }

  /** True if the piece fits at the given place (inside the board and not overlapping blocks). */
  fits(type: number, rotation: number, x: number, y: number): boolean {
    for (let i = 0; i < 4; i++) {
      const bx = x + pieceCellX(type, rotation, i);
      const by = y + pieceCellY(type, rotation, i);
      if (bx < 0 || bx >= BOARD_COLS || by < 0 || by >= BOARD_ROWS) return false;
      if (this.board[by * BOARD_COLS + bx] !== 0) return false;
    }
    return true;
  }

  /** Row the active piece would land on (for the ghost preview). */
  dropY(): number {
    let y = this.pieceY;
    while (this.fits(this.pieceType, this.pieceRot, this.pieceX, y + 1)) y++;
    return y;
  }

  // ---- Setup -------------------------------------------------------------------------------------
  reset(startLevel = 1): void {
    this.board.fill(0);
    this.scoreValue = 0;
    this.linesValue = 0;
    this.startLevel = Math.max(1, Math.floor(startLevel));
    this.levelValue = this.startLevel;
    this.clearCountValue = 0;
    this.clearTimerValue = 0;
    this.bagIndex = PIECE_COUNT;
    this.shift.reset();
    this.stateValue = 'falling';
    this.nextType = this.drawFromBag();
    this.spawn(this.drawFromBag());
  }

  /**
   * Test/setup hook: replace the active piece. Returns false (and leaves it unchanged) if the
   * piece does not fit there.
   */
  placePiece(type: number, rotation: number, x: number, y: number): boolean {
    if (!this.fits(type, rotation, x, y)) return false;
    this.pieceType = type;
    this.pieceRot = rotation & 3;
    this.pieceX = x;
    this.pieceY = y;
    this.stateValue = 'falling';
    this.gravityCounter = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    return true;
  }

  /** Test/setup hook: choose the piece that spawns next. */
  setNextPiece(type: number): void {
    this.nextType = type;
  }

  /** Spawn position for a piece type: centred, with its top cells on the first visible row. */
  static spawnX(type: number): number {
    return Math.floor((BOARD_COLS - pieceBoxSize(type)) / 2);
  }
  static spawnY(type: number): number {
    return type === PIECE_I ? HIDDEN_ROWS - 1 : HIDDEN_ROWS;
  }

  // ---- Per-tick update -------------------------------------------------------------------------
  update(input: InputFrame): void {
    if (this.stateValue === 'over') return;
    if (this.stateValue === 'clearing') {
      this.clearTimerValue--;
      if (this.clearTimerValue <= 0) {
        this.collapseClearedRows();
        this.spawn(this.takeNext());
      }
      return;
    }

    const dx = this.shift.update(
      input.isDown('left'),
      input.isDown('right'),
      input.wasPressed('left'),
      input.wasPressed('right'),
    );
    if (dx !== 0) this.move(dx);
    if (input.wasPressed('a')) this.rotate(1);
    if (input.wasPressed('b')) this.rotate(-1);
    if (input.wasPressed('up')) {
      this.hardDrop();
      return;
    }
    this.applyGravity(input.isDown('down'));
  }

  /** Shift the active piece; returns true if it moved. */
  move(dx: number): boolean {
    if (this.stateValue !== 'falling') return false;
    if (!this.fits(this.pieceType, this.pieceRot, this.pieceX + dx, this.pieceY)) return false;
    this.pieceX += dx;
    this.onGroundAction();
    this.listener('move', 0);
    return true;
  }

  /** Rotate +1 (clockwise) or -1 (counter-clockwise) with simple wall kicks. */
  rotate(direction: 1 | -1): boolean {
    if (this.stateValue !== 'falling') return false;
    const rot = (this.pieceRot + direction + 4) & 3;
    for (const [kx, ky] of KICK_OFFSETS) {
      if (this.fits(this.pieceType, rot, this.pieceX + kx, this.pieceY + ky)) {
        this.pieceRot = rot;
        this.pieceX += kx;
        this.pieceY += ky;
        this.onGroundAction();
        this.listener('rotate', direction);
        return true;
      }
    }
    return false;
  }

  /** Drop to the floor and lock at once. Returns the number of rows dropped. */
  hardDrop(): number {
    if (this.stateValue !== 'falling') return 0;
    const target = this.dropY();
    const rows = target - this.pieceY;
    this.pieceY = target;
    this.addScore(rows * HARD_DROP_POINTS_PER_ROW);
    this.listener('harddrop', rows);
    this.lockPiece();
    return rows;
  }

  private applyGravity(softDrop: boolean): void {
    const interval = softDrop ? Math.min(SOFT_DROP_TICKS, this.gravityTicks) : this.gravityTicks;
    this.gravityCounter++;
    const grounded = !this.fits(this.pieceType, this.pieceRot, this.pieceX, this.pieceY + 1);
    if (grounded) {
      this.lockTimer++;
      const softLock = softDrop && this.gravityCounter >= interval;
      if (this.lockTimer >= LOCK_DELAY_TICKS || softLock) this.lockPiece();
      return;
    }
    if (this.gravityCounter >= interval) {
      this.gravityCounter = 0;
      this.pieceY++;
      this.lockTimer = 0;
      if (softDrop) this.addScore(SOFT_DROP_POINTS_PER_ROW);
    }
  }

  private onGroundAction(): void {
    if (this.lockTimer > 0 && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  private lockPiece(): void {
    let visibleCells = 0;
    for (let i = 0; i < 4; i++) {
      const bx = this.pieceX + pieceCellX(this.pieceType, this.pieceRot, i);
      const by = this.pieceY + pieceCellY(this.pieceType, this.pieceRot, i);
      this.board[by * BOARD_COLS + bx] = this.pieceType;
      if (by >= HIDDEN_ROWS) visibleCells++;
    }
    this.listener('lock', 0);
    if (visibleCells === 0) {
      this.finish(); // locked entirely above the well
      return;
    }
    this.findFullRows();
    if (this.clearCountValue > 0) {
      this.stateValue = 'clearing';
      this.clearTimerValue = CLEAR_ANIMATION_TICKS;
      this.scoreLines(this.clearCountValue);
    } else {
      this.spawn(this.takeNext());
    }
  }

  private findFullRows(): void {
    this.clearCountValue = 0;
    for (let y = 0; y < BOARD_ROWS; y++) {
      let full = true;
      for (let x = 0; x < BOARD_COLS; x++) {
        if (this.board[y * BOARD_COLS + x] === 0) {
          full = false;
          break;
        }
      }
      if (full && this.clearCountValue < 4) this.clearingRows[this.clearCountValue++] = y;
    }
  }

  private scoreLines(count: number): void {
    this.addScore((LINE_CLEAR_POINTS[count] ?? 0) * this.levelValue);
    this.linesValue += count;
    this.listener('clear', count);
    const newLevel = this.startLevel + Math.floor(this.linesValue / LINES_PER_LEVEL);
    if (newLevel > this.levelValue) {
      this.levelValue = newLevel;
      this.listener('levelup', newLevel);
    }
  }

  /** Removes the rows in `clearingRows` and drops everything above them. */
  private collapseClearedRows(): void {
    let write = BOARD_ROWS - 1;
    for (let read = BOARD_ROWS - 1; read >= 0; read--) {
      if (this.isClearingRow(read)) continue;
      if (write !== read) this.board.copyWithin(write * BOARD_COLS, read * BOARD_COLS, (read + 1) * BOARD_COLS);
      write--;
    }
    for (; write >= 0; write--) this.board.fill(0, write * BOARD_COLS, (write + 1) * BOARD_COLS);
    this.clearCountValue = 0;
  }

  private isClearingRow(y: number): boolean {
    for (let i = 0; i < this.clearCountValue; i++) if (this.clearingRows[i] === y) return true;
    return false;
  }

  private takeNext(): number {
    const type = this.nextType;
    this.nextType = this.drawFromBag();
    return type;
  }

  private spawn(type: number): void {
    this.pieceType = type;
    this.pieceRot = 0;
    this.pieceX = PixelBlocksEngine.spawnX(type);
    this.pieceY = PixelBlocksEngine.spawnY(type);
    this.gravityCounter = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.stateValue = 'falling';
    if (!this.fits(type, 0, this.pieceX, this.pieceY)) {
      this.finish();
      return;
    }
    this.listener('spawn', type);
  }

  private finish(): void {
    this.stateValue = 'over';
    this.listener('gameover', 0);
  }

  /** 7-bag randomizer: every run of seven pieces contains each shape once. */
  private drawFromBag(): number {
    if (this.bagIndex >= PIECE_COUNT) {
      for (let i = 0; i < PIECE_COUNT; i++) this.bag[i] = i + 1;
      shuffleInPlace(this.random, this.bag);
      this.bagIndex = 0;
    }
    return this.bag[this.bagIndex++] ?? PIECE_T;
  }

  private addScore(points: number): void {
    this.scoreValue = Math.min(MAX_SCORE, this.scoreValue + points);
  }
}
