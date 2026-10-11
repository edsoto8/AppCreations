import { HALF_TILE_HEIGHT, HALF_TILE_WIDTH } from '../../shared/iso';

/** Local building space: u along +x tiles, v along +y tiles, h px up; origin at the footprint centre. */
export function P(u: number, v: number, h: number): { x: number; y: number } {
  return { x: (u - v) * HALF_TILE_WIDTH, y: (u + v) * HALF_TILE_HEIGHT - h };
}

export function pointInConvex(poly: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}
