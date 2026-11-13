import { SCREEN_HEIGHT, SCREEN_WIDTH, type Shade } from '../GameInterface';

/**
 * A 160x144 buffer of shade indices (0 = lightest .. 3 = darkest), row-major.
 * All drawing clips to the screen, so callers can draw partly off-screen sprites safely.
 */
export class FrameBuffer {
  readonly width = SCREEN_WIDTH;
  readonly height = SCREEN_HEIGHT;
  readonly data = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);

  clear(shade: Shade = 0): void {
    this.data.fill(shade);
  }

  setPixel(x: number, y: number, shade: Shade): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = shade;
  }

  getPixel(x: number, y: number): Shade {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return (this.data[y * this.width + x] ?? 0) as Shade;
  }

  fillRect(x: number, y: number, w: number, h: number, shade: Shade): void {
    let x0 = x | 0;
    let y0 = y | 0;
    let x1 = (x + w) | 0;
    let y1 = (y + h) | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.width) x1 = this.width;
    if (y1 > this.height) y1 = this.height;
    for (let yy = y0; yy < y1; yy++) {
      this.data.fill(shade, yy * this.width + x0, yy * this.width + x1);
    }
  }

  /** 1-pixel outline. */
  strokeRect(x: number, y: number, w: number, h: number, shade: Shade): void {
    this.hLine(x, y, w, shade);
    this.hLine(x, y + h - 1, w, shade);
    this.vLine(x, y, h, shade);
    this.vLine(x + w - 1, y, h, shade);
  }

  hLine(x: number, y: number, length: number, shade: Shade): void {
    this.fillRect(x, y, length, 1, shade);
  }

  vLine(x: number, y: number, length: number, shade: Shade): void {
    this.fillRect(x, y, 1, length, shade);
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, shade: Shade): void {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.setPixel(x0, y0, shade);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /**
   * Draws pixel art. Each row is a string; '0'-'3' are shades, any other character (e.g. '.') is
   * transparent. `flipX`/`flipY` mirror the sprite.
   */
  drawSprite(rows: readonly string[], x: number, y: number, flipX = false, flipY = false): void {
    const h = rows.length;
    for (let r = 0; r < h; r++) {
      const row = rows[flipY ? h - 1 - r : r] ?? '';
      const w = row.length;
      for (let c = 0; c < w; c++) {
        const code = row.charCodeAt(flipX ? w - 1 - c : c) - 48; // '0'
        if (code >= 0 && code <= 3) this.setPixel(x + c, y + r, code as Shade);
      }
    }
  }

  /** Copies another buffer's contents into this one. */
  copyFrom(other: FrameBuffer): void {
    this.data.set(other.data);
  }
}
