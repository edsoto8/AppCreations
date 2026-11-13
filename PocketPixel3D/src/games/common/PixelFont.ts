/**
 * An original 5x7 bitmap font for the 160x144 screen.
 *
 * Every glyph sits in a 6 px advance cell (5 px of ink + 1 px gap). Lowercase letters are drawn as
 * uppercase. Characters without a glyph render as a small hollow box so missing text is visible.
 */
import type { Shade } from '../GameInterface';
import type { FrameBuffer } from './FrameBuffer';

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Horizontal distance between the left edges of consecutive glyphs (at scale 1). */
export const GLYPH_ADVANCE = 6;
/** Vertical distance between baselines of consecutive lines (at scale 1). */
export const LINE_HEIGHT = 9;

export type TextAlign = 'left' | 'center' | 'right';

export interface TextOptions {
  /** Integer pixel multiplier, default 1. */
  scale?: number;
  /** For 'center' x is the centre of each line; for 'right' x is its right edge. Default 'left'. */
  align?: TextAlign;
}

// prettier-ignore
const GLYPH_SOURCE: Record<string, readonly string[]> = {
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'J': ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '..#..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '[': ['.###.', '.#...', '.#...', '.#...', '.#...', '.#...', '.###.'],
  ']': ['.###.', '...#.', '...#.', '...#.', '...#.', '...#.', '.###.'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'], // up arrow
  '↓': ['..#..', '..#..', '..#..', '..#..', '#.#.#', '.###.', '..#..'], // down arrow
  '←': ['.....', '..#..', '.#...', '#####', '.#...', '..#..', '.....'], // left arrow
  '→': ['.....', '..#..', '...#.', '#####', '...#.', '..#..', '.....'], // right arrow
  '♪': ['...##', '...#.', '...#.', '...#.', '.###.', '####.', '.##..'], // music note
  '♥': ['.....', '.#.#.', '#####', '#####', '.###.', '..#..', '.....'], // heart
};

const FALLBACK_GLYPH = compileGlyph(['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####']);

/** char code -> 7 row bitmasks (bit 4 = leftmost column). */
const GLYPHS = new Map<number, Uint8Array>();
for (const [char, rows] of Object.entries(GLYPH_SOURCE)) {
  GLYPHS.set(char.charCodeAt(0), compileGlyph(rows));
}

function compileGlyph(rows: readonly string[]): Uint8Array {
  if (rows.length !== GLYPH_HEIGHT) throw new Error(`Glyph must have ${GLYPH_HEIGHT} rows`);
  const out = new Uint8Array(GLYPH_HEIGHT);
  rows.forEach((row, r) => {
    if (row.length !== GLYPH_WIDTH) throw new Error(`Glyph row must be ${GLYPH_WIDTH} wide: "${row}"`);
    let mask = 0;
    for (let c = 0; c < GLYPH_WIDTH; c++) {
      if (row[c] === '#') mask |= 1 << (GLYPH_WIDTH - 1 - c);
    }
    out[r] = mask;
  });
  return out;
}

function glyphFor(code: number): Uint8Array {
  if (code >= 97 && code <= 122) code -= 32; // a-z -> A-Z
  return GLYPHS.get(code) ?? FALLBACK_GLYPH;
}

/** True when the font has a dedicated glyph for this character (lowercase counts via uppercase). */
export function hasGlyph(char: string): boolean {
  let code = char.charCodeAt(0);
  if (code >= 97 && code <= 122) code -= 32;
  return GLYPHS.has(code);
}

function drawGlyph(fb: FrameBuffer, code: number, x: number, y: number, shade: Shade, scale: number): void {
  const glyph = glyphFor(code);
  for (let r = 0; r < GLYPH_HEIGHT; r++) {
    const mask = glyph[r] ?? 0;
    if (mask === 0) continue;
    for (let c = 0; c < GLYPH_WIDTH; c++) {
      if (mask & (1 << (GLYPH_WIDTH - 1 - c))) {
        if (scale === 1) fb.setPixel(x + c, y + r, shade);
        else fb.fillRect(x + c * scale, y + r * scale, scale, scale, shade);
      }
    }
  }
}

function normaliseScale(scale: number | undefined): number {
  if (scale === undefined) return 1;
  const s = Math.floor(scale);
  return s < 1 ? 1 : s;
}

/** Width of `count` glyphs on one line: no trailing gap after the last glyph. */
function lineWidth(count: number, scale: number): number {
  return count === 0 ? 0 : (count * GLYPH_ADVANCE - (GLYPH_ADVANCE - GLYPH_WIDTH)) * scale;
}

/**
 * Width in pixels of the longest line of `text` (lines split on `\n`). The gap after the final
 * glyph of a line is not counted, so "A" is 5 px wide and "AB" is 11 px wide at scale 1.
 */
export function measureText(text: string, scale?: number): number {
  const s = normaliseScale(scale);
  let longest = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      if (count > longest) longest = count;
      count = 0;
    } else {
      count++;
    }
  }
  if (count > longest) longest = count;
  return lineWidth(longest, s);
}

/**
 * Draws `text` with its top-left (per alignment) at (x, y). Each `\n` starts a new line
 * {@link LINE_HEIGHT} * scale pixels lower. Drawing is clipped by the frame buffer.
 */
export function drawText(
  fb: FrameBuffer,
  text: string,
  x: number,
  y: number,
  shade: Shade,
  options?: TextOptions,
): void {
  const scale = normaliseScale(options?.scale);
  const align = options?.align ?? 'left';
  let lineStart = 0;
  let lineY = y;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text.charCodeAt(i) !== 10) continue;
    const count = i - lineStart;
    const width = lineWidth(count, scale);
    let penX = x;
    if (align === 'center') penX = x - Math.floor(width / 2);
    else if (align === 'right') penX = x - width;
    for (let j = lineStart; j < i; j++) {
      const code = text.charCodeAt(j);
      if (code !== 32) drawGlyph(fb, code, penX, lineY, shade, scale);
      penX += GLYPH_ADVANCE * scale;
    }
    lineStart = i + 1;
    lineY += LINE_HEIGHT * scale;
  }
}

/**
 * Draws a non-negative integer without allocating a string. `minDigits` zero-pads on the left.
 * `align` works like {@link drawText}.
 */
export function drawNumber(
  fb: FrameBuffer,
  value: number,
  x: number,
  y: number,
  shade: Shade,
  minDigits = 1,
  options?: TextOptions,
): void {
  const scale = normaliseScale(options?.scale);
  const align = options?.align ?? 'left';
  let v = Math.max(0, Math.floor(value));
  let digits = 1;
  for (let t = v; t >= 10; t = Math.floor(t / 10)) digits++;
  if (digits < minDigits) digits = minDigits;
  const width = lineWidth(digits, scale);
  let left = x;
  if (align === 'center') left = x - Math.floor(width / 2);
  else if (align === 'right') left = x - width;
  for (let d = digits - 1; d >= 0; d--) {
    drawGlyph(fb, 48 + (v % 10), left + d * GLYPH_ADVANCE * scale, y, shade, scale);
    v = Math.floor(v / 10);
  }
}
