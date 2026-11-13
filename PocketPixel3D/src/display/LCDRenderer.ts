import { clamp, lerp } from '../animation/Tween';
import type { FrameBuffer } from '../games/common/FrameBuffer';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../games/GameInterface';

type Rgb = readonly [number, number, number];

/** Four-shade green palette, lightest → darkest (original tuning). */
export const LCD_PALETTE: readonly Rgb[] = [
  [172, 192, 70],
  [124, 152, 54],
  [58, 94, 52],
  [20, 50, 32],
];
/** Colour of the unpowered LCD. */
export const LCD_OFF: Rgb = [128, 136, 96];

export interface LCDOptions {
  ghosting: boolean;
  pixelGrid: boolean;
}

/** Upscale factor of the canvas used as the 3D screen texture. */
export const SCREEN_TEXTURE_SCALE = 4;

/**
 * Converts the console framebuffer (shade indices) into LCD pixels:
 * contrast-dependent palette, slow LCD response (ghosting), power fade and an optional pixel grid.
 *
 * Outputs two canvases that both derive from the same framebuffer:
 * - `lcdCanvas` 160×144, used by the enlarged 2D display;
 * - `screenCanvas` 640×576 with the pixel grid baked in, used as the 3D screen texture.
 */
export class LCDRenderer {
  readonly lcdCanvas: HTMLCanvasElement;
  readonly screenCanvas: HTMLCanvasElement;
  readonly options: LCDOptions = { ghosting: true, pixelGrid: true };

  private readonly lcdCtx: CanvasRenderingContext2D;
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly intensity = new Float32Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  private readonly lut = new Uint8ClampedArray(256 * 3);
  private readonly grid: HTMLCanvasElement;
  private readonly bg: [number, number, number] = [0, 0, 0];
  private lutContrast = -1;
  private lutPower = -1;
  private settled = false;
  private version = 0;

  constructor() {
    this.lcdCanvas = createCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.screenCanvas = createCanvas(SCREEN_WIDTH * SCREEN_TEXTURE_SCALE, SCREEN_HEIGHT * SCREEN_TEXTURE_SCALE);
    this.lcdCtx = get2d(this.lcdCanvas);
    this.screenCtx = get2d(this.screenCanvas);
    this.screenCtx.imageSmoothingEnabled = false;
    this.image = this.lcdCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.grid = buildGrid(this.screenCanvas.width, this.screenCanvas.height, SCREEN_TEXTURE_SCALE);
  }

  /** Incremented whenever the canvases change, so consumers know to re-upload. */
  get frameVersion(): number {
    return this.version;
  }

  setOption<K extends keyof LCDOptions>(key: K, value: LCDOptions[K]): void {
    this.options[key] = value;
    this.settled = false;
  }

  /**
   * @param power 0 (off) .. 1 (fully on); animate it for fade in/out.
   * @param contrast 0..1 from the contrast wheel.
   */
  render(fb: FrameBuffer, dt: number, power: number, contrast: number): void {
    if (power !== this.lutPower || contrast !== this.lutContrast) {
      this.buildLut(power, contrast);
      this.settled = false;
    }
    // LCD response: exponential approach to the target shade, frame-rate independent.
    const k = this.options.ghosting ? 1 - Math.pow(0.42, dt * 60) : 1;
    const src = fb.data;
    const inten = this.intensity;
    const data = this.image.data;
    const lut = this.lut;
    let changed = !this.settled;
    for (let i = 0, n = inten.length; i < n; i++) {
      const target = (src[i] ?? 0) * 85;
      let v = inten[i] ?? 0;
      const diff = target - v;
      if (diff !== 0) {
        v = Math.abs(diff) < 1.5 ? target : v + diff * k;
        inten[i] = v;
        changed = true;
      }
      const li = (v | 0) * 3;
      const o = i * 4;
      data[o] = lut[li] ?? 0;
      data[o + 1] = lut[li + 1] ?? 0;
      data[o + 2] = lut[li + 2] ?? 0;
      data[o + 3] = 255;
    }
    if (!changed) return;
    this.settled = true;
    this.lcdCtx.putImageData(this.image, 0, 0);
    const w = this.screenCanvas.width;
    const h = this.screenCanvas.height;
    this.screenCtx.drawImage(this.lcdCanvas, 0, 0, w, h);
    if (this.options.pixelGrid && power > 0.01) {
      this.screenCtx.globalAlpha = 0.55 * power;
      this.screenCtx.drawImage(this.grid, 0, 0);
      this.screenCtx.globalAlpha = 1;
    }
    this.version++;
  }

  /** Current colour of the lightest shade (used for the LCD border so it matches the pixels). */
  backgroundRgb(): readonly [number, number, number] {
    this.bg[0] = this.lut[0] ?? 0;
    this.bg[1] = this.lut[1] ?? 0;
    this.bg[2] = this.lut[2] ?? 0;
    return this.bg;
  }

  /** Mean shade intensity 0..255 (tests use this to tell a blank screen from content). */
  averageIntensity(): number {
    let sum = 0;
    for (let i = 0; i < this.intensity.length; i++) sum += this.intensity[i] ?? 0;
    return sum / this.intensity.length;
  }

  private buildLut(power: number, contrast: number): void {
    this.lutPower = power;
    this.lutContrast = contrast;
    const gain = 0.55 + contrast * 0.9;
    const bias = (contrast - 0.5) * 0.3;
    for (let i = 0; i < 256; i++) {
      const ink = clamp((i / 255) * gain + bias, 0, 1) * 3;
      const lo = Math.min(2, Math.floor(ink));
      const t = ink - lo;
      const a = LCD_PALETTE[lo] ?? LCD_PALETTE[0]!;
      const b = LCD_PALETTE[lo + 1] ?? a;
      for (let c = 0; c < 3; c++) {
        const lit = lerp(a[c]!, b[c]!, t);
        this.lut[i * 3 + c] = lerp(LCD_OFF[c]!, lit, power);
      }
    }
  }
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

/** Faint gaps between LCD pixels plus a subtle per-pixel shadow, drawn once. */
function buildGrid(w: number, h: number, scale: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const ctx = get2d(c);
  ctx.fillStyle = 'rgba(40, 60, 20, 0.35)';
  for (let x = 0; x < w; x += scale) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += scale) ctx.fillRect(0, y, w, 1);
  return c;
}
