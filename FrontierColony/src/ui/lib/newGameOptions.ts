/** Labels and descriptions for the New Game form. Gameplay numbers come from GAME_DESIGN §14 and Appendix A. */
import { MAP_DIMENSIONS, type Difficulty, type MapPreset, type MapSize, type NewGameOptions } from '../../sim';

export const MAX_COLONY_NAME = 24;
export const MAX_SEED_LENGTH = 40;

export const PRESET_INFO: Record<MapPreset, { name: string; blurb: string; traits: string }> = {
  continent: {
    name: 'Continent',
    blurb: 'A balanced, forgiving land: wide grassland, a ring of sea and a few lakes.',
    traits: 'Balanced',
  },
  archipelago: {
    name: 'Archipelago',
    blurb: 'Islands linked by shallow fords. Farmland is tight and the sea is close.',
    traits: 'Water-rich, little farmland',
  },
  highlands: {
    name: 'Highlands',
    blurb: 'Stone everywhere, flat grass is rare and walks are long. Wells work away from water.',
    traits: 'Stone-rich, long walks',
  },
  riverValley: {
    name: 'River Valley',
    blurb: 'A lush river cuts between steep valley walls. Fertile banks and natural chokepoints.',
    traits: 'Fertile, defensible',
  },
};

export const SIZE_INFO: Record<MapSize, { name: string; blurb: string }> = {
  small: { name: 'Small', blurb: `${MAP_DIMENSIONS.small} x ${MAP_DIMENSIONS.small} tiles. Compact and quick.` },
  medium: { name: 'Medium', blurb: `${MAP_DIMENSIONS.medium} x ${MAP_DIMENSIONS.medium} tiles. Room to sprawl.` },
  large: { name: 'Large', blurb: `${MAP_DIMENSIONS.large} x ${MAP_DIMENSIONS.large} tiles. A whole wilderness.` },
};

/** The sim calls them relaxed / normal / harsh; the player sees Easy / Normal / Hard. */
export const DIFFICULTY_INFO: Record<Difficulty, { name: string; blurb: string }> = {
  relaxed: { name: 'Easy', blurb: 'Larger starting stores, gentler events, faster growth and a long grace period.' },
  normal: { name: 'Normal', blurb: 'The intended experience. Enough to start, nothing to waste.' },
  harsh: { name: 'Hard', blurb: 'Meager supplies, harsher events and quicker desertion. Winter will test you.' },
};

export interface NewGameDraft {
  colonyName: string;
  seed: string;
  preset: MapPreset;
  mapSize: MapSize;
  difficulty: Difficulty;
}

/** Trim, apply fallbacks and clamp lengths. Pure, so the form logic is testable. */
export function draftToOptions(draft: NewGameDraft, fallbackSeed: () => string): NewGameOptions {
  const colonyName = draft.colonyName.trim().slice(0, MAX_COLONY_NAME) || 'New Hope';
  const seed = draft.seed.trim().slice(0, MAX_SEED_LENGTH) || fallbackSeed();
  return { colonyName, seed, preset: draft.preset, mapSize: draft.mapSize, difficulty: draft.difficulty };
}
