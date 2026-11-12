import * as THREE from 'three';
import { FURNITURE_CATALOG, legOffsets, type FurnitureSpec } from '../../../sim/world/furnitureCatalog';
import type { FurnitureItem } from '../../../sim/world/types';
import type { ModelBuilder } from '../geometry';

/**
 * Build context for one furniture model. Local frame: x in [-w/2, w/2], z in [-d/2, d/2]
 * (sim local y == three local z), y up from the floor; the item's front faces +z.
 * Beds and bathtubs are long along x (bed headboard at -x).
 */
export interface FurnitureCtx {
  b: ModelBuilder;
  item: FurnitureItem;
  spec: FurnitureSpec;
  w: number;
  d: number;
  h: number;
  /** Main body color (item.color or catalog default). */
  color: string;
  /** Extra decorative detail (books, lamps, pillows...). */
  details: boolean;
}

export function makeCtx(b: ModelBuilder, item: FurnitureItem, details: boolean): FurnitureCtx {
  const spec = FURNITURE_CATALOG[item.kind];
  return { b, item, spec, w: item.w, d: item.d, h: item.h, color: item.color ?? spec.color, details };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Scale a hex color's lightness (f < 1 darker). */
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, clamp(hsl.l * f, 0, 1));
  return `#${c.getHexString()}`;
}

/** Leg centers in three local coordinates (x, z) for a legs4 item, exactly per the catalog. */
export function legCenters(ctx: FurnitureCtx): Array<{ x: number; z: number }> {
  return legOffsets(ctx.item).map((o) => ({ x: o.x, z: o.y }));
}

/**
 * Four square legs per the catalog (legSize, legInset) from the floor up to `top` (default:
 * clearance). `taper` narrows the leg towards the floor while keeping the floor contact square
 * exactly legSize (taper only widens upward, never past the catalog square at the floor).
 */
export function squareLegs(ctx: FurnitureCtx, mat: string, top = ctx.spec.clearance): void {
  const s = ctx.spec.legSize;
  for (const c of legCenters(ctx)) ctx.b.box(mat, s, top, s, c.x, top / 2, c.z);
}

/** Seeded RNG for deterministic decoration. */
export function seeded(...nums: number[]): () => number {
  let a = 0x9e3779b9;
  for (const n of nums) a = Math.imul(a ^ Math.round(n * 1000), 0x85ebca6b) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FurnitureBuilder = (ctx: FurnitureCtx) => void;
