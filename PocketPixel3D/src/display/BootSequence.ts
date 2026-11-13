import { drawText } from '../games/common/PixelFont';
import type { FrameBuffer } from '../games/common/FrameBuffer';
import type { SfxSpec, Shade } from '../games/GameInterface';

/** Original boot animation for the console, drawn into the framebuffer. Tick-driven (60 Hz). */
export const BOOT_TIMING = {
  /** Blank LCD while it "warms up". */
  blank: 12,
  /** Logo slides down from above the screen. */
  dropEnd: 96,
  /** Chime fires as the logo lands; sparkles play. */
  sparkleEnd: 150,
  /** Logo fades out through the shades. */
  fadeEnd: 186,
} as const;

/** The boot chime: a rising two-voice arpeggio (original). */
export const BOOT_CHIME: readonly SfxSpec[] = [
  { wave: 'pulse25', duration: 0.62, freq: [1046.5, 1568, 2093], stepDuration: 0.09, volume: 0.42, release: 0.4 },
  { wave: 'triangle', duration: 0.62, freq: [523.25, 784, 1046.5], stepDuration: 0.09, volume: 0.5, release: 0.4 },
];

const LOGO_Y = 52;

/** A small original emblem: a pixel "P" inside a rounded screen. */
const EMBLEM = [
  '..33333333333..',
  '.3...........3.',
  '3..222222.....3',
  '3..2.....2....3',
  '3..2.....2....3',
  '3..222222.....3',
  '3..2..........3',
  '3..2.....11...3',
  '3..2.....11...3',
  '.3...........3.',
  '..33333333333..',
];

const SPARKLE_POINTS: readonly (readonly [number, number, number])[] = [
  [24, 44, 0],
  [134, 46, 6],
  [40, 82, 12],
  [120, 80, 18],
  [80, 36, 24],
  [16, 66, 30],
  [146, 64, 36],
];

export type BootPhase = 'blank' | 'drop' | 'sparkle' | 'fade' | 'done';

export class BootSequence {
  private tickCount = 0;
  private chimed = false;

  constructor(
    private readonly hasCartridge: boolean,
    private readonly onChime: () => void,
  ) {}

  get ticks(): number {
    return this.tickCount;
  }

  get phase(): BootPhase {
    const t = this.tickCount;
    if (t < BOOT_TIMING.blank) return 'blank';
    if (t < BOOT_TIMING.dropEnd) return 'drop';
    if (t < BOOT_TIMING.sparkleEnd) return 'sparkle';
    if (t < BOOT_TIMING.fadeEnd || !this.hasCartridge) return 'fade';
    return 'done';
  }

  /** True once the boot has finished and the cartridge should take over. Never true without a cartridge. */
  get finished(): boolean {
    return this.hasCartridge && this.tickCount >= BOOT_TIMING.fadeEnd;
  }

  tick(): void {
    this.tickCount++;
    if (!this.chimed && this.tickCount >= BOOT_TIMING.dropEnd) {
      this.chimed = true;
      if (this.hasCartridge) this.onChime();
    }
  }

  render(fb: FrameBuffer): void {
    fb.clear(0);
    const t = this.tickCount;
    if (t < BOOT_TIMING.blank) return;

    // Logo position: ease-out drop from above the screen.
    const dropT = Math.min(1, (t - BOOT_TIMING.blank) / (BOOT_TIMING.dropEnd - BOOT_TIMING.blank));
    const eased = 1 - (1 - dropT) ** 2;
    const y = Math.round(-40 + (LOGO_Y + 40) * eased);

    // Fade: shade 3 → 2 → 1 → 0 over the fade window (only when a cartridge will take over).
    let ink: Shade = 3;
    if (this.hasCartridge && t >= BOOT_TIMING.sparkleEnd) {
      const f = (t - BOOT_TIMING.sparkleEnd) / (BOOT_TIMING.fadeEnd - BOOT_TIMING.sparkleEnd);
      ink = (f < 0.33 ? 2 : f < 0.66 ? 1 : 0) as Shade;
    }
    if (ink === 0) return;

    drawLogo(fb, y, ink);

    if (!this.hasCartridge) {
      if (t >= BOOT_TIMING.dropEnd) {
        // Blink "NO CARTRIDGE" forever; there is nothing to run.
        if (((t - BOOT_TIMING.dropEnd) >> 5) % 2 === 0) {
          drawText(fb, 'NO CARTRIDGE', 80, 104, 3, { align: 'center' });
        }
        drawText(fb, 'POWER OFF AND', 80, 118, 2, { align: 'center' });
        drawText(fb, 'INSERT A GAME', 80, 128, 2, { align: 'center' });
      }
      return;
    }

    if (t >= BOOT_TIMING.dropEnd && t < BOOT_TIMING.sparkleEnd) {
      const local = t - BOOT_TIMING.dropEnd;
      for (const [sx, sy, delay] of SPARKLE_POINTS) {
        const age = local - delay;
        if (age < 0 || age > 18) continue;
        const r = age < 6 ? 1 : age < 12 ? 2 : 1;
        const shade: Shade = age < 12 ? 3 : 2;
        fb.setPixel(sx, sy, shade);
        fb.setPixel(sx - r, sy, shade);
        fb.setPixel(sx + r, sy, shade);
        fb.setPixel(sx, sy - r, shade);
        fb.setPixel(sx, sy + r, shade);
      }
    }
  }
}

function drawLogo(fb: FrameBuffer, y: number, ink: Shade): void {
  // Emblem left of the wordmark; remap its shades so the whole logo fades together.
  const emblemX = 30;
  for (let r = 0; r < EMBLEM.length; r++) {
    const row = EMBLEM[r] ?? '';
    for (let c = 0; c < row.length; c++) {
      const s = row.charCodeAt(c) - 48;
      if (s < 1 || s > 3) continue;
      const shade = Math.max(1, Math.min(ink, s)) as Shade;
      fb.setPixel(emblemX + c, y + 2 + r, shade);
    }
  }
  drawText(fb, 'POCKET', 52, y, ink, { scale: 2 });
  drawText(fb, 'PIXEL', 58, y + 16, ink, { scale: 2 });
  if (y > 0) fb.hLine(30, y + 33, 100, Math.max(1, ink - 1) as Shade);
}
