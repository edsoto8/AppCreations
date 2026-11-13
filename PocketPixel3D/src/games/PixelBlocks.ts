/**
 * Pixel Blocks: an original falling-block puzzle cartridge.
 * Rules live in {@link PixelBlocksEngine}; this module adds the screens, drawing and sound.
 */
import type { CartridgeDefinition, GameServices, InputFrame, Shade } from './GameInterface';
import { SCREEN_WIDTH } from './GameInterface';
import { ArcadeGame } from './common/ArcadeGame';
import type { FrameBuffer } from './common/FrameBuffer';
import { drawNumber, drawText } from './common/PixelFont';
import { drawHighScoreLine, drawPushStart } from './common/ScreenKit';
import { BLOCKS_SFX, BLOCKS_THEME, BLOCKS_TITLE_THEME } from './PixelBlocksAudio';
import {
  BOARD_COLS,
  BOARD_ROWS,
  HIDDEN_ROWS,
  type BlocksEvent,
  PixelBlocksEngine,
  pieceCellX,
  pieceCellY,
  VISIBLE_ROWS,
} from './PixelBlocksEngine';

export const PIXEL_BLOCKS_ID = 'pixel-blocks';

// ---- Layout ---------------------------------------------------------------------------------
const CELL = 8;
const BOARD_X = 8;
const BOARD_Y = 0;
const BOARD_W = BOARD_COLS * CELL;
const RIGHT_WALL_X = BOARD_X + BOARD_W;
const PANEL_X = RIGHT_WALL_X + 6;
const TEXT_X = PANEL_X + 4;
const NEXT_BOX_Y = 80;
/** Ticks the game-over animation takes to fill the well before the score card appears. */
const GAME_OVER_FILL_TICKS = VISIBLE_ROWS * 2;
const CLEAR_FLASH_PERIOD = 4;
/** Title-screen pile of cells: digits are piece ids, '.' is empty. */
const TITLE_STACK: readonly string[] = ['1133.66677', '41135566.7', '4413255527'];

// ---- Cell art: one 8x8 pattern per piece so shapes differ without colour ------------------------
const CELL_PATTERNS: readonly Uint8Array[] = buildCellPatterns();

function buildCellPatterns(): Uint8Array[] {
  const patterns: Uint8Array[] = [new Uint8Array(64)];
  const interiors: ((x: number, y: number) => Shade)[] = [
    (x, y) => (x === 1 || y === 1 ? 1 : 3), // I: dark with a bevel
    (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? 0 : x >= 2 && x <= 5 && y >= 2 && y <= 5 ? 3 : 1), // O: rings
    () => 2, // T: solid mid-tone
    (x, y) => (((x + y) & 1) === 0 ? 2 : 1), // S: fine checker
    (x, y) => ((x + y) % 4 < 2 ? 2 : 0), // Z: diagonal stripes
    (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? 3 : 0), // J: hollow with a dot
    (x, y) => (x === 1 || y === 1 ? 0 : 1), // L: light with a highlight
  ];
  for (const interior of interiors) {
    const p = new Uint8Array(64);
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const edge = x === 0 || y === 0 || x === CELL - 1 || y === CELL - 1;
        p[y * CELL + x] = edge ? 3 : interior(x, y);
      }
    }
    patterns.push(p);
  }
  return patterns;
}

function drawCell(fb: FrameBuffer, type: number, px: number, py: number): void {
  const p = CELL_PATTERNS[type];
  if (!p) return;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) fb.setPixel(px + x, py + y, (p[y * CELL + x] ?? 0) as Shade);
  }
}

function drawBrickWall(fb: FrameBuffer, x: number, w: number): void {
  fb.fillRect(x, 0, w, 144, 2);
  for (let y = 0; y < 144; y += 4) {
    fb.hLine(x, y, w, 3);
    const offset = (y / 4) % 2 === 0 ? 0 : 3;
    for (let bx = x + offset; bx < x + w; bx += 6) fb.vLine(bx, y, 4, 3);
  }
}

export class PixelBlocksGame extends ArcadeGame {
  readonly engine: PixelBlocksEngine;

  constructor(services: GameServices) {
    super(services, {
      id: PIXEL_BLOCKS_ID,
      title: 'PIXEL BLOCKS',
      titleMusic: BLOCKS_TITLE_THEME,
      playMusic: BLOCKS_THEME,
      sounds: BLOCKS_SFX,
      restartDelayTicks: GAME_OVER_FILL_TICKS + 20,
    });
    this.engine = new PixelBlocksEngine(services.random, (event, value) => this.onEngineEvent(event, value));
  }

  /** Read-only snapshot for tests and debugging. */
  getDebugState(): {
    phase: string;
    score: number;
    lines: number;
    level: number;
    state: string;
    musicEnabled: boolean;
    highScore: number;
  } {
    return {
      phase: this.phase,
      score: this.engine.score,
      lines: this.engine.lines,
      level: this.engine.level,
      state: this.engine.state,
      musicEnabled: this.musicEnabled,
      highScore: this.highScore,
    };
  }

  protected onTitleSelect(): void {
    this.toggleMusic();
  }

  protected resetPlay(): void {
    this.engine.reset();
  }

  protected updatePlay(input: InputFrame): void {
    this.engine.update(input);
    if (this.engine.isOver) this.endGame(this.engine.score);
  }

  private onEngineEvent(event: BlocksEvent, value: number): void {
    const sound = this.services.sound;
    switch (event) {
      case 'move':
        sound.sfx(BLOCKS_SFX.move);
        break;
      case 'rotate':
        sound.sfx(BLOCKS_SFX.rotate);
        break;
      case 'harddrop':
        sound.sfx(BLOCKS_SFX.hardDrop);
        break;
      case 'lock':
        sound.sfx(BLOCKS_SFX.lock);
        break;
      case 'clear':
        sound.sfx(value >= 4 ? BLOCKS_SFX.bigClear : BLOCKS_SFX.clear);
        break;
      case 'levelup':
        sound.sfx(BLOCKS_SFX.levelUp);
        break;
      case 'spawn':
      case 'gameover':
        break;
    }
  }

  // ---- Drawing -----------------------------------------------------------------------------------
  protected renderTitle(fb: FrameBuffer): void {
    const cx = SCREEN_WIDTH / 2;
    drawBrickWall(fb, 0, 8);
    drawBrickWall(fb, SCREEN_WIDTH - 8, 8);
    drawText(fb, 'PIXEL', cx, 8, 3, { align: 'center', scale: 2 });
    drawText(fb, 'BLOCKS', cx, 26, 2, { align: 'center', scale: 2 });

    // Flair: a little well with a piece drifting down onto it.
    const artX = cx - 40;
    const stackTop = 78;
    for (let r = 0; r < TITLE_STACK.length; r++) {
      const row = TITLE_STACK[r] ?? '';
      for (let c = 0; c < row.length; c++) {
        const t = row.charCodeAt(c) - 48;
        if (t >= 1 && t <= 7) drawCell(fb, t, artX + c * CELL, stackTop + (r - 2) * CELL + 8);
      }
    }
    const fall = Math.floor(this.frame / 6) % 14;
    for (let i = 0; i < 4; i++) {
      const px = artX + (4 + pieceCellX(3, 2, i)) * CELL;
      const py = 36 + Math.min(fall, 9) + pieceCellY(3, 2, i) * CELL;
      drawCell(fb, 3, px, py);
    }

    drawPushStart(fb, 104, this.frame);
    drawHighScoreLine(fb, this.highScore, 116, 2);
    drawText(fb, this.musicEnabled ? 'SELECT:MUSIC ON' : 'SELECT:MUSIC OFF', cx, 130, 3, { align: 'center' });
  }

  protected renderPlay(fb: FrameBuffer): void {
    this.drawFrameAndPanel(fb);
    this.drawWell(fb);
    const e = this.engine;
    if (e.state === 'falling' && e.currentType !== 0) {
      const ghostY = e.dropY();
      if (ghostY !== e.currentY) this.drawPieceOutline(fb, e.currentType, e.currentRotation, e.currentX, ghostY);
      this.drawPiece(fb, e.currentType, e.currentRotation, e.currentX, e.currentY);
    }
  }

  protected override renderGameOver(fb: FrameBuffer): void {
    this.drawFrameAndPanel(fb);
    this.drawWell(fb);
    // Fill the well from the bottom with a curtain, then show the score card.
    const rows = Math.min(VISIBLE_ROWS, Math.floor(this.phaseTicks / 2));
    for (let r = 0; r < rows; r++) {
      const y = BOARD_Y + (VISIBLE_ROWS - 1 - r) * CELL;
      fb.fillRect(BOARD_X, y, BOARD_W, CELL, 2);
      fb.hLine(BOARD_X, y, BOARD_W, 3);
      fb.hLine(BOARD_X, y + 4, BOARD_W, 1);
    }
    if (this.phaseTicks >= GAME_OVER_FILL_TICKS) this.drawGameOverCard(fb);
  }

  private drawFrameAndPanel(fb: FrameBuffer): void {
    drawBrickWall(fb, 0, BOARD_X);
    drawBrickWall(fb, RIGHT_WALL_X, PANEL_X - RIGHT_WALL_X);
    const e = this.engine;
    drawText(fb, 'SCORE', TEXT_X, 4, 2);
    drawNumber(fb, e.score, TEXT_X, 13, 3, 6);
    drawText(fb, 'LEVEL', TEXT_X, 26, 2);
    drawNumber(fb, e.level, TEXT_X, 35, 3, 2);
    drawText(fb, 'LINES', TEXT_X, 48, 2);
    drawNumber(fb, e.lines, TEXT_X, 57, 3, 3);
    drawText(fb, 'NEXT', TEXT_X, 70, 2);
    fb.strokeRect(TEXT_X - 2, NEXT_BOX_Y, 44, 28, 3);
    this.drawNextPreview(fb, TEXT_X - 2 + 22, NEXT_BOX_Y + 14);
    drawText(fb, 'HI', TEXT_X, 118, 2);
    drawNumber(fb, this.highScore, TEXT_X, 127, 3, 6);
  }

  private drawWell(fb: FrameBuffer): void {
    const e = this.engine;
    // Faint dot grid so empty space reads as a well.
    for (let r = 0; r < VISIBLE_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) fb.setPixel(BOARD_X + c * CELL + 4, BOARD_Y + r * CELL + 4, 1);
    }
    const flashOn = e.state === 'clearing' && Math.floor(e.clearTimer / CLEAR_FLASH_PERIOD) % 2 === 0;
    for (let y = HIDDEN_ROWS; y < BOARD_ROWS; y++) {
      const py = BOARD_Y + (y - HIDDEN_ROWS) * CELL;
      if (e.state === 'clearing' && this.isClearingRow(y)) {
        fb.fillRect(BOARD_X, py, BOARD_W, CELL, flashOn ? 3 : 0);
        if (!flashOn) fb.hLine(BOARD_X, py + 3, BOARD_W, 1);
        continue;
      }
      for (let x = 0; x < BOARD_COLS; x++) {
        const t = e.getCell(x, y);
        if (t !== 0) drawCell(fb, t, BOARD_X + x * CELL, py);
      }
    }
  }

  private isClearingRow(y: number): boolean {
    const e = this.engine;
    for (let i = 0; i < e.clearCount; i++) if (e.clearingRows[i] === y) return true;
    return false;
  }

  private drawPiece(fb: FrameBuffer, type: number, rot: number, x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      const by = y + pieceCellY(type, rot, i);
      if (by < HIDDEN_ROWS) continue;
      drawCell(fb, type, BOARD_X + (x + pieceCellX(type, rot, i)) * CELL, BOARD_Y + (by - HIDDEN_ROWS) * CELL);
    }
  }

  private drawPieceOutline(fb: FrameBuffer, type: number, rot: number, x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      const by = y + pieceCellY(type, rot, i);
      if (by < HIDDEN_ROWS) continue;
      const px = BOARD_X + (x + pieceCellX(type, rot, i)) * CELL;
      const py = BOARD_Y + (by - HIDDEN_ROWS) * CELL;
      fb.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2, 1);
    }
  }

  private drawNextPreview(fb: FrameBuffer, centerX: number, centerY: number): void {
    const type = this.engine.nextPiece;
    if (type === 0) return;
    let minX = 9;
    let maxX = -1;
    let minY = 9;
    let maxY = -1;
    for (let i = 0; i < 4; i++) {
      const cx = pieceCellX(type, 0, i);
      const cy = pieceCellY(type, 0, i);
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }
    const left = centerX - Math.floor(((maxX - minX + 1) * CELL) / 2);
    const top = centerY - Math.floor(((maxY - minY + 1) * CELL) / 2);
    for (let i = 0; i < 4; i++) {
      drawCell(fb, type, left + (pieceCellX(type, 0, i) - minX) * CELL, top + (pieceCellY(type, 0, i) - minY) * CELL);
    }
  }
}

export const PIXEL_BLOCKS_CARTRIDGE: CartridgeDefinition = {
  id: PIXEL_BLOCKS_ID,
  title: 'Pixel Blocks',
  description: 'Steer falling four-cell blocks into solid rows. Clear lines to level up before the well fills.',
  controls: [
    ['D-Pad Left/Right', 'Move (hold to repeat)'],
    ['D-Pad Down', 'Soft drop'],
    ['D-Pad Up', 'Hard drop'],
    ['A', 'Rotate clockwise'],
    ['B', 'Rotate counter-clockwise'],
    ['START', 'Start / pause'],
    ['SELECT', 'Music on/off (title)'],
  ],
  label: {
    background: '#2b3a67',
    accent: '#f2c14e',
    text: '#f7f4ea',
    tagline: 'PUZZLE',
    art: [
      '........................',
      '..........3333..........',
      '..........3113..........',
      '..........3113..........',
      '......33333333..........',
      '......31133113..........',
      '......31133113..........',
      '......33333333..........',
      '........................',
      '3333....33333333....3333',
      '3223....32233223....3223',
      '3223....32233223....3223',
      '333333333333333333333333',
      '311332233113311332233113',
      '311332233113311332233113',
      '333333333333333333333333',
    ],
  },
  create: (services) => new PixelBlocksGame(services),
};
