/** Tooltip copy for resources, housing and the clock. Resource text is verbatim from docs/GAME_DESIGN.md §15. */
import type { ResourceType } from '../../sim';

export const RESOURCE_TOOLTIP: Record<ResourceType, string> = {
  wood: 'Wood: felled at lumber camps. Used for nearly every building and for tools.',
  stone: 'Stone: quarried at mines from hills and mountains. Needed for houses, wells and tools.',
  food: 'Food: grown on farms from spring to autumn. Each settler eats 2 a day. Fields lie fallow in winter, so stockpile.',
  water: 'Water: drawn at wells (faster near lakes and rivers). Each settler drinks 2 a day. Without it, settlers grow sick.',
  tools: 'Tools: crafted at the workshop. A settler with tools works 40% faster. Each tool lasts about 5 working days.',
};

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: 'Wood',
  stone: 'Stone',
  food: 'Food',
  water: 'Water',
  tools: 'Tools',
};

export const HOUSING_TOOLTIP =
  'Beds: 4 in the town center, 4 per house. Settlers without a bed sleep by the campfire, unhappy and cold in winter. Newcomers only come when a bed is free.';

export const SPEED_TOOLTIP: Record<'pause' | 1 | 2 | 4, { title: string; key: string }> = {
  pause: { title: 'Pause', key: 'Space' },
  1: { title: 'Normal speed', key: '1' },
  2: { title: 'Fast (2x)', key: '2' },
  4: { title: 'Very fast (4x)', key: '3' },
};
