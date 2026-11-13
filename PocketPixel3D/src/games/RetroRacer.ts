/**
 * Retro Racer: an original top-down road racer with traffic, curves and a fuel gauge.
 * Rules live in {@link RetroRacerEngine}; this module adds the screens, drawing and sound.
 */
import type { CartridgeDefinition, GameServices, InputFrame, Shade } from './GameInterface';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from './GameInterface';
import { ArcadeGame } from './common/ArcadeGame';
import type { FrameBuffer } from './common/FrameBuffer';
import { drawNumber, drawText } from './common/PixelFont';
import { drawHighScoreLine, drawPushStart } from './common/ScreenKit';
import { RACER_ENGINE_SFX, RACER_SFX, RACER_THEME, RACER_TITLE_THEME } from './RetroRacerAudio';
import {
  CAR_H,
  CRASH_TICKS,
  FUEL_LOW,
  FUEL_MAX,
  LANE_COUNT,
  MAX_SPEED,
  PLAYER_SCREEN_Y,
  ROAD_AREA_W,
  type RacerEvent,
  RetroRacerEngine,
} from './RetroRacerEngine';

export const RETRO_RACER_ID = 'retro-racer';

// ---- Layout & timing --------------------------------------------------------------------------
const HUD_X = ROAD_AREA_W;
const HUD_TEXT_X = HUD_X + 4;
const RUMBLE_W = 3;
const RUMBLE_PERIOD = 6;
const DASH_PERIOD = 10;
const TREE_SPACING = 48;
const GO_BANNER_TICKS = 60;
const STAGE_BANNER_TICKS = 90;
const CRASH_PARTICLE_TICKS = 40;

// ---- Sprites ----------------------------------------------------------------------------------
const PLAYER_CAR = [
  '..33333..',
  '.3000003.',
  '330000033',
  '331111133',
  '331111133',
  '.3000003.',
  '.3022203.',
  '.3022203.',
  '.3000003.',
  '.3111113.',
  '330000033',
  '330000033',
  '.3000003.',
  '..33333..',
];
const TRAFFIC_CAR = [
  '..33333..',
  '.3322233.',
  '332222233',
  '330000033',
  '330000033',
  '.3222223.',
  '.3233323.',
  '.3233323.',
  '.3222223.',
  '.3200023.',
  '332222233',
  '332222233',
  '.3222223.',
  '..33333..',
];
const TRUCK = [
  '.3333333.',
  '330000033',
  '330000033',
  '.3222223.',
  '.3333333.',
  '.3111113.',
  '331111133',
  '331111133',
  '.3111113.',
  '.3333333.',
  '.3111113.',
  '.3111113.',
  '.3333333.',
  '.3111113.',
  '.3111113.',
  '331111133',
  '331111133',
  '331111133',
  '.3111113.',
  '.3333333.',
];
const FUEL_CAN_SPRITE = ['.33....', '3333333', '3000003', '3033303', '3030003', '3033003', '3030003', '3333333'];
const TREE = ['..333..', '.31313.', '3131313', '3313133', '.33333.', '..333..', '...3...', '..333..'];
const BUSH = ['.......', '.......', '.......', '..333..', '.31133.', '3131313', '3333333', '.......'];
const LIFE_ICON = ['.333.', '30003', '33333', '30003', '30003', '33333', '.3.3.'];

/** Sideways car for the spin-out animation (the player sprite turned 90 degrees). */
const PLAYER_CAR_SIDE = transpose(PLAYER_CAR);

function transpose(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out: string[] = [];
  for (let x = 0; x < w; x++) {
    let line = '';
    for (let y = h - 1; y >= 0; y--) line += rows[y]?.[x] ?? '.';
    out.push(line);
  }
  return out;
}

/** Debris directions for the crash burst. */
const PARTICLE_DX: readonly number[] = [1, 0.7, 0, -0.7, -1, -0.7, 0, 0.7];
const PARTICLE_DY: readonly number[] = [0, -0.7, -1, -0.7, 0, 0.7, 1, 0.7];

function posMod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

export class RetroRacerGame extends ArcadeGame {
  readonly engine: RetroRacerEngine;
  private playTicks = 0;
  private stageBannerTicks = 0;
  private engineSoundCounter = 0;

  constructor(services: GameServices) {
    super(services, {
      id: RETRO_RACER_ID,
      title: 'RETRO RACER',
      titleMusic: RACER_TITLE_THEME,
      playMusic: RACER_THEME,
      sounds: RACER_SFX,
    });
    this.engine = new RetroRacerEngine(services.random, (event, value) => this.onEngineEvent(event, value));
  }

  /** Read-only snapshot for tests and debugging. */
  getDebugState(): {
    phase: string;
    state: string;
    score: number;
    distance: number;
    speed: number;
    fuel: number;
    lives: number;
    playerX: number;
    musicEnabled: boolean;
    highScore: number;
  } {
    const e = this.engine;
    return {
      phase: this.phase,
      state: e.state,
      score: e.score,
      distance: e.distance,
      speed: e.speed,
      fuel: e.fuel,
      lives: e.lives,
      playerX: e.playerX,
      musicEnabled: this.musicEnabled,
      highScore: this.highScore,
    };
  }

  protected onTitleSelect(): void {
    this.toggleMusic();
  }

  protected resetPlay(): void {
    this.engine.reset();
    this.playTicks = 0;
    this.stageBannerTicks = 0;
    this.engineSoundCounter = 0;
  }

  protected updatePlay(input: InputFrame): void {
    this.playTicks++;
    if (this.stageBannerTicks > 0) this.stageBannerTicks--;
    this.engine.update(input);
    this.playEngineNote();
    if (this.engine.isOver) {
      this.endGame(this.engine.score, this.engine.overReason === 'fuel' ? 'OUT OF FUEL' : 'WRECKED');
    }
  }

  /** Short putter whose rate and pitch follow the speed, for an audible sense of speed. */
  private playEngineNote(): void {
    const speed = this.engine.speed;
    if (this.engine.state !== 'driving' || speed < 0.1) return;
    this.engineSoundCounter++;
    const interval = Math.max(4, 12 - Math.floor(speed * 2));
    if (this.engineSoundCounter >= interval) {
      this.engineSoundCounter = 0;
      const spec = RACER_ENGINE_SFX[Math.min(RACER_ENGINE_SFX.length - 1, Math.floor(speed * 2))];
      if (spec) this.services.sound.sfx(spec);
    }
  }

  private onEngineEvent(event: RacerEvent, _value: number): void {
    const sound = this.services.sound;
    switch (event) {
      case 'overtake':
        sound.sfx(RACER_SFX.overtake);
        break;
      case 'fuel':
        sound.sfx(RACER_SFX.fuel);
        break;
      case 'crash':
        sound.sfx(RACER_SFX.crash);
        break;
      case 'respawn':
        sound.sfx(RACER_SFX.respawn);
        break;
      case 'stage':
        this.stageBannerTicks = STAGE_BANNER_TICKS;
        sound.sfx(RACER_SFX.stage);
        break;
      case 'lowfuel':
        sound.sfx(RACER_SFX.lowFuel);
        break;
      case 'offroad':
        sound.sfx(RACER_SFX.offroad);
        break;
      case 'over':
        break;
    }
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  protected renderTitle(fb: FrameBuffer): void {
    const cx = SCREEN_WIDTH / 2;
    drawText(fb, 'RETRO', cx, 6, 3, { align: 'center', scale: 2 });
    drawText(fb, 'RACER', cx, 24, 2, { align: 'center', scale: 2 });

    // Flair: a strip of road rushing past with the player car and a slower rival.
    const top = 44;
    const bottom = 98;
    const roadL = cx - 26;
    const roadR = cx + 26;
    const scroll = this.frame * 3;
    for (let y = top; y < bottom; y++) {
      const wy = scroll - y;
      fb.fillRect(16, y, roadL - RUMBLE_W - 16, 1, 2);
      fb.fillRect(roadR + RUMBLE_W, y, SCREEN_WIDTH - 16 - roadR - RUMBLE_W, 1, 2);
      const rumble: Shade = posMod(Math.floor(wy / RUMBLE_PERIOD), 2) === 0 ? 3 : 0;
      fb.fillRect(roadL - RUMBLE_W, y, RUMBLE_W, 1, rumble);
      fb.fillRect(roadR, y, RUMBLE_W, 1, rumble);
      fb.fillRect(roadL, y, roadR - roadL, 1, 1);
      if (posMod(Math.floor(wy / DASH_PERIOD), 2) === 0) {
        fb.fillRect(cx - 9, y, 2, 1, 0);
        fb.fillRect(cx + 8, y, 2, 1, 0);
      }
      if (posMod(wy, 9) === 0) {
        for (let x = 16 + posMod(wy * 7, 11); x < roadL - RUMBLE_W; x += 11) fb.setPixel(x, y, 3);
        for (let x = roadR + RUMBLE_W + posMod(wy * 5, 11); x < SCREEN_WIDTH - 16; x += 11) fb.setPixel(x, y, 3);
      }
    }
    fb.strokeRect(15, top - 1, SCREEN_WIDTH - 30, bottom - top + 2, 3);
    const rivalY = top - 16 + posMod(this.frame, bottom - top + 16);
    this.drawClipped(fb, TRAFFIC_CAR, cx + 13, rivalY, top, bottom);
    this.drawClipped(fb, PLAYER_CAR, cx - 4, 78 + (Math.floor(this.frame / 10) % 2), top, bottom);

    drawPushStart(fb, 104, this.frame);
    drawHighScoreLine(fb, this.highScore, 116, 2);
    drawText(fb, this.musicEnabled ? 'SELECT:MUSIC ON' : 'SELECT:MUSIC OFF', cx, 130, 3, { align: 'center' });
  }

  /** Draws a sprite but only its rows inside [top, bottom). */
  private drawClipped(fb: FrameBuffer, sprite: readonly string[], x: number, y: number, top: number, bottom: number): void {
    for (let r = 0; r < sprite.length; r++) {
      const sy = y + r;
      if (sy < top || sy >= bottom) continue;
      const row = sprite[r] ?? '';
      for (let c = 0; c < row.length; c++) {
        const code = row.charCodeAt(c) - 48;
        if (code >= 0 && code <= 3) fb.setPixel(x + c, sy, code as Shade);
      }
    }
  }

  protected renderPlay(fb: FrameBuffer): void {
    this.drawRoad(fb);
    this.drawScenery(fb);
    this.drawObjects(fb);
    this.drawPlayer(fb);
    this.drawBanners(fb);
    this.drawHud(fb);
  }

  private drawRoad(fb: FrameBuffer): void {
    const e = this.engine;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      const wy = e.distance + (PLAYER_SCREEN_Y - y);
      const wyi = Math.floor(wy);
      const c = e.roadCenterAt(wy);
      const h = e.roadHalfAt(wy);
      const left = Math.round(c - h);
      const right = Math.round(c + h);
      fb.fillRect(0, y, left - RUMBLE_W, 1, 2);
      fb.fillRect(right + RUMBLE_W, y, ROAD_AREA_W - right - RUMBLE_W, 1, 2);
      const rumble: Shade = posMod(Math.floor(wy / RUMBLE_PERIOD), 2) === 0 ? 3 : 0;
      fb.fillRect(left - RUMBLE_W, y, RUMBLE_W, 1, rumble);
      fb.fillRect(right, y, RUMBLE_W, 1, rumble);
      fb.fillRect(left, y, right - left, 1, 1);
      if (posMod(Math.floor(wy / DASH_PERIOD), 2) === 0) {
        const laneW = (2 * h) / LANE_COUNT;
        for (let k = 1; k < LANE_COUNT; k++) fb.fillRect(Math.round(c - h + laneW * k) - 1, y, 2, 1, 0);
      }
      // Grass speckles locked to the world so they stream past.
      if (posMod(wyi, 5) === 0) {
        for (let x = posMod(wyi * 7, 13); x < ROAD_AREA_W; x += 13) {
          if (x < left - RUMBLE_W || x >= right + RUMBLE_W) fb.setPixel(x, y, 3);
        }
      }
    }
  }

  private drawScenery(fb: FrameBuffer): void {
    const e = this.engine;
    const first = Math.ceil((e.distance + PLAYER_SCREEN_Y - SCREEN_HEIGHT) / TREE_SPACING);
    const last = Math.floor((e.distance + PLAYER_SCREEN_Y + 10) / TREE_SPACING);
    for (let k = first; k <= last; k++) {
      const wy = k * TREE_SPACING;
      const sy = Math.round(e.screenY(wy));
      const c = e.roadCenterAt(wy - 4);
      const h = e.roadHalfAt(wy - 4);
      const sprite = posMod(k, 3) === 0 ? BUSH : TREE;
      const lx = Math.round(c - h) - RUMBLE_W - 10 - posMod(k * 5, 6);
      const rx = Math.round(c + h) + RUMBLE_W + 3 + posMod(k * 7, 6);
      if (lx > -7) fb.drawSprite(sprite, lx, sy);
      if (rx < ROAD_AREA_W) fb.drawSprite(posMod(k, 2) === 0 ? TREE : BUSH, rx, sy + 20);
    }
  }

  private drawObjects(fb: FrameBuffer): void {
    const e = this.engine;
    const can = e.fuelCan;
    if (can.active) {
      const sy = Math.round(e.screenY(can.wy));
      const sx = Math.round(e.objectX(can.lane, can.wy, 8)) + 1;
      fb.drawSprite(FUEL_CAN_SPRITE, sx, sy, false, false);
      if (this.frame % 16 < 8) fb.setPixel(sx + 3, sy - 2, 3);
    }
    for (const car of e.traffic) {
      if (!car.active) continue;
      const sy = Math.round(e.screenY(car.wy));
      const sx = Math.round(e.objectX(car.lane, car.wy, car.length));
      fb.drawSprite(car.kind === 1 ? TRUCK : TRAFFIC_CAR, sx, sy);
    }
  }

  private drawPlayer(fb: FrameBuffer): void {
    const e = this.engine;
    if (e.state === 'crashed' || (e.state === 'over' && e.overReason === 'crash')) {
      this.drawCrash(fb);
      return;
    }
    if (e.invulnerableTicks > 0 && this.frame % 8 < 4) return;
    const x = Math.round(e.playerX);
    const shake = e.isOffroad && e.speed > 0.5 ? this.frame % 2 : 0;
    fb.drawSprite(PLAYER_CAR, x + shake, PLAYER_SCREEN_Y);
    // Exhaust puffs scale with speed.
    if (e.speed > 0.2 && this.frame % 6 < 3) {
      const len = Math.min(4, Math.ceil(e.speed));
      fb.vLine(x + 2, PLAYER_SCREEN_Y + CAR_H, len, 2);
      fb.vLine(x + 6, PLAYER_SCREEN_Y + CAR_H, len, 2);
    }
  }

  private drawCrash(fb: FrameBuffer): void {
    const e = this.engine;
    const t = e.state === 'crashed' ? CRASH_TICKS - e.crashTimer : CRASH_TICKS;
    const cx = Math.round(e.crashX);
    const cy = PLAYER_SCREEN_Y + Math.floor(CAR_H / 2);
    const spin = Math.floor(t / 4) % 4;
    if (spin === 0 || spin === 2) {
      fb.drawSprite(PLAYER_CAR, cx - 4, cy - 7, false, spin === 2);
    } else {
      fb.drawSprite(PLAYER_CAR_SIDE, cx - 7, cy - 4, spin === 3, false);
    }
    if (t < 12) {
      const r = 4 + t * 2;
      fb.strokeRect(cx - r, cy - r, r * 2, r * 2, t % 4 < 2 ? 3 : 0);
    }
    if (t < CRASH_PARTICLE_TICKS) {
      for (let i = 0; i < PARTICLE_DX.length; i++) {
        const dist = 6 + t * (1 + (i % 3) * 0.3);
        const px = Math.round(cx + (PARTICLE_DX[i] ?? 0) * dist);
        const py = Math.round(cy + (PARTICLE_DY[i] ?? 0) * dist);
        fb.fillRect(px, py, 2, 2, (t + i) % 6 < 3 ? 3 : 0);
      }
    }
  }

  private drawBanners(fb: FrameBuffer): void {
    const e = this.engine;
    const mid = ROAD_AREA_W / 2;
    if (this.playTicks < GO_BANNER_TICKS && e.state === 'driving') {
      this.drawBanner(fb, this.playTicks < GO_BANNER_TICKS / 2 ? 'READY' : 'GO!', mid, 40);
    } else if (this.stageBannerTicks > 0) {
      this.drawBanner(fb, 'STAGE', mid, 34);
      drawNumber(fb, e.stage, mid, 46, 3, 1, { align: 'center' });
    } else if (e.fuel < FUEL_LOW && e.state === 'driving' && this.frame % 40 < 24) {
      this.drawBanner(fb, e.fuel <= 0 ? 'NO FUEL' : 'FUEL LOW', mid, 30);
    }
  }

  private drawBanner(fb: FrameBuffer, text: string, x: number, y: number): void {
    const w = text.length * 6 + 9;
    fb.fillRect(x - Math.floor(w / 2), y - 3, w, 13, 0);
    fb.strokeRect(x - Math.floor(w / 2), y - 3, w, 13, 3);
    drawText(fb, text, x, y, 3, { align: 'center' });
  }

  private drawHud(fb: FrameBuffer): void {
    const e = this.engine;
    fb.fillRect(HUD_X, 0, SCREEN_WIDTH - HUD_X, SCREEN_HEIGHT, 0);
    fb.vLine(HUD_X, 0, SCREEN_HEIGHT, 3);
    fb.vLine(HUD_X + 1, 0, SCREEN_HEIGHT, 2);
    const tx = HUD_TEXT_X;
    drawText(fb, 'SCORE', tx, 3, 2);
    drawNumber(fb, e.score, tx - 1, 12, 3, 6);

    drawText(fb, 'SPEED', tx, 24, 2);
    drawNumber(fb, e.displaySpeed, tx, 33, 3, 3);
    fb.strokeRect(tx - 1, 42, 34, 5, 3);
    fb.fillRect(tx, 43, Math.round((32 * e.speed) / MAX_SPEED), 3, 2);

    drawText(fb, 'FUEL', tx, 52, 2);
    fb.strokeRect(tx - 1, 61, 34, 7, 3);
    const low = e.fuel < FUEL_LOW;
    if (!low || this.frame % 20 < 12) fb.fillRect(tx, 62, Math.ceil((32 * e.fuel) / FUEL_MAX), 5, low ? 3 : 2);
    for (let q = 1; q < 4; q++) fb.setPixel(tx - 1 + q * 8, 68, 3);

    drawText(fb, 'CARS', tx, 74, 2);
    for (let i = 0; i < e.lives; i++) fb.drawSprite(LIFE_ICON, tx + i * 8, 84);

    drawText(fb, 'STAGE', tx, 96, 2);
    drawNumber(fb, e.stage, tx, 105, 3, 2);

    drawText(fb, 'HI', tx, 118, 2);
    drawNumber(fb, this.highScore, tx - 1, 127, 3, 6);
  }

  protected override renderGameOver(fb: FrameBuffer): void {
    this.renderPlay(fb);
    this.drawGameOverCard(fb);
  }
}

export const RETRO_RACER_CARTRIDGE: CartridgeDefinition = {
  id: RETRO_RACER_ID,
  title: 'Retro Racer',
  description: 'Race down a winding road, weave through traffic and grab fuel cans before the tank runs dry.',
  controls: [
    ['D-Pad Left/Right', 'Steer'],
    ['A', 'Accelerate'],
    ['B', 'Brake'],
    ['START', 'Start / pause'],
    ['SELECT', 'Music on/off (title)'],
  ],
  label: {
    background: '#8a1c1c',
    accent: '#f4a259',
    text: '#fdf0d5',
    tagline: 'RACING',
    art: [
      '............................',
      '............................',
      '..........3333333333........',
      '.........311113111113.......',
      '........31111131111113......',
      '....333333333333333333333...',
      '...32222222222222222222223..',
      '..3222222222222222222222223.',
      '..3211222222222222222222113.',
      '..3222222222222222222222223.',
      '..3333333333333333333333333.',
      '....33333.........33333.....',
      '...3300033.......3300033....',
      '...3300033.......3300033....',
      '....33333.........33333.....',
      '............................',
    ],
  },
  create: (services) => new RetroRacerGame(services),
};
