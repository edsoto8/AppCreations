/**
 * Settler colours from `Appearance` indices. These MUST match the avatar palettes in
 * src/ui/components/Avatar.tsx (the UI draws portraits from the same fields): same lists, same
 * hair-style and hat rules.
 */
import type { Appearance } from '../../sim';

export const SKIN_TONES = [0xf6d3b3, 0xefc29b, 0xe0a878, 0xc98a5e, 0xa86a43, 0x8a4f2f, 0x6b3a22, 0xf3cdb0] as const;
export const HAIR_COLORS = [0x2a1b12, 0x4a2f1b, 0x7a4a22, 0xb9793a, 0xd8b25a, 0xa33a22, 0x8c8c92, 0x1a1a1e] as const;
export const SHIRT_COLORS = [0xc0533a, 0x3f7fb5, 0x5f9a45, 0xd3a73a, 0x8a5aa8, 0x3c9a8f, 0xd8d0bc, 0x7a4a2a] as const;

function pick<T>(list: readonly T[], i: number): T {
  return list[((Math.floor(i) % list.length) + list.length) % list.length]!;
}

export interface SettlerLook {
  skin: number;
  hair: number;
  shirt: number;
  /** 0..3, same rule as the avatar. */
  hairStyle: number;
  hat: boolean;
}

export function lookFor(a: Appearance): SettlerLook {
  return {
    skin: pick(SKIN_TONES, a.skin),
    hair: pick(HAIR_COLORS, a.hair),
    shirt: pick(SHIRT_COLORS, a.shirt),
    hairStyle: (((Math.floor(a.hair) + Math.floor(a.skin)) % 4) + 4) % 4,
    hat: Math.floor(a.shirt) % 3 === 0,
  };
}
