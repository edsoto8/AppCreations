import { describe, expect, it } from 'vitest';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import { createRng } from '../../../src/games/common/Rng';
import { RETRO_RACER_ID, RetroRacerGame } from '../../../src/games/RetroRacer';
import { RACER_SFX } from '../../../src/games/RetroRacerAudio';
import {
  CAR_W,
  CRASH_TICKS,
  DISTANCE_PER_POINT,
  FUEL_CAN_AMOUNT,
  FUEL_MAX,
  FUEL_POINTS,
  MAX_SPEED,
  OFFROAD_MAX_SPEED,
  OVERTAKE_POINTS,
  PLAYER_SCREEN_Y,
  ROAD_AREA_W,
  RetroRacerEngine,
  START_LIVES,
} from '../../../src/games/RetroRacerEngine';
import { createServices, distinctShades, idle, ScriptedInput, tap } from './helpers';

function newEngine(seed = 3): RetroRacerEngine {
  const e = new RetroRacerEngine(createRng(seed));
  e.autoSpawn = false;
  return e;
}

/** The lane the player's car is centred in at the start. */
const PLAYER_LANE = 1;

describe('RetroRacerEngine', () => {
  it('accelerates with A up to the top speed and brakes with B', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i++) e.update(input.next('a'));
    expect(e.speed).toBe(MAX_SPEED);
    expect(e.displaySpeed).toBe(200);
    for (let i = 0; i < 10; i++) e.update(input.next('b'));
    expect(e.speed).toBeLessThan(MAX_SPEED - 1);
    for (let i = 0; i < 100; i++) e.update(input.next('b'));
    expect(e.speed).toBe(0);
  });

  it('keeps the car inside the screen when steering hard', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i++) e.update(input.next('a', 'left'));
    expect(e.playerX).toBe(0);
    for (let i = 0; i < 300; i++) e.update(input.next('a', 'right'));
    expect(e.playerX).toBe(ROAD_AREA_W - CAR_W);
  });

  it('does not steer while stopped and slows down off the road', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    const x = e.playerX;
    e.update(input.next('left'));
    expect(e.playerX).toBe(x);
    e.setPlayerX(0);
    e.setSpeed(MAX_SPEED);
    for (let i = 0; i < 120; i++) e.update(input.next('a'));
    expect(e.isOffroad).toBe(true);
    expect(e.speed).toBeLessThanOrEqual(OFFROAD_MAX_SPEED + 0.05);
  });

  it('crashes into traffic, loses a life and respawns protected', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.setSpeed(2);
    e.spawnTraffic(PLAYER_LANE, PLAYER_SCREEN_Y, 0);
    e.update(input.next('a'));
    expect(e.state).toBe('crashed');
    expect(e.lives).toBe(START_LIVES - 1);
    expect(e.speed).toBe(0);
    for (let i = 0; i < CRASH_TICKS; i++) e.update(input.next('a'));
    expect(e.state).toBe('driving');
    expect(e.invulnerableTicks).toBeGreaterThan(0);
    // While protected, overlapping traffic is harmless.
    e.spawnTraffic(PLAYER_LANE, PLAYER_SCREEN_Y, 0);
    e.update(input.next());
    expect(e.state).toBe('driving');
  });

  it('ends the race after the last life is lost', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    for (let life = 0; life < START_LIVES; life++) {
      for (const car of e.traffic) car.active = false;
      for (let i = 0; i < 200 && e.invulnerableTicks > 0; i++) e.update(input.next());
      e.setPlayerX(e.laneCenterX(PLAYER_LANE, e.distance - 7) - CAR_W / 2);
      e.spawnTraffic(PLAYER_LANE, PLAYER_SCREEN_Y, 0);
      e.update(input.next());
      expect(e.state).toBe('crashed');
      for (let i = 0; i < CRASH_TICKS; i++) e.update(input.next());
    }
    expect(e.isOver).toBe(true);
    expect(e.overReason).toBe('crash');
  });

  it('drains fuel faster at speed and refuels from cans', () => {
    const idleEngine = newEngine();
    const fast = newEngine();
    const input = new ScriptedInput();
    fast.setSpeed(MAX_SPEED);
    for (let i = 0; i < 100; i++) {
      idleEngine.update(input.next());
      fast.update(input.next('a'));
    }
    expect(idleEngine.fuel).toBeLessThan(FUEL_MAX);
    expect(fast.fuel).toBeLessThan(idleEngine.fuel);

    const e = newEngine();
    e.setFuel(40);
    const scoreBefore = e.score;
    e.spawnFuelCan(PLAYER_LANE, PLAYER_SCREEN_Y + 2);
    e.update(input.next());
    expect(e.fuelCan.active).toBe(false);
    expect(e.fuel).toBeGreaterThan(40 + FUEL_CAN_AMOUNT - 1);
    expect(e.score).toBe(scoreBefore + FUEL_POINTS);
  });

  it('ends the race when the tank is empty and the car stops', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.setSpeed(1);
    e.setFuel(0.01);
    for (let i = 0; i < 200 && !e.isOver; i++) e.update(input.next('a'));
    expect(e.isOver).toBe(true);
    expect(e.overReason).toBe('fuel');
  });

  it('scores distance and overtakes', () => {
    const e = newEngine();
    const input = new ScriptedInput();
    e.setSpeed(MAX_SPEED);
    e.spawnTraffic(0, PLAYER_SCREEN_Y - 40, 0.5);
    for (let i = 0; i < 100; i++) e.update(input.next('a'));
    expect(e.state).toBe('driving');
    expect(e.overtakes).toBe(1);
    expect(e.score).toBe(Math.floor(e.distance / DISTANCE_PER_POINT) + OVERTAKE_POINTS);
  });

  it('spawns traffic and fuel automatically and ramps difficulty', () => {
    const e = new RetroRacerEngine(createRng(21));
    const input = new ScriptedInput();
    let sawTraffic = false;
    let sawFuel = false;
    for (let i = 0; i < 2000 && !e.isOver; i++) {
      e.update(input.next('a'));
      // Clear cars once seen so the unsteered test car never crashes.
      for (const car of e.traffic) {
        if (car.active && e.screenY(car.wy) > 40) {
          sawTraffic = true;
          car.active = false;
        }
      }
      if (e.fuelCan.active) sawFuel = true;
    }
    expect(sawTraffic).toBe(true);
    expect(sawFuel).toBe(true);
    expect(e.difficulty).toBeGreaterThan(0);
  });

  it('is deterministic for a given random source', () => {
    const run = (): number[] => {
      const e = new RetroRacerEngine(createRng(77));
      const input = new ScriptedInput();
      for (let i = 0; i < 900; i++) e.update(input.next('a', i % 120 < 30 ? 'left' : 'right'));
      return [e.distance, e.playerX, e.fuel, e.lives, e.score];
    };
    expect(run()).toEqual(run());
  });
});

describe('RetroRacerGame', () => {
  it('flows title -> play -> pause -> game over and stores the high score', () => {
    const services = createServices();
    const game = new RetroRacerGame(services);
    const input = new ScriptedInput();
    idle(game, input, 3);
    expect(game.phase).toBe('title');
    tap(game, input, 'start');
    expect(game.phase).toBe('playing');
    for (let i = 0; i < 120; i++) game.tick(input.next('a'));
    tap(game, input, 'start');
    expect(game.phase).toBe('paused');
    const d = game.engine.distance;
    idle(game, input, 60);
    expect(game.engine.distance).toBe(d);
    tap(game, input, 'start');
    game.engine.setFuel(0.01);
    for (let i = 0; i < 400 && game.phase === 'playing'; i++) game.tick(input.next('b'));
    expect(game.phase).toBe('gameover');
    expect(services.highScores.get(RETRO_RACER_ID)).toBe(game.engine.score);
    expect(services.sound.effects).toContain(RACER_SFX.gameOver);
  });

  it('renders 600 ticks of a scripted session without errors', () => {
    const services = createServices(19);
    const game = new RetroRacerGame(services);
    const input = new ScriptedInput();
    const fb = new FrameBuffer();
    for (let t = 0; t < 600; t++) {
      if (t === 15 || t === 350 || t === 380) game.tick(input.next('start'));
      else if (t > 15) game.tick(input.next('a', Math.floor(t / 40) % 2 === 0 ? 'left' : 'right'));
      else game.tick(input.next());
      game.render(fb);
      expect(distinctShades(fb)).toBeGreaterThan(1);
    }
    expect(game.engine.distance).toBeGreaterThan(0);
  });
});
