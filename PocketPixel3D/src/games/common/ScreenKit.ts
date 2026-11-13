/** Shared screen pieces: panels, blinking prompts, pause and game-over overlays. */
import type { Shade } from '../GameInterface';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../GameInterface';
import type { FrameBuffer } from './FrameBuffer';
import { drawNumber, drawText, LINE_HEIGHT } from './PixelFont';

/** Ticks per blink half-cycle for prompts like "PUSH START". */
export const BLINK_HALF_PERIOD = 24;

export function isBlinkOn(frame: number, halfPeriod = BLINK_HALF_PERIOD): boolean {
  return Math.floor(frame / halfPeriod) % 2 === 0;
}

/** Light panel with a dark double border. */
export function drawPanel(fb: FrameBuffer, x: number, y: number, w: number, h: number): void {
  fb.fillRect(x, y, w, h, 0);
  fb.strokeRect(x, y, w, h, 3);
  fb.strokeRect(x + 2, y + 2, w - 4, h - 4, 2);
}

/** Two-shade checkerboard fill. */
export function drawDither(fb: FrameBuffer, x: number, y: number, w: number, h: number, a: Shade, b: Shade): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      fb.setPixel(x + xx, y + yy, ((xx + yy) & 1) === 0 ? a : b);
    }
  }
}

/** Blinking "PUSH START" centred at `y`. */
export function drawPushStart(fb: FrameBuffer, y: number, frame: number): void {
  if (isBlinkOn(frame)) drawText(fb, 'PUSH START', SCREEN_WIDTH / 2, y, 3, { align: 'center' });
}

/** "HI 001234" centred at `y`. */
export function drawHighScoreLine(fb: FrameBuffer, high: number, y: number, shade: Shade = 3): void {
  const left = SCREEN_WIDTH / 2 - 26; // "HI" + gap + 6 digits = 53 px
  drawText(fb, 'HI', left, y, shade);
  drawNumber(fb, high, left + 18, y, shade, 6);
}

/** Full-screen pause card; the play field is deliberately hidden. */
export function drawPausedScreen(fb: FrameBuffer, title: string, frame: number): void {
  drawDither(fb, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 0, 1);
  drawPanel(fb, 24, 44, 112, 56);
  drawText(fb, title, SCREEN_WIDTH / 2, 52, 2, { align: 'center' });
  drawText(fb, 'PAUSED', SCREEN_WIDTH / 2, 64, 3, { align: 'center', scale: 2 });
  if (isBlinkOn(frame)) drawText(fb, 'START: RESUME', SCREEN_WIDTH / 2, 86, 3, { align: 'center' });
}

export interface GameOverInfo {
  readonly score: number;
  readonly highScore: number;
  readonly isNewHighScore: boolean;
  /** Ticks since the game ended (drives the blinking and the restart prompt). */
  readonly ticks: number;
  /** Whether START is accepted yet. */
  readonly canRestart: boolean;
  /** Optional reason line, e.g. "OUT OF FUEL". */
  readonly reason?: string;
}

/** Centred game-over card with score, high score, "NEW HIGH SCORE!" and restart prompt. */
export function drawGameOverPanel(fb: FrameBuffer, info: GameOverInfo): void {
  const x = 16;
  const y = 30;
  const w = SCREEN_WIDTH - 32;
  const h = 88;
  drawPanel(fb, x, y, w, h);
  const cx = SCREEN_WIDTH / 2;
  let ty = y + 7;
  drawText(fb, 'GAME OVER', cx, ty, 3, { align: 'center', scale: 2 });
  ty += 18;
  if (info.reason) drawText(fb, info.reason, cx, ty, 2, { align: 'center' });
  ty += LINE_HEIGHT + 2;
  drawText(fb, 'SCORE', x + 10, ty, 3);
  drawNumber(fb, info.score, x + w - 10, ty, 3, 6, { align: 'right' });
  ty += LINE_HEIGHT + 1;
  drawText(fb, 'BEST', x + 10, ty, 2);
  drawNumber(fb, info.highScore, x + w - 10, ty, 2, 6, { align: 'right' });
  ty += LINE_HEIGHT + 3;
  if (info.isNewHighScore && isBlinkOn(info.ticks, 8)) {
    drawText(fb, 'NEW HIGH SCORE!', cx, ty, 3, { align: 'center' });
  }
  ty += LINE_HEIGHT + 2;
  if (info.canRestart && isBlinkOn(info.ticks)) {
    drawText(fb, 'START: RETRY', cx, ty, 3, { align: 'center' });
  }
}
