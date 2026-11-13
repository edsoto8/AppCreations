import { describe, expect, it } from 'vitest';
import { AutoRepeat, DirectionalRepeat } from '../../../src/games/common/AutoRepeat';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import {
  drawNumber,
  drawText,
  GLYPH_HEIGHT,
  hasGlyph,
  LINE_HEIGHT,
  measureText,
} from '../../../src/games/common/PixelFont';
import { createRng, randomInt, shuffleInPlace } from '../../../src/games/common/Rng';
import { formatScore } from '../../../src/games/common/ScoreFormat';
import { countShade } from './helpers';

function inkBounds(fb: FrameBuffer): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = 999;
  let maxX = -1;
  let minY = 999;
  let maxY = -1;
  for (let y = 0; y < fb.height; y++) {
    for (let x = 0; x < fb.width; x++) {
      if (fb.getPixel(x, y) !== 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

describe('PixelFont', () => {
  it('measures single and multi-line text', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB')).toBe(11);
    expect(measureText('AB', 2)).toBe(22);
    expect(measureText('HI\nSCORE\nA')).toBe(measureText('SCORE'));
    expect(measureText('score')).toBe(measureText('SCORE'));
  });

  it('exposes glyph metrics', () => {
    expect(GLYPH_HEIGHT).toBe(7);
    expect(LINE_HEIGHT).toBeGreaterThan(GLYPH_HEIGHT);
  });

  it('has glyphs for every required character', () => {
    const required = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:!?-+/\'"()#%*<>=';
    for (const ch of required) expect(hasGlyph(ch), ch).toBe(true);
    expect(hasGlyph('q')).toBe(true);
  });

  it('draws within the measured box for each alignment', () => {
    const text = 'PIXEL 42!';
    const width = measureText(text);
    for (const [align, x, left] of [
      ['left', 10, 10],
      ['center', 80, 80 - Math.floor(width / 2)],
      ['right', 150, 150 - width],
    ] as const) {
      const fb = new FrameBuffer();
      drawText(fb, text, x, 20, 3, { align });
      const b = inkBounds(fb);
      expect(b.minX, align).toBeGreaterThanOrEqual(left);
      expect(b.maxX, align).toBeLessThan(left + width);
      expect(b.minY).toBeGreaterThanOrEqual(20);
      expect(b.maxY).toBeLessThan(20 + GLYPH_HEIGHT);
    }
  });

  it('scales pixels and starts new lines on \\n', () => {
    const fb = new FrameBuffer();
    drawText(fb, 'I', 0, 0, 2, { scale: 3 });
    const single = new FrameBuffer();
    drawText(single, 'I', 0, 0, 2);
    expect(countShade(fb, 2)).toBe(countShade(single, 2) * 9);

    const lines = new FrameBuffer();
    drawText(lines, 'A\nB', 0, 0, 3);
    expect(inkBounds(lines).maxY).toBeGreaterThanOrEqual(LINE_HEIGHT);
  });

  it('draws lowercase like uppercase and clips safely off-screen', () => {
    const a = new FrameBuffer();
    const b = new FrameBuffer();
    drawText(a, 'hello', 3, 3, 3);
    drawText(b, 'HELLO', 3, 3, 3);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(() => drawText(a, 'EDGE', 150, 140, 3, { scale: 4 })).not.toThrow();
  });

  it('drawNumber matches drawText of the padded string', () => {
    const a = new FrameBuffer();
    const b = new FrameBuffer();
    drawNumber(a, 4207, 10, 10, 3, 6);
    drawText(b, formatScore(4207, 6), 10, 10, 3);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

describe('AutoRepeat', () => {
  it('fires on press, after the delay, then at the interval', () => {
    const r = new AutoRepeat(10, 3);
    const fired: number[] = [];
    for (let t = 0; t < 20; t++) if (r.update(true)) fired.push(t);
    expect(fired).toEqual([0, 10, 13, 16, 19]);
  });

  it('restarts after release', () => {
    const r = new AutoRepeat(5, 2);
    r.update(true);
    r.update(true);
    expect(r.update(false)).toBe(false);
    expect(r.update(true)).toBe(true);
    expect(r.update(true)).toBe(false);
  });

  it('DirectionalRepeat follows the most recent press and restarts the delay', () => {
    const d = new DirectionalRepeat(4, 2);
    expect(d.update(true, false, true, false)).toBe(-1);
    expect(d.update(true, false, false, false)).toBe(0);
    // Right pressed while left still held: switch immediately.
    expect(d.update(true, true, false, true)).toBe(1);
    expect(d.update(true, true, false, false)).toBe(0);
    // Right released: fall back to left, as a fresh press.
    expect(d.update(true, false, false, false)).toBe(-1);
    expect(d.update(false, false, false, false)).toBe(0);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and in range', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(createRng(8)()).not.toBe(createRng(7)());
  });

  it('randomInt and shuffle stay in bounds', () => {
    expect(randomInt(() => 0.999999, 5)).toBe(4);
    expect(randomInt(() => 1, 5)).toBe(4);
    const items = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    shuffleInPlace(createRng(3), items);
    expect(Array.from(items).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('formatScore pads and clamps', () => {
    expect(formatScore(42)).toBe('000042');
    expect(formatScore(12345678, 6)).toBe('999999');
  });
});
