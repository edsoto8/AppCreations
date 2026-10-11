/** Tiny isometric drawing kit on top of Pixi Graphics: boxes, gable roofs, face decals. */
import type { Graphics } from 'pixi.js';
import { HALF_TILE_HEIGHT, HALF_TILE_WIDTH } from '../../shared/iso';
import { shadeHex } from '../util/color';

export interface Pt {
  x: number;
  y: number;
}

/** Local building space: u along +x tiles, v along +y tiles, h pixels up; origin at the footprint centre. */
export function P(u: number, v: number, h: number): Pt {
  return { x: (u - v) * HALF_TILE_WIDTH, y: (u + v) * HALF_TILE_HEIGHT - h };
}

export function flat(...pts: Pt[]): number[] {
  return pts.flatMap((p) => [p.x, p.y]);
}

export function fillPoly(g: Graphics, pts: Pt[], color: number, alpha = 1, outline = 0.55): void {
  g.poly(flat(...pts)).fill({ color, alpha });
  if (outline > 0) g.poly(flat(...pts)).stroke({ width: 1, color: shadeHex(color, 0.45), alpha: outline, join: 'round' });
}

export interface BoxColors {
  top: number;
  left: number;
  right: number;
}

export function tones(base: number): BoxColors {
  return { top: shadeHex(base, 1.12), left: shadeHex(base, 0.92), right: shadeHex(base, 0.7) };
}

/** Axis-aligned box. The visible faces are the top, the +v face ("left") and the +u face ("right"). */
export function box(g: Graphics, u0: number, v0: number, u1: number, v1: number, h0: number, h1: number, c: BoxColors | number, outline = 0.55): void {
  const col = typeof c === 'number' ? tones(c) : c;
  fillPoly(g, [P(u0, v1, h0), P(u1, v1, h0), P(u1, v1, h1), P(u0, v1, h1)], col.left, 1, outline);
  fillPoly(g, [P(u1, v1, h0), P(u1, v0, h0), P(u1, v0, h1), P(u1, v1, h1)], col.right, 1, outline);
  fillPoly(g, [P(u0, v1, h1), P(u1, v1, h1), P(u1, v0, h1), P(u0, v0, h1)], col.top, 1, outline);
}

/**
 * Gable roof over [u0,u1]×[v0,v1] sitting at height h. `ridge` runs along 'u' or 'v'.
 * `wall` colours the visible gable end.
 */
export function gable(g: Graphics, u0: number, v0: number, u1: number, v1: number, h: number, rise: number, ridge: 'u' | 'v', roof: number, wall: number, over = 0.07): void {
  const a0 = u0 - over;
  const a1 = u1 + over;
  const b0 = v0 - over;
  const b1 = v1 + over;
  if (ridge === 'u') {
    const vm = (v0 + v1) / 2;
    fillPoly(g, [P(u1, v1, h), P(u1, v0, h), P(u1, vm, h + rise)], shadeHex(wall, 0.72));
    fillPoly(g, [P(a0, b1, h - 2), P(a1, b1, h - 2), P(a1, vm, h + rise), P(a0, vm, h + rise)], shadeHex(roof, 1));
    // lit edge along the ridge
    g.moveTo(P(a0, vm, h + rise).x, P(a0, vm, h + rise).y).lineTo(P(a1, vm, h + rise).x, P(a1, vm, h + rise).y).stroke({ width: 1.2, color: shadeHex(roof, 1.3), alpha: 0.8 });
  } else {
    const um = (u0 + u1) / 2;
    fillPoly(g, [P(u0, v1, h), P(u1, v1, h), P(um, v1, h + rise)], shadeHex(wall, 0.94));
    fillPoly(g, [P(a1, b1, h - 2), P(a1, b0, h - 2), P(um, b0, h + rise), P(um, b1, h + rise)], shadeHex(roof, 0.78));
    g.moveTo(P(um, b0, h + rise).x, P(um, b0, h + rise).y).lineTo(P(um, b1, h + rise).x, P(um, b1, h + rise).y).stroke({ width: 1.2, color: shadeHex(roof, 1.2), alpha: 0.7 });
  }
}

/** Rectangle drawn on the +v ("left") wall: spans u in [ua,ub], height [h0,h1]. */
export function leftFaceRect(g: Graphics, v: number, ua: number, ub: number, h0: number, h1: number, color: number, alpha = 1): void {
  fillPoly(g, [P(ua, v, h0), P(ub, v, h0), P(ub, v, h1), P(ua, v, h1)], color, alpha, 0.4);
}

/** Rectangle drawn on the +u ("right") wall: spans v in [va,vb]. */
export function rightFaceRect(g: Graphics, u: number, va: number, vb: number, h0: number, h1: number, color: number, alpha = 1): void {
  fillPoly(g, [P(u, vb, h0), P(u, va, h0), P(u, va, h1), P(u, vb, h1)], color, alpha, 0.4);
}

/** Ground-level diamond over [u0,u1]×[v0,v1]. */
export function groundQuad(g: Graphics, u0: number, v0: number, u1: number, v1: number, h: number, color: number, alpha = 1, outline = 0.35): void {
  fillPoly(g, [P(u0, v0, h), P(u1, v0, h), P(u1, v1, h), P(u0, v1, h)], color, alpha, outline);
}
