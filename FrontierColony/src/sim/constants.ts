/**
 * Engine constants: fixed timestep, schema version, structural limits.
 * Gameplay tuning (costs, rates, day length, ...) lives in balance.ts, not here.
 */
import type { MapSize } from './types';

/** Simulation ticks per real second at 1x speed. */
export const TICKS_PER_SECOND = 10;
/** Sim seconds advanced by one `stepGame` call (fixed timestep). */
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;

/** Bump on any breaking change to `GameState`; add a migration in src/game/save.ts. */
export const SAVE_SCHEMA_VERSION = 2;

/** Map edge length in tiles per size preset (maps are square). */
export const MAP_DIMENSIONS: Record<MapSize, number> = {
  small: 64,
  medium: 96,
  large: 128,
};

/** Elevation levels are integers 0..MAX_ELEVATION. */
export const MAX_ELEVATION = 6;
/** Needs range 0..NEED_MAX (100 = best). */
export const NEED_MAX = 100;
/** Skills range 0..SKILL_MAX. */
export const SKILL_MAX = 10;
/** Number of colour variants per Appearance channel. */
export const APPEARANCE_VARIANTS = 8;
/** Hourly samples kept in ColonyStats.history (= 3 in-game days). */
export const STATS_HISTORY_LENGTH = 72;
/** Max entries kept in GameState.eventLog (oldest dropped first). */
export const EVENT_LOG_LIMIT = 200;
