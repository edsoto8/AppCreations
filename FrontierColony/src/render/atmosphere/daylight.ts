/**
 * Pure maths for the day/night cycle and weather lighting. The renderer multiplies the whole scene
 * by one ambient colour (a single full-screen quad, skipped entirely in bright daylight).
 */
import type { WeatherKind } from '../../sim';
import { clamp, lerp, smoothstep } from '../util/noise';

export type Rgb = readonly [number, number, number];

const NIGHT: Rgb = [0.34, 0.42, 0.7];

/** Sky colour through the day: [hour, multiply colour]. Dawn is rosy gold, dusk deeper orange then violet. */
const SKY: readonly (readonly [number, Rgb])[] = [
  [0, NIGHT],
  [4.8, NIGHT],
  [5.7, [0.5, 0.46, 0.72]],
  [6.4, [0.98, 0.74, 0.62]],
  [7.2, [1.0, 0.88, 0.76]],
  [8.4, [1, 1, 1]],
  [16.4, [1, 1, 1]],
  [17.5, [1.0, 0.9, 0.76]],
  [18.5, [1.0, 0.7, 0.54]],
  [19.3, [0.62, 0.5, 0.66]],
  [20.1, [0.4, 0.44, 0.7]],
  [20.9, NIGHT],
  [24, NIGHT],
];

function skyColor(hour: number): Rgb {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < SKY.length; i++) {
    const b = SKY[i]!;
    if (h <= b[0]) {
      const a = SKY[i - 1]!;
      const k = smoothstep(a[0], b[0], h);
      return [lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k)];
    }
  }
  return NIGHT;
}

/** 0 at night, 1 in full daylight, with smooth dawn (05–08) and dusk (17–20). */
export function dayFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 20) return 0;
  if (h < 8) return smoothstep(5, 8, h);
  if (h < 17) return 1;
  return 1 - smoothstep(17, 20, h);
}

/** Bell around sunrise (≈06:30) and sunset (≈18:30): 1 at the peak of golden hour. */
export function twilight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const bell = (c: number, w: number): number => Math.max(0, 1 - Math.abs(h - c) / w);
  return Math.max(bell(6.5, 1.8), bell(18.6, 1.8));
}

/** How strongly artificial lights should glow (0 by day, 1 in the dark). */
export function lightStrength(hour: number): number {
  return 1 - smoothstep(0.12, 0.75, dayFactor(hour));
}

export interface WeatherTint {
  /** Multiplier applied on top of the sky colour. */
  tint: Rgb;
  /** How much dim light the weather adds to a night (snow reflects). */
  nightLift: number;
}

export function weatherTint(kind: WeatherKind, intensity: number, drought: number): WeatherTint {
  const k = clamp(intensity, 0, 1);
  let r = 1;
  let g = 1;
  let b = 1;
  const mul = (tr: number, tg: number, tb: number, amount: number): void => {
    r *= lerp(1, tr, amount);
    g *= lerp(1, tg, amount);
    b *= lerp(1, tb, amount);
  };
  switch (kind) {
    case 'cloudy':
      mul(0.9, 0.93, 0.98, 0.6 + 0.4 * k);
      break;
    case 'rain':
      mul(0.76, 0.82, 0.92, 0.5 + 0.5 * k);
      break;
    case 'storm':
      mul(0.58, 0.64, 0.78, 0.6 + 0.4 * k);
      break;
    case 'snow':
      mul(0.93, 0.96, 1.0, 0.5 + 0.5 * k);
      break;
    default:
      break;
  }
  if (drought > 0) mul(1.0, 0.93, 0.8, drought);
  return { tint: [r, g, b], nightLift: kind === 'snow' ? 0.1 * k : 0 };
}

/** Final multiply colour for the scene (each channel 0..1). */
export function ambientColor(hour: number, kind: WeatherKind, intensity: number, drought: number): Rgb {
  const d = dayFactor(hour);
  const w = weatherTint(kind, intensity, drought);
  let [r, g, b] = skyColor(hour);
  if (w.nightLift > 0) {
    r = lerp(r, 1, w.nightLift * (1 - d));
    g = lerp(g, 1, w.nightLift * (1 - d));
    b = lerp(b, 1, w.nightLift * (1 - d));
  }
  return [r * w.tint[0], g * w.tint[1], b * w.tint[2]];
}

export function rgbToHex(c: Rgb): number {
  return (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
}

/** True when the ambient colour is (almost) white and the overlay can be skipped. */
export function isNeutral(c: Rgb): boolean {
  return c[0] > 0.985 && c[1] > 0.985 && c[2] > 0.985;
}
