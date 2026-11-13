import { describe, expect, it } from 'vitest';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import { createRng } from '../../../src/games/common/Rng';
import { PIXEL_SNAKE_ID, PixelSnakeGame } from '../../../src/games/PixelSnake';
import {
  BONUS_LIFETIME_TICKS,
  BONUS_MAX_POINTS,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  FOOD_POINTS,
  GROWTH_PER_FOOD,
  PixelSnakeEngine,
  SNAKE_COLS,
  SNAKE_ROWS,
  START_STEP_TICKS,
} from '../../../src/games/PixelSnakeEngine';
import { createServices, distinctShades, idle, ScriptedInput, tap } from './helpers';

function newEngine(seed = 5): PixelSnakeEngine {
  const e = new PixelSnakeEngine(createRng(seed));
  e.setFood(-1, -1);
  return e;
}

/** A horizontal snake with its head at (x, y) heading right, `length` long. */
function snakeAt(e: PixelSnakeEngine, x: number, y: number, length = 4): void {
  const cells: [number, number][] = [];
  for (let i = 0; i < length; i++) cells.push([x - i, y]);
  e.setSnake(cells, DIR_RIGHT);
}

describe('PixelSnakeEngine', () => {
  it('starts with a snake and food placed off the snake', () => {
    const e = new PixelSnakeEngine(createRng(1));
    expect(e.length).toBe(4);
    expect(e.food).toBeGreaterThanOrEqual(0);
    expect(e.isOccupied(e.food % SNAKE_COLS, Math.floor(e.food / SNAKE_COLS))).toBe(false);
  });

  it('moves one cell per step interval', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    snakeAt(e, 10, 10);
    for (let i = 0; i < START_STEP_TICKS - 1; i++) e.update(input.next());
    expect(e.headX).toBe(10);
    e.update(input.next());
    expect(e.headX).toBe(11);
    expect(e.isOccupied(7, 10)).toBe(false); // tail moved on
  });

  it('grows and scores when eating food', () => {
    const e = newEngine();
    snakeAt(e, 10, 10);
    e.setFood(11, 10);
    e.step();
    expect(e.score).toBe(FOOD_POINTS);
    expect(e.foodEaten).toBe(1);
    expect(e.food).not.toBe(10 * SNAKE_COLS + 11);
    e.setFood(-1, -1);
    for (let i = 0; i < GROWTH_PER_FOOD + 2; i++) e.step();
    expect(e.length).toBe(4 + GROWTH_PER_FOOD);
  });

  it('ignores a 180 degree reversal', () => {
    const e = newEngine();
    snakeAt(e, 10, 10);
    expect(e.queueTurn(DIR_LEFT)).toBe(false);
    e.step();
    expect(e.isDead).toBe(false);
    expect(e.direction).toBe(DIR_RIGHT);
    expect(e.headX).toBe(11);
  });

  it('buffers quick double turns from the d-pad', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    snakeAt(e, 10, 10);
    e.update(input.next('up'));
    e.update(input.next('left')); // reverse of RIGHT, but valid after UP
    expect(e.queuedTurns).toBe(2);
    for (let i = 0; i < START_STEP_TICKS * 2; i++) e.update(input.next());
    expect(e.direction).toBe(DIR_LEFT);
    expect([e.headX, e.headY]).toEqual([9, 9]);
  });

  it('dies on the wall in WALLS mode', () => {
    const e = newEngine();
    e.mode = 'walls';
    snakeAt(e, SNAKE_COLS - 1, 5);
    e.step();
    expect(e.isDead).toBe(true);
    expect(e.death).toBe('wall');
  });

  it('wraps around the edges in WRAP mode', () => {
    const e = newEngine();
    e.mode = 'wrap';
    snakeAt(e, SNAKE_COLS - 1, 5);
    e.step();
    expect(e.isDead).toBe(false);
    expect([e.headX, e.headY]).toEqual([0, 5]);
    e.setSnake([[3, 0], [3, 1], [3, 2]], DIR_UP);
    e.step();
    expect([e.headX, e.headY]).toEqual([3, SNAKE_ROWS - 1]);
  });

  it('dies when running into its own body', () => {
    const e = newEngine();
    // Head at (5,5) going down into a body loop.
    e.setSnake(
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
        [4, 6],
        [4, 7],
      ],
      DIR_LEFT,
    );
    e.queueTurn(DIR_DOWN);
    e.step();
    expect(e.isDead).toBe(true);
    expect(e.death).toBe('self');
  });

  it('may move into the cell its tail is leaving', () => {
    const e = newEngine();
    e.setSnake(
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
      ],
      DIR_LEFT,
    );
    e.queueTurn(DIR_DOWN);
    e.step();
    expect(e.isDead).toBe(false);
    expect([e.headX, e.headY]).toEqual([5, 6]);
  });

  it('awards the timed bonus and lets it expire', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    snakeAt(e, 10, 10);
    e.setBonus(11, 10);
    e.step();
    expect(e.score).toBe(BONUS_MAX_POINTS);
    expect(e.bonus).toBe(-1);

    e.setBonus(1, 1, 5);
    for (let i = 0; i < 5; i++) e.update(input.next());
    expect(e.bonus).toBe(-1);
  });

  it('spawns a bonus after every fifth food', () => {
    const e = newEngine();
    snakeAt(e, 10, 10);
    for (let i = 0; i < 5; i++) {
      e.setFood(e.headX + 1, e.headY);
      e.step();
    }
    expect(e.bonus).toBeGreaterThanOrEqual(0);
    expect(e.bonusTimer).toBe(BONUS_LIFETIME_TICKS);
  });

  it('speeds up as food is eaten', () => {
    const e = newEngine();
    snakeAt(e, 3, 3);
    const start = e.stepTicks;
    for (let i = 0; i < 8; i++) {
      e.setFood(e.headX + 1, e.headY);
      e.step();
    }
    expect(e.stepTicks).toBe(start - 2);
  });
});

describe('PixelSnakeGame', () => {
  it('SELECT on the title toggles WALLS / WRAP', () => {
    const services = createServices();
    const game = new PixelSnakeGame(services);
    const input = new ScriptedInput();
    expect(game.mode).toBe('walls');
    tap(game, input, 'select');
    expect(game.mode).toBe('wrap');
    tap(game, input, 'start');
    expect(game.engine.mode).toBe('wrap');
    expect(game.phase).toBe('playing');
  });

  it('pauses, resumes, and reaches game over with a high score', () => {
    const services = createServices();
    const game = new PixelSnakeGame(services);
    const input = new ScriptedInput();
    tap(game, input, 'start');
    game.engine.setFood(game.engine.headX + 1, game.engine.headY);
    tap(game, input, 'start');
    expect(game.phase).toBe('paused');
    idle(game, input, 100);
    tap(game, input, 'start');
    // Run straight into the right wall.
    idle(game, input, 400);
    expect(game.phase).toBe('gameover');
    expect(game.engine.death).toBe('wall');
    expect(game.engine.score).toBeGreaterThan(0);
    expect(services.highScores.get(PIXEL_SNAKE_ID)).toBe(game.engine.score);
    idle(game, input, 80);
    tap(game, input, 'start');
    expect(game.phase).toBe('playing');
    expect(game.engine.score).toBe(0);
  });

  it('renders 600 ticks of a scripted session without errors', () => {
    const services = createServices(11);
    const game = new PixelSnakeGame(services);
    const input = new ScriptedInput();
    const fb = new FrameBuffer();
    const turns = ['up', 'right', 'down', 'left'] as const;
    for (let t = 0; t < 600; t++) {
      if (t === 10) game.tick(input.next('select'));
      else if (t === 20 || t === 300 || t === 330 || (game.phase === 'gameover' && t % 90 === 0)) {
        game.tick(input.next('start'));
      } else if (t > 20 && t % 25 === 0) game.tick(input.next(turns[(t / 25) % 4]!));
      else game.tick(input.next());
      game.render(fb);
      expect(distinctShades(fb)).toBeGreaterThan(1);
    }
  });
});
