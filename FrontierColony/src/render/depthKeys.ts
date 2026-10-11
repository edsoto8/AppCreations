/**
 * Depth keys for the painter's-algorithm sort (see layers.ts / depthLayer.ts). A larger key draws
 * later (in front). Tile bases use `d + 0.5` and tile objects `d + 1` where d = x + y.
 */
import { isoDepth } from '../shared/iso';

/** A settler at continuous (x, y): never behind the top of the tile it stands on. */
export function settlerDepth(x: number, y: number): number {
  return Math.max(isoDepth(x, y), Math.floor(x) + Math.floor(y) + 0.6) + 0.02;
}

/** A building with the given footprint: sorted by its centre, drawn just in front of tile objects there. */
export function buildingDepth(originX: number, originY: number, w: number, h: number): number {
  return isoDepth(originX + w / 2, originY + h / 2) + 0.5;
}

export function tileBaseDepth(x: number, y: number): number {
  return x + y + 0.5;
}

export function tileObjectDepth(x: number, y: number): number {
  return x + y + 1;
}
