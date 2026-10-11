/**
 * `?quickstart` skips the main menu and starts a game straight away (dev and e2e convenience).
 * Optional overrides: `&seed=abc&preset=archipelago&size=medium&difficulty=harsh&name=Fort`.
 */
import {
  DEFAULT_NEW_GAME_OPTIONS,
  DIFFICULTIES,
  MAP_PRESETS,
  MAP_SIZES,
  type Difficulty,
  type MapPreset,
  type MapSize,
  type NewGameOptions,
} from '../../sim';

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((a) => a === value) ?? fallback;
}

/** Returns the options for a quickstart, or null when the URL does not ask for one. */
export function parseQuickstart(search: string): NewGameOptions | null {
  const params = new URLSearchParams(search);
  if (!params.has('quickstart')) return null;
  const d = DEFAULT_NEW_GAME_OPTIONS;
  return {
    seed: params.get('seed') || d.seed,
    colonyName: params.get('name') || d.colonyName,
    preset: pick<MapPreset>(params.get('preset'), MAP_PRESETS, d.preset),
    mapSize: pick<MapSize>(params.get('size'), MAP_SIZES, d.mapSize),
    difficulty: pick<Difficulty>(params.get('difficulty'), DIFFICULTIES, d.difficulty),
  };
}
