/** Colour helpers for procedural art. Colours are [r, g, b] triples in 0..255. */

export type RGB = [number, number, number];

export function rgb(hex: number): RGB {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

export function toHex(c: RGB): number {
  return (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function shadeRgb(c: RGB, f: number): RGB {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

/** Hex colour darkened/lightened by a factor (>1 lightens, clamped). */
export function shadeHex(hex: number, f: number): number {
  return toHex(shadeRgb(rgb(hex), f));
}

export function mixHex(a: number, b: number, t: number): number {
  return toHex(mixRgb(rgb(a), rgb(b), t));
}

export function css(c: RGB | number, alpha = 1): string {
  const [r, g, b] = typeof c === 'number' ? rgb(c) : c;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}
