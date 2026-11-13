import { describe, expect, it } from 'vitest';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import { createRng } from '../../../src/games/common/Rng';
import { PIXEL_BLOCKS_ID, PixelBlocksGame } from '../../../src/games/PixelBlocks';
import { BLOCKS_THEME, BLOCKS_TITLE_THEME } from '../../../src/games/PixelBlocksAudio';
import {
  BOARD_COLS,
  BOARD_ROWS,
  CLEAR_ANIMATION_TICKS,
  gravityTicksForLevel,
  HARD_DROP_POINTS_PER_ROW,
  LINE_CLEAR_POINTS,
  PIECE_I,
  PIECE_O,
  PIECE_T,
  PixelBlocksEngine,
  SHIFT_DELAY_TICKS,
  SHIFT_INTERVAL_TICKS,
} from '../../../src/games/PixelBlocksEngine';
import { createServices, distinctShades, idle, ScriptedInput, tap } from './helpers';

const BOTTOM = BOARD_ROWS - 1;

function newEngine(seed = 99): PixelBlocksEngine {
  return new PixelBlocksEngine(createRng(seed));
}

/** Fills a row except the listed columns. */
function fillRow(e: PixelBlocksEngine, y: number, gaps: readonly number[]): void {
  for (let x = 0; x < BOARD_COLS; x++) e.setCell(x, y, gaps.includes(x) ? 0 : PIECE_O);
}

function rowIsEmpty(e: PixelBlocksEngine, y: number): boolean {
  for (let x = 0; x < BOARD_COLS; x++) if (e.getCell(x, y) !== 0) return false;
  return true;
}

function finishClear(e: PixelBlocksEngine, input = new ScriptedInput()): void {
  for (let i = 0; i < CLEAR_ANIMATION_TICKS; i++) e.update(input.next());
}

describe('PixelBlocksEngine', () => {
  it('deals every shape once per bag of seven', () => {
    const e = newEngine();
    const seen: number[] = [e.currentType];
    for (let i = 0; i < 6; i++) {
      // Drop each piece and wipe the board so the next one always spawns.
      e.hardDrop();
      e.board.fill(0);
      seen.push(e.currentType);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops at the walls and on other blocks', () => {
    const e = newEngine();
    expect(e.placePiece(PIECE_O, 0, 4, 5)).toBe(true);
    let moves = 0;
    while (e.move(-1)) moves++;
    expect(e.currentX).toBe(0);
    expect(moves).toBe(4);
    while (e.move(1)) moves++;
    expect(e.currentX).toBe(BOARD_COLS - 2);
    e.setCell(BOARD_COLS - 3, 5, PIECE_T);
    expect(e.move(-1)).toBe(false);
    expect(e.fits(PIECE_O, 0, BOARD_COLS - 2, BOARD_ROWS - 1)).toBe(false);
  });

  it('rotates clockwise and counter-clockwise', () => {
    const e = newEngine();
    e.placePiece(PIECE_T, 0, 4, 6);
    expect(e.rotate(1)).toBe(true);
    expect(e.currentRotation).toBe(1);
    expect(e.rotate(-1)).toBe(true);
    expect(e.rotate(-1)).toBe(true);
    expect(e.currentRotation).toBe(3);
  });

  it('kicks off the wall when rotating against it', () => {
    const e = newEngine();
    // Vertical I in rotation 1 sits in box column 2; x = -2 puts it flush with the left wall.
    expect(e.placePiece(PIECE_I, 1, -2, 6)).toBe(true);
    expect(e.rotate(1)).toBe(true);
    expect(e.currentRotation).toBe(2);
    expect(e.currentX).toBe(0); // kicked two columns right
    expect(e.fits(PIECE_I, 2, e.currentX, e.currentY)).toBe(true);
  });

  it('refuses a rotation with no free kick position', () => {
    const e = newEngine();
    e.placePiece(PIECE_I, 0, 3, 10);
    for (let y = 2; y < BOARD_ROWS; y++) {
      for (let x = 0; x < BOARD_COLS; x++) if (y !== 11) e.setCell(x, y, PIECE_O);
    }
    expect(e.rotate(1)).toBe(false);
    expect(e.currentRotation).toBe(0);
  });

  it('hard drop lands, locks and scores 2 points per row', () => {
    const e = newEngine();
    e.placePiece(PIECE_O, 0, 0, 4);
    const rows = e.hardDrop();
    expect(rows).toBe(BOTTOM - 1 - 4);
    expect(e.score).toBe(rows * HARD_DROP_POINTS_PER_ROW);
    expect(e.getCell(0, BOTTOM)).toBe(PIECE_O);
    expect(e.getCell(1, BOTTOM - 1)).toBe(PIECE_O);
    expect(e.state).toBe('falling'); // next piece spawned
  });

  it('Up on the d-pad hard drops through update()', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.placePiece(PIECE_O, 0, 0, 4);
    e.update(input.next('up'));
    expect(e.getCell(0, BOTTOM)).toBe(PIECE_O);
  });

  it('clears a full line with a flash delay and scores it', () => {
    const e = newEngine();
    fillRow(e, BOTTOM, [0, 1, 2, 3]);
    e.placePiece(PIECE_I, 0, 0, 2); // horizontal I in box row 1 -> board row 3
    const dropped = e.hardDrop();
    expect(e.state).toBe('clearing');
    expect(e.clearCount).toBe(1);
    expect(e.lines).toBe(1);
    expect(e.score).toBe(dropped * HARD_DROP_POINTS_PER_ROW + LINE_CLEAR_POINTS[1]!);
    expect(rowIsEmpty(e, BOTTOM)).toBe(false); // still flashing
    finishClear(e);
    expect(e.state).toBe('falling');
    expect(rowIsEmpty(e, BOTTOM)).toBe(true);
  });

  it('collapses rows above a cleared line', () => {
    const e = newEngine();
    fillRow(e, BOTTOM, [9]);
    e.setCell(5, BOTTOM - 1, PIECE_T);
    e.placePiece(PIECE_I, 1, 7, 10); // vertical I in column 9
    e.hardDrop();
    expect(e.clearCount).toBe(1);
    finishClear(e);
    expect(e.getCell(5, BOTTOM)).toBe(PIECE_T);
    expect(e.getCell(9, BOTTOM)).toBe(PIECE_I);
    expect(e.getCell(9, BOTTOM - 1)).toBe(PIECE_I);
  });

  it('scores four lines at once with the top table entry', () => {
    const e = newEngine();
    for (let y = BOTTOM - 3; y <= BOTTOM; y++) fillRow(e, y, [9]);
    e.placePiece(PIECE_I, 1, 7, 2);
    const dropped = e.hardDrop();
    expect(e.clearCount).toBe(4);
    expect(e.score).toBe(dropped * 2 + LINE_CLEAR_POINTS[4]!);
    finishClear(e);
    for (let y = 2; y < BOARD_ROWS; y++) expect(rowIsEmpty(e, y)).toBe(true);
  });

  it('levels up every 10 lines and gravity speeds up', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    expect(e.level).toBe(1);
    const slow = e.gravityTicks;
    for (let i = 0; i < 10; i++) {
      fillRow(e, BOTTOM, [0, 1, 2, 3]);
      expect(e.placePiece(PIECE_I, 0, 0, 2)).toBe(true);
      e.hardDrop();
      finishClear(e, input);
    }
    expect(e.lines).toBe(10);
    expect(e.level).toBe(2);
    expect(e.gravityTicks).toBe(gravityTicksForLevel(2));
    expect(e.gravityTicks).toBeLessThan(slow);
  });

  it('applies gravity at the level rate and soft drop is faster and scores', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.placePiece(PIECE_T, 0, 4, 2);
    for (let i = 0; i < gravityTicksForLevel(1) - 1; i++) e.update(input.next());
    expect(e.currentY).toBe(2);
    e.update(input.next());
    expect(e.currentY).toBe(3);

    const s = newEngine();
    s.placePiece(PIECE_T, 0, 4, 2);
    for (let i = 0; i < 10; i++) s.update(input.next('down'));
    expect(s.currentY).toBe(7);
    expect(s.score).toBe(5);
  });

  it('auto-repeats horizontal movement while held', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.placePiece(PIECE_O, 0, 0, 4);
    const ticks = SHIFT_DELAY_TICKS + 2 * SHIFT_INTERVAL_TICKS + 1;
    for (let i = 0; i < ticks; i++) e.update(input.next('right'));
    expect(e.currentX).toBe(4); // press + delay + two repeats
  });

  it('locks a grounded piece after the lock delay', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.placePiece(PIECE_O, 0, 4, BOTTOM - 1);
    for (let i = 0; i < 40; i++) e.update(input.next());
    expect(e.getCell(4, BOTTOM)).toBe(PIECE_O);
  });

  it('ends the game when a new piece cannot spawn', () => {
    const e = newEngine();
    e.placePiece(PIECE_O, 0, 0, 10);
    for (let x = 2; x < BOARD_COLS; x++) {
      e.setCell(x, 2, PIECE_T);
      e.setCell(x, 3, PIECE_T);
    }
    e.hardDrop();
    expect(e.isOver).toBe(true);
    const input = new ScriptedInput();
    e.update(input.next('left'));
    expect(e.isOver).toBe(true);
  });
});

describe('PixelBlocksGame', () => {
  it('starts on the title with title music and SELECT toggles music', () => {
    const services = createServices();
    const game = new PixelBlocksGame(services);
    const input = new ScriptedInput();
    idle(game, input, 1);
    expect(game.phase).toBe('title');
    expect(services.sound.playing).toBe(BLOCKS_TITLE_THEME.id);
    tap(game, input, 'select');
    expect(game.getDebugState().musicEnabled).toBe(false);
    expect(services.sound.playing).toBeNull();
    tap(game, input, 'select');
    expect(services.sound.playing).toBe(BLOCKS_TITLE_THEME.id);
  });

  it('START plays, pauses (hiding the board) and resumes', () => {
    const services = createServices();
    const game = new PixelBlocksGame(services);
    const input = new ScriptedInput();
    tap(game, input, 'start');
    expect(game.phase).toBe('playing');
    expect(services.sound.playing).toBe(BLOCKS_THEME.id);
    tap(game, input, 'start');
    expect(game.phase).toBe('paused');
    expect(services.sound.playing).toBeNull();
    const y = game.engine.currentY;
    idle(game, input, 200);
    expect(game.engine.currentY).toBe(y);
    tap(game, input, 'start');
    expect(game.phase).toBe('playing');
    expect(services.sound.playing).toBe(BLOCKS_THEME.id);
  });

  it('records the high score on game over and restarts with START', () => {
    const services = createServices();
    const game = new PixelBlocksGame(services);
    const input = new ScriptedInput();
    tap(game, input, 'start');
    // Hard drop repeatedly until the stack reaches the top.
    for (let i = 0; i < 400 && game.phase === 'playing'; i++) tap(game, input, 'up');
    expect(game.phase).toBe('gameover');
    const score = game.engine.score;
    expect(score).toBeGreaterThan(0);
    expect(services.highScores.get(PIXEL_BLOCKS_ID)).toBe(score);
    expect(game.getDebugState().highScore).toBe(score);
    expect(services.sound.effects.at(-1)).toBeDefined();
    idle(game, input, 120);
    tap(game, input, 'start');
    expect(game.phase).toBe('playing');
    expect(game.engine.score).toBe(0);
  });

  it('renders 600 ticks of a scripted session without errors', () => {
    const services = createServices(7);
    const game = new PixelBlocksGame(services);
    const input = new ScriptedInput();
    const fb = new FrameBuffer();
    const script = ['left', 'a', 'right', 'down', 'b', 'up'] as const;
    for (let t = 0; t < 600; t++) {
      let held: (typeof script)[number] | 'start' | undefined;
      if (t === 30 || t === 400 || t === 430) held = 'start';
      else if (t > 40) held = script[Math.floor(t / 13) % script.length];
      game.tick(held ? input.next(held) : input.next());
      game.render(fb);
      expect(distinctShades(fb)).toBeGreaterThan(1);
    }
  });
});
