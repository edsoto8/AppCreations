/**
 * Pixel Snake: an original grid snake cartridge with WALLS and WRAP modes.
 * Rules live in {@link PixelSnakeEngine}; this module adds the screens, drawing and sound.
 */
import type { CartridgeDefinition, GameServices, InputFrame } from './GameInterface';
import { SCREEN_WIDTH } from './GameInterface';
import { ArcadeGame } from './common/ArcadeGame';
import type { FrameBuffer } from './common/FrameBuffer';
import { drawNumber, drawText } from './common/PixelFont';
import { drawHighScoreLine, drawPushStart } from './common/ScreenKit';
import { SNAKE_SFX, SNAKE_THEME, SNAKE_TITLE_THEME } from './PixelSnakeAudio';
import {
  BONUS_LIFETIME_TICKS,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  PixelSnakeEngine,
  SNAKE_COLS,
  SNAKE_ROWS,
  type SnakeEvent,
  type SnakeMode,
} from './PixelSnakeEngine';

export const PIXEL_SNAKE_ID = 'pixel-snake';

// ---- Layout & timing --------------------------------------------------------------------------
const CELL = 6;
const FIELD_X = 2;
const FIELD_Y = 15;
const FIELD_W = SNAKE_COLS * CELL;
const FIELD_H = SNAKE_ROWS * CELL;
/** Ticks the dead snake blinks before the score card appears. */
const DEATH_BLINK_TICKS = 50;
const BONUS_WARN_TICKS = 90;

const FOOD_SPRITE = ['..33..', '.3223.', '322223', '322213', '.3223.', '..33..'];
const BONUS_SPRITE = ['3.33.3', '333333', '310013', '310013', '333333', '......'];

const DEATH_REASONS: Readonly<Record<string, string>> = {
  wall: 'HIT THE WALL',
  self: 'TIED IN A KNOT',
  full: 'BOARD FULL!',
};

export class PixelSnakeGame extends ArcadeGame {
  readonly engine: PixelSnakeEngine;

  constructor(services: GameServices) {
    super(services, {
      id: PIXEL_SNAKE_ID,
      title: 'PIXEL SNAKE',
      titleMusic: SNAKE_TITLE_THEME,
      playMusic: SNAKE_THEME,
      sounds: SNAKE_SFX,
      restartDelayTicks: DEATH_BLINK_TICKS + 15,
    });
    this.engine = new PixelSnakeEngine(services.random, (event, value) => this.onEngineEvent(event, value));
  }

  get mode(): SnakeMode {
    return this.engine.mode;
  }

  /** Read-only snapshot for tests and debugging. */
  getDebugState(): { phase: string; mode: SnakeMode; score: number; length: number; dead: boolean; highScore: number } {
    return {
      phase: this.phase,
      mode: this.engine.mode,
      score: this.engine.score,
      length: this.engine.length,
      dead: this.engine.isDead,
      highScore: this.highScore,
    };
  }

  protected onTitleSelect(): void {
    this.engine.mode = this.engine.mode === 'walls' ? 'wrap' : 'walls';
    this.services.sound.sfx(SNAKE_SFX.select);
  }

  protected resetPlay(): void {
    this.engine.reset(this.engine.mode);
  }

  protected updatePlay(input: InputFrame): void {
    this.engine.update(input);
    if (this.engine.isDead) this.endGame(this.engine.score, DEATH_REASONS[this.engine.death] ?? '');
  }

  private onEngineEvent(event: SnakeEvent, _value: number): void {
    const sound = this.services.sound;
    switch (event) {
      case 'turn':
        sound.sfx(SNAKE_SFX.turn);
        break;
      case 'eat':
        sound.sfx(SNAKE_SFX.eat);
        break;
      case 'bonus-appear':
        sound.sfx(SNAKE_SFX.bonusAppear);
        break;
      case 'bonus-eat':
        sound.sfx(SNAKE_SFX.bonusEat);
        break;
      case 'bonus-expire':
        sound.sfx(SNAKE_SFX.bonusExpire);
        break;
      case 'speedup':
        sound.sfx(SNAKE_SFX.speedUp);
        break;
      case 'die':
        sound.sfx(SNAKE_SFX.die);
        break;
      case 'step':
        break;
    }
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  protected renderTitle(fb: FrameBuffer): void {
    const cx = SCREEN_WIDTH / 2;
    fb.strokeRect(0, 0, 160, 144, 3);
    fb.strokeRect(2, 2, 156, 140, 1);
    drawText(fb, 'PIXEL', cx, 8, 3, { align: 'center', scale: 2 });
    drawText(fb, 'SNAKE', cx, 26, 2, { align: 'center', scale: 2 });

    // Flair: a snake slithering along a sine path, chasing a berry.
    const lead = (this.frame * 1.5) % 200;
    fb.drawSprite(FOOD_SPRITE, Math.floor(((lead + 24) % 200) - 20), 61);
    for (let i = 18; i >= 0; i--) {
      const sx = lead - i * 4 - 20;
      const wx = Math.floor(((sx % 200) + 200) % 200) - 20;
      const wy = 62 + Math.round(Math.sin(wx / 14) * 6);
      if (i === 0) {
        fb.fillRect(wx - 1, wy - 1, 7, 7, 3);
        fb.setPixel(wx + 3, wy + 1, 0);
        fb.setPixel(wx + 3, wy + 3, 0);
      } else {
        fb.fillRect(wx, wy, 5, 5, i % 2 === 0 ? 3 : 2);
      }
    }

    const modeText = this.engine.mode === 'walls' ? 'MODE: WALLS' : 'MODE: WRAP ';
    fb.strokeRect(cx - 40, 84, 80, 13, 2);
    drawText(fb, modeText, cx, 87, 3, { align: 'center' });
    drawPushStart(fb, 104, this.frame);
    drawHighScoreLine(fb, this.highScore, 116, 2);
    drawText(fb, 'SELECT: MODE', cx, 129, 2, { align: 'center' });
  }

  protected renderPlay(fb: FrameBuffer): void {
    this.drawHud(fb);
    this.drawField(fb);
    this.drawSnake(fb, true);
  }

  protected override renderGameOver(fb: FrameBuffer): void {
    this.drawHud(fb);
    this.drawField(fb);
    const blinkVisible = Math.floor(this.phaseTicks / 6) % 2 === 0;
    if (this.phaseTicks >= DEATH_BLINK_TICKS || blinkVisible) this.drawSnake(fb, false);
    if (this.phaseTicks >= DEATH_BLINK_TICKS) this.drawGameOverCard(fb);
  }

  private drawHud(fb: FrameBuffer): void {
    const e = this.engine;
    drawText(fb, 'SCORE', 2, 2, 2);
    drawNumber(fb, e.score, 34, 2, 3, 5);
    drawText(fb, e.mode === 'walls' ? 'WALL' : 'WRAP', 78, 2, 1);
    drawText(fb, 'HI', 110, 2, 2);
    drawNumber(fb, this.highScore, 158, 2, 3, 5, { align: 'right' });
    if (e.bonus >= 0) {
      const w = Math.ceil((FIELD_W * e.bonusTimer) / BONUS_LIFETIME_TICKS);
      fb.fillRect(FIELD_X, 11, w, 2, e.bonusTimer < BONUS_WARN_TICKS && this.frame % 8 < 4 ? 1 : 2);
    }
  }

  private drawField(fb: FrameBuffer): void {
    const e = this.engine;
    if (e.mode === 'walls') {
      fb.strokeRect(FIELD_X - 2, FIELD_Y - 2, FIELD_W + 4, FIELD_H + 4, 3);
      fb.strokeRect(FIELD_X - 1, FIELD_Y - 1, FIELD_W + 2, FIELD_H + 2, 3);
    } else {
      // Dashed edge: the snake passes through.
      for (let x = 0; x < FIELD_W + 2; x += 4) {
        fb.hLine(FIELD_X - 1 + x, FIELD_Y - 1, 2, 2);
        fb.hLine(FIELD_X - 1 + x, FIELD_Y + FIELD_H, 2, 2);
      }
      for (let y = 0; y < FIELD_H + 2; y += 4) {
        fb.vLine(FIELD_X - 1, FIELD_Y - 1 + y, 2, 2);
        fb.vLine(FIELD_X + FIELD_W, FIELD_Y - 1 + y, 2, 2);
      }
    }
    for (let y = 0; y < SNAKE_ROWS; y += 2) {
      for (let x = (y / 2) % 2; x < SNAKE_COLS; x += 2) {
        fb.setPixel(FIELD_X + x * CELL + 3, FIELD_Y + y * CELL + 3, 1);
      }
    }
    if (e.food >= 0) {
      const fx = FIELD_X + (e.food % SNAKE_COLS) * CELL;
      const fy = FIELD_Y + Math.floor(e.food / SNAKE_COLS) * CELL;
      fb.drawSprite(FOOD_SPRITE, fx, fy - (this.frame % 40 < 20 ? 0 : 1));
    }
    if (e.bonus >= 0 && (e.bonusTimer >= BONUS_WARN_TICKS || this.frame % 8 < 5)) {
      fb.drawSprite(BONUS_SPRITE, FIELD_X + (e.bonus % SNAKE_COLS) * CELL, FIELD_Y + Math.floor(e.bonus / SNAKE_COLS) * CELL);
    }
  }

  private drawSnake(fb: FrameBuffer, alive: boolean): void {
    const e = this.engine;
    const n = e.length;
    for (let i = n - 1; i >= 0; i--) {
      const x = e.segmentX(i);
      const y = e.segmentY(i);
      const px = FIELD_X + x * CELL;
      const py = FIELD_Y + y * CELL;
      if (i === 0) {
        this.drawHead(fb, px, py, alive);
        continue;
      }
      // Body square plus a bridge toward the segment nearer the head (skipped across a wrap).
      const nx = e.segmentX(i - 1);
      const ny = e.segmentY(i - 1);
      const inset = i === n - 1 ? 2 : 1;
      const size = CELL - inset * 2;
      fb.fillRect(px + inset, py + inset, size, size, 3);
      if (Math.abs(nx - x) + Math.abs(ny - y) === 1) {
        const qx = FIELD_X + nx * CELL;
        const qy = FIELD_Y + ny * CELL;
        fb.fillRect(Math.min(px, qx) + inset, Math.min(py, qy) + inset, Math.abs(px - qx) + size, Math.abs(py - qy) + size, 3);
      }
      if (i % 3 === 1) fb.fillRect(px + 2, py + 2, 2, 2, 1);
    }
  }

  private drawHead(fb: FrameBuffer, px: number, py: number, alive: boolean): void {
    fb.fillRect(px, py, CELL, CELL, 3);
    const d = this.engine.direction;
    // Eye positions: two pixels on the leading half of the head.
    let ex1 = px + 3;
    let ey1 = py + 1;
    let ex2 = px + 3;
    let ey2 = py + 4;
    if (d === DIR_LEFT) {
      ex1 = ex2 = px + 2;
    } else if (d === DIR_UP) {
      ex1 = px + 1;
      ex2 = px + 4;
      ey1 = ey2 = py + 2;
    } else if (d === DIR_DOWN) {
      ex1 = px + 1;
      ex2 = px + 4;
      ey1 = ey2 = py + 3;
    }
    if (alive) {
      fb.setPixel(ex1, ey1, 0);
      fb.setPixel(ex2, ey2, 0);
      if (this.frame % 30 < 6) {
        // Tongue flick.
        const tx = d === DIR_RIGHT ? px + CELL : d === DIR_LEFT ? px - 1 : px + 2;
        const ty = d === DIR_DOWN ? py + CELL : d === DIR_UP ? py - 1 : py + 2;
        fb.setPixel(tx, ty, 2);
        fb.setPixel(tx + (d === DIR_UP || d === DIR_DOWN ? 1 : 0), ty + (d === DIR_UP || d === DIR_DOWN ? 0 : 1), 2);
      }
    } else {
      fb.setPixel(ex1, ey1, 1);
      fb.setPixel(ex2, ey2, 1);
      fb.setPixel(px + 2, py + 2, 1);
      fb.setPixel(px + 3, py + 3, 1);
    }
  }
}

export const PIXEL_SNAKE_CARTRIDGE: CartridgeDefinition = {
  id: PIXEL_SNAKE_ID,
  title: 'Pixel Snake',
  description: 'Guide a hungry snake around the field, grow with every berry and grab the bonus crowns before they vanish.',
  controls: [
    ['D-Pad', 'Steer'],
    ['A (hold)', 'Dash'],
    ['START', 'Start / pause'],
    ['SELECT', 'Walls / wrap mode (title)'],
  ],
  label: {
    background: '#2f6b3a',
    accent: '#c7e86b',
    text: '#fff6d8',
    tagline: 'ARCADE',
    art: [
      '........................',
      '...............3333.....',
      '..............311113....',
      '.............31101103...',
      '.............31111113...',
      '..............311113.2..',
      '...33333.......3113.2...',
      '..3111113......3113.....',
      '.311333113....31113.....',
      '.3113...3113..3113......',
      '.3113....311331113......',
      '.31113....3111113.......',
      '..31113....33333........',
      '...311113...............',
      '....33333...............',
      '........................',
    ],
  },
  create: (services) => new PixelSnakeGame(services),
};
