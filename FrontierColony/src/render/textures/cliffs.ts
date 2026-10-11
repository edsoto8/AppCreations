/**
 * Cliff face strips. One strip is one elevation level (12px) of the left face: a parallelogram whose
 * top edge runs from the tile's left vertex (0,0) to its bottom vertex (32,16). The right face is the
 * mirrored sprite, tinted darker. Strips stack vertically for multi-level cliffs.
 */
import { ELEVATION_STEP } from '../../shared/iso';
import { clamp, fbm, mulberry32, smoothstep, valueNoise } from '../util/noise';
import { mixRgb, type RGB } from '../util/color';
import { createArt, TEX_SCALE, type Art } from './canvas';
import { CLIFF_ROCK, CLIFF_SAND, GRASS, SOIL, type Ramp } from './palette';

export type CliffMaterial = 'soil' | 'rock' | 'sand';
export type CliffKind = 'lip' | 'mid';

export const CLIFF_W = 33;
export const CLIFF_H = 16 + ELEVATION_STEP + 2;
const LEFT_SHADE = 0.84;

const RAMPS: Record<CliffMaterial, Ramp> = { soil: SOIL, rock: CLIFF_ROCK, sand: CLIFF_SAND };

function ramp(r: Ramp, t: number): RGB {
  return t < 0.5 ? mixRgb(r.dark, r.mid, t * 2) : mixRgb(r.mid, r.light, (t - 0.5) * 2);
}

export function makeCliffStrip(material: CliffMaterial, kind: CliffKind, seed: number): Art {
  const art = createArt(CLIFF_W, CLIFF_H, 0, 0);
  const { canvas, ctx } = art;
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const r = RAMPS[material];
  const rng = mulberry32(seed * 131 + 7);
  const strataPhase = rng() * 10;
  const bottomBleed = 0.9;
  for (let py = 0; py < H; py++) {
    const ly = (py + 0.5) / TEX_SCALE;
    for (let px = 0; px < W; px++) {
      const lx = (px + 0.5) / TEX_SCALE;
      const top = lx * 0.5;
      const v = ly - top; // 0 at the top edge
      const cover = clamp(Math.min(v + 0.5, ELEVATION_STEP + bottomBleed - v + 0.5), 0, 1);
      if (cover <= 0 || lx > CLIFF_W - 0.2) continue;
      const along = lx + v * 0.2;
      let t = fbm(along * 0.13 + seed, v * 0.34, seed + 3, 3);
      const strata = Math.sin((v + valueNoise(along * 0.18, 1.5, seed) * 3.4 + strataPhase) * 1.15);
      t += strata * 0.1;
      t += (valueNoise(along * 1.2, v * 0.8, seed + 9) - 0.5) * 0.22;
      // vertical cracks / streaks
      t -= smoothstep(0.78, 0.95, valueNoise(along * 0.55, 0.3, seed + 21)) * 0.16;
      let c = ramp(r, clamp(t, 0, 1));
      let shade = LEFT_SHADE * (1 - (v / ELEVATION_STEP) * 0.16);
      if (v < 1.4) shade *= 1.14; // lit top rim
      if (kind === 'lip' && material !== 'sand') {
        const lip = 2.4 + valueNoise(along * 0.42, 4, seed + 5) * 2.2;
        if (v < lip) {
          const g = mixRgb(GRASS.dark, GRASS.mid, clamp(0.35 + (valueNoise(along * 0.8, v, seed) - 0.5), 0, 1));
          c = mixRgb(g, [70, 120, 62], smoothstep(lip - 1.2, lip, v) * 0.7);
          shade = 0.9 + (v < 1 ? 0.12 : 0);
        } else if (v < lip + 2.2) {
          shade *= 0.8 + 0.2 * smoothstep(lip, lip + 2.2, v); // shadow tucked under the lip
        }
      }
      if (kind === 'lip' && material === 'sand') {
        if (v < 2.2) shade *= 1.08;
      }
      const i = (py * W + px) * 4;
      data[i] = clamp(c[0] * shade, 0, 255);
      data[i + 1] = clamp(c[1] * shade, 0, 255);
      data[i + 2] = clamp(c[2] * shade, 0, 255);
      data[i + 3] = cover * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return art;
}
