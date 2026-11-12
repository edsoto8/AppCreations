import type { HouseLayout } from '../types';
import { buildApartment } from './apartment';
import { buildChallenge } from './challenge';
import { buildFamily } from './family';

export type PresetId = 'apartment' | 'family' | 'challenge';

export const PRESETS: Array<{ id: PresetId; name: string; build: () => HouseLayout }> = [
  { id: 'apartment', name: 'Simple apartment', build: buildApartment },
  { id: 'family', name: 'Family home', build: buildFamily },
  { id: 'challenge', name: 'Obstacle challenge', build: buildChallenge },
];

/** Deep copy of a layout (plain data only). */
export function cloneLayout(l: HouseLayout): HouseLayout {
  return structuredClone(l);
}

/** A fresh, independent copy of a preset layout. Throws for unknown ids. */
export function getPreset(id: string): HouseLayout {
  const preset = PRESETS.find((pr) => pr.id === id);
  if (!preset) throw new Error(`Unknown house preset '${id}' (expected one of ${PRESETS.map((pr) => pr.id).join(', ')})`);
  return cloneLayout(preset.build());
}

export { CHALLENGE_GAPS } from './challenge';
export { wallWithOpenings, WallSet, furn, obst, FACING, BED_FOOT } from './helpers';
export type { Opening } from './helpers';
