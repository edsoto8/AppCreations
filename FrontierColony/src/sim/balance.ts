/**
 * Gameplay tuning numbers — the single place for balance values.
 *
 * Owner: Game Designer (values come from docs/GAME_DESIGN.md). The *shapes* are part of the
 * contract (types in types.ts). M1 synced pacing, starting stock, terrain and building values with
 * GAME_DESIGN.md; the remaining tables of its balance appendix (needs, AI scores, events, ...) are
 * added here by the Game Designer / Simulation Engineer. Sim code reads tuning values from here only.
 *
 * Time units: "sim seconds" = real seconds at 1x speed (TICK_SECONDS per tick);
 * "game hours" = in-game clock hours. Rates are per game hour unless the name says otherwise.
 */
import { TICK_SECONDS } from './constants';
import {
  Terrain,
  type BuildingDef,
  type BuildingType,
  type Difficulty,
  type JobCategory,
  type MapPreset,
  type MapSize,
  type Priorities,
  type ResourceAmounts,
  type ResourceType,
  type Season,
  type SkillType,
  type TerrainDef,
  type TraitId,
  type WeatherKind,
} from './types';

// --- Pacing -----------------------------------------------------------------------------------

/** Real seconds one in-game day lasts at 1x speed. */
export const REAL_SECONDS_PER_GAME_DAY = 180;
/** In-game hours advanced per tick (derived). */
export const GAME_HOURS_PER_TICK = (24 * TICK_SECONDS) / REAL_SECONDS_PER_GAME_DAY;
/** Clock time when a new game starts. */
export const START_HOUR = 6;
/** Days per season (spring → summer → autumn → winter → spring ...). */
export const DAYS_PER_SEASON = 5;
/** Hours considered daylight [start, end) for lighting and work schedules. */
export const DAYLIGHT_HOURS = { start: 5, end: 20 } as const;

// --- Settlers ---------------------------------------------------------------------------------

export const STARTING_SETTLERS = 5;
export const POPULATION_CAP = 30;
/** Starting needs of founders (GAME_DESIGN §3.1). Hunger and energy get a uniform integer jitter of +-`hungerEnergyJitter`. */
export const SETTLER_START_NEEDS = { hunger: 80, energy: 90, happiness: 65, health: 100, hungerEnergyJitter: 10 } as const;
export const NEWCOMER_START_NEEDS = { hunger: 70, energy: 80, happiness: 65, health: 100 } as const;
/** Walking speed on moveCost-1 terrain, tiles per sim second (= 18 tiles per game hour). */
export const SETTLER_WALK_SPEED = 2.4;
export const CARRYING_WALK_MULT = 0.9;
/** Base units a settler carries at once (GAME_DESIGN: 10 + hauling level). */
export const CARRY_CAPACITY = 10;
export const CARRY_PER_HAULING_LEVEL = 1;
/** Work speed multiplier = base + perLevel * skill level. */
export const SKILL_SPEED = { base: 0.75, perLevel: 0.05 } as const;
/** Skill rolls for new settlers (GAME_DESIGN §3.2). */
export const SKILL_SPAWN = { baseMin: 1, baseMax: 4, secondaryMin: 3, secondaryMax: 5 } as const;
/** Specialty skill level range by difficulty [min, max]. */
export const SPECIALTY_RANGE: Record<Difficulty, readonly [number, number]> = {
  relaxed: [6, 8],
  normal: [5, 7],
  harsh: [4, 6],
};
/** Specialties of founders #1..#3 (the remaining founders roll a random specialty). */
export const FOUNDER_SPECIALTIES: readonly SkillType[] = ['farming', 'construction', 'woodcutting'];
/** Newcomers gain +1 specialty level per `perDays` elapsed days, up to `max`. */
export const NEWCOMER_SPECIALTY_BONUS = { perDays: 5, max: 3 } as const;
export const XP_PER_WORK_HOUR = 1;
/** xpToNext(level) = XP_TO_NEXT_LEVEL_PER_LEVEL * (level + 1). */
export const XP_TO_NEXT_LEVEL_PER_LEVEL = 10;
/** Probability of rolling one or two traits. */
export const TRAIT_COUNT_WEIGHTS = { one: 0.6, two: 0.4 } as const;
/** A settler never has both traits of a pair. */
export const TRAIT_EXCLUSIVE_PAIRS: readonly (readonly [TraitId, TraitId])[] = [
  ['hardworking', 'lazy'],
  ['cheerful', 'gloomy'],
  ['glutton', 'frugal'],
  ['tough', 'frail'],
  ['nightOwl', 'earlyBird'],
  ['sociable', 'loner'],
  ['nimble', 'clumsy'],
];
/** Maximum number of founders that may have the given trait. */
export const FOUNDER_TRAIT_LIMITS: Partial<Record<TraitId, number>> = { lazy: 1, gloomy: 1 };

// --- Colony -----------------------------------------------------------------------------------

export const STARTING_STOCK: Record<Difficulty, ResourceAmounts> = {
  relaxed: { wood: 110, stone: 40, food: 90, water: 50, tools: 8 },
  normal: { wood: 80, stone: 30, food: 60, water: 40, tools: 5 },
  harsh: { wood: 50, stone: 15, food: 35, water: 25, tools: 2 },
};

export const DEFAULT_PRIORITIES: Priorities = {
  building: 2,
  farming: 2,
  woodcutting: 2,
  mining: 2,
  hauling: 2,
  water: 2,
  crafting: 2,
};

/** Fraction of a completed building's cost refunded on demolition. */
export const DEMOLISH_REFUND = 0.5;

// --- Terrain ----------------------------------------------------------------------------------

export const TERRAIN_DEFS: Record<Terrain, TerrainDef> = {
  [Terrain.DeepWater]: { name: 'Deep water', walkable: false, moveCost: 0, buildable: false },
  [Terrain.ShallowWater]: { name: 'Shallow water', walkable: true, moveCost: 2.5, buildable: false },
  [Terrain.Sand]: { name: 'Sand', walkable: true, moveCost: 1.15, buildable: true },
  [Terrain.Grass]: { name: 'Grassland', walkable: true, moveCost: 1, buildable: true },
  [Terrain.Forest]: { name: 'Forest', walkable: true, moveCost: 1.4, buildable: false },
  [Terrain.Hills]: { name: 'Rocky hills', walkable: true, moveCost: 1.7, buildable: false },
  [Terrain.Mountain]: { name: 'Mountain', walkable: false, moveCost: 0, buildable: false },
};

/** Initial harvestable units per tile (the average; world generation varies tiles around it, see WORLDGEN). */
export const TILE_RESOURCE_START = { forestWood: 40, hillsStone: 60, mountainStone: 120 } as const;

/** Forest regrowth and spread (GAME_DESIGN §6.5). `max` is the cap a forest tile regrows to. */
export const FOREST_REGROWTH = { perDay: 2, max: 40, spreadChance: 0.03, spreadMinForestNeighbours: 3, spreadStartWood: 8 } as const;

// --- World generation (GAME_DESIGN Appendix A) --------------------------------------------------

/** Per-preset generator tuning. Shares are fractions; forest/hills/mountain are fractions of land tiles. */
export interface WorldgenPresetDef {
  /** Target fraction of water tiles before fords/cleanup (includes the ocean ring or lakes). */
  waterShare: number;
  forestShare: number;
  hillsShare: number;
  mountainShare: number;
  /** Water within this many steps of land is shallow; one more step is shallow where noise allows. */
  shallowRange: number;
  /** Beach chance thresholds: a flat coastal tile becomes sand when beach noise (-1..1) exceeds the value. */
  beachNoise: { adjacent: number; second: number };
}

export const WORLDGEN_PRESETS: Record<MapPreset, WorldgenPresetDef> = {
  continent: {
    waterShare: 0.3,
    forestShare: 0.25,
    hillsShare: 0.12,
    mountainShare: 0.05,
    shallowRange: 2,
    beachNoise: { adjacent: -1, second: 0.05 },
  },
  archipelago: {
    waterShare: 0.55,
    forestShare: 0.25,
    hillsShare: 0.08,
    mountainShare: 0.02,
    shallowRange: 2,
    beachNoise: { adjacent: -1, second: -0.25 },
  },
  highlands: {
    waterShare: 0.1,
    forestShare: 0.2,
    hillsShare: 0.3,
    mountainShare: 0.15,
    shallowRange: 2,
    beachNoise: { adjacent: 0.1, second: 2 },
  },
  riverValley: {
    waterShare: 0.15,
    forestShare: 0.25,
    hillsShare: 0.12,
    mountainShare: 0.1,
    shallowRange: 2,
    beachNoise: { adjacent: 0.0, second: 2 },
  },
};

/** Generator constants that are not per preset. */
export const WORLDGEN = {
  /** Tiles at the map edge that are forced to water on continent and archipelago maps. */
  oceanBorder: 3,
  /** Number of islands (including the start island) on archipelago maps: [min, max] by map size. */
  islandCount: { small: [4, 5], medium: [5, 6], large: [6, 7] } as Record<MapSize, readonly [number, number]>,
  /** Minimum land area of the archipelago start island (tiles) and its share of all island land. */
  startIslandMinTiles: 800,
  /** Minimum open water between island coastlines (before fords). */
  islandGap: 4,
  /** Planned island area is scaled up by this factor to make up for coast erosion and crowding. */
  islandAreaBoost: 1.3,
  startIslandShare: 0.42,
  /** Land components smaller than this are removed (turned to water). */
  minLandComponent: 10,
  /** Water components smaller than this are filled with land. */
  minWaterComponent: 6,
  /** Fraction of the wood on a forest tile at the sparse edge of a grove (core tiles hold the full amount). */
  forestMinDensity: 0.6,
  /** Hills and mountain deposit size varies by +-(variation / 2) around the base amount, richer toward ridges. */
  hillsVariation: 0.5,
  mountainVariation: 0.2,
  /** Flat land at or above this fraction of the lowland height range is raised to elevation 1. */
  lowlandRiseAt: 0.6,
  /** Flat land this close (steps) to water stays at elevation 0. */
  coastFlatDistance: 2,
  /** Number of river fords by map size (riverValley). */
  riverFords: { small: 2, medium: 3, large: 4 } as Record<MapSize, number>,
  /** River half width as a fraction of the map edge. */
  riverHalfWidth: 0.075,
  /** Full generation passes tried before falling back to a hand-stamped start pad. */
  maxAttempts: 6,
} as const;

/**
 * Start-site guarantees around the 3x3 town center (GAME_DESIGN Appendix A). Radii are Chebyshev
 * distances from the footprint edge. `reach` limits are walking steps over walkable terrain.
 */
export const START_SITE = {
  forest: { radius: 8, min: 10 },
  stone: { radius: 8, min: 3 },
  grass: { radius: 10, min: 40 },
  water: { radius: 15, min: 1 },
  /** A lumber camp / mine site must exist within this distance of the town center. */
  siteRadius: 15,
  /** Land tiles (any land terrain) the start landmass must contain. */
  minLandTiles: 600,
  /** The start must be at least this many tiles from every map edge. */
  edgeMargin: 10,
  /** Walking-step limits for forest / stone / water to count as reachable from the town center. */
  reach: { forest: 18, stone: 18, water: 26 },
  /** Candidates validated in score order before the generation attempt is given up. */
  maxCandidatesChecked: 120,
} as const;

// --- Buildings --------------------------------------------------------------------------------

const BUILD_LAND: Terrain[] = [Terrain.Grass, Terrain.Sand];

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  townCenter: {
    type: 'townCenter',
    name: 'Town Center',
    description: 'The heart of the colony: stores goods, feeds settlers and shelters the founders.',
    footprint: { w: 3, h: 3 },
    cost: {},
    buildHours: 0,
    placeable: false,
    allowedTerrain: BUILD_LAND,
    requiresNearby: null,
    maxWorkers: 0,
    maxBuilders: 0,
    workRadius: 8,
    outputCap: 0,
    forage: { wood: 1, stone: 1, rateMult: 0.5 },
    drinkingPoint: true,
    housing: 4,
    storage: 150,
    production: null,
    jobCategory: null,
    eatingPoint: true,
    unlockedBy: null,
  },
  house: {
    type: 'house',
    name: 'House',
    description: 'Shelter for settlers. More housing lets the colony grow.',
    footprint: { w: 2, h: 2 },
    cost: { wood: 30, stone: 10 },
    buildHours: 10,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: null,
    maxWorkers: 0,
    maxBuilders: 3,
    workRadius: 0,
    outputCap: 0,
    forage: null,
    drinkingPoint: false,
    housing: 4,
    storage: 0,
    production: null,
    jobCategory: null,
    eatingPoint: false,
    unlockedBy: null,
  },
  farm: {
    type: 'farm',
    name: 'Farm',
    description: 'Fields that grow food. Slower in winter and drought.',
    footprint: { w: 3, h: 3 },
    cost: { wood: 20 },
    buildHours: 6,
    placeable: true,
    allowedTerrain: [Terrain.Grass],
    requiresNearby: null,
    maxWorkers: 2,
    maxBuilders: 4,
    workRadius: 0,
    outputCap: 30,
    forage: null,
    drinkingPoint: false,
    housing: 0,
    storage: 0,
    production: { output: 'food', amount: 4, cycleHours: 4, inputs: {}, skill: 'farming' },
    jobCategory: 'farming',
    eatingPoint: false,
    unlockedBy: null,
  },
  lumberCamp: {
    type: 'lumberCamp',
    name: 'Lumber Camp',
    description: 'Woodcutters fell nearby trees and bring the logs back.',
    footprint: { w: 2, h: 2 },
    cost: { wood: 20 },
    buildHours: 6,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: { terrain: [Terrain.Forest], radius: 6, minCount: 8 },
    maxWorkers: 2,
    maxBuilders: 3,
    workRadius: 6,
    outputCap: 30,
    forage: null,
    drinkingPoint: false,
    housing: 0,
    storage: 0,
    production: null,
    jobCategory: 'woodcutting',
    eatingPoint: false,
    unlockedBy: null,
  },
  mine: {
    type: 'mine',
    name: 'Mine',
    description: 'Miners quarry stone from nearby hills.',
    footprint: { w: 2, h: 2 },
    cost: { wood: 30 },
    buildHours: 10,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: { terrain: [Terrain.Hills, Terrain.Mountain], radius: 4, minCount: 3 },
    maxWorkers: 2,
    maxBuilders: 3,
    workRadius: 4,
    outputCap: 30,
    forage: null,
    drinkingPoint: false,
    housing: 0,
    storage: 0,
    production: null,
    jobCategory: 'mining',
    eatingPoint: false,
    unlockedBy: null,
  },
  well: {
    type: 'well',
    name: 'Well',
    description: 'Draws fresh water for the colony.',
    footprint: { w: 1, h: 1 },
    cost: { wood: 10, stone: 15 },
    buildHours: 6,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: null,
    maxWorkers: 1,
    maxBuilders: 2,
    workRadius: 0,
    outputCap: 30,
    forage: null,
    drinkingPoint: true,
    housing: 0,
    storage: 0,
    production: { output: 'water', amount: 4, cycleHours: 2, inputs: {}, skill: 'hauling' },
    jobCategory: 'water',
    eatingPoint: false,
    unlockedBy: null,
  },
  storage: {
    type: 'storage',
    name: 'Storage',
    description: 'Raises how much of each resource the colony can keep.',
    footprint: { w: 2, h: 2 },
    cost: { wood: 35, stone: 10 },
    buildHours: 8,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: null,
    maxWorkers: 0,
    maxBuilders: 3,
    workRadius: 0,
    outputCap: 0,
    forage: null,
    drinkingPoint: true,
    housing: 0,
    storage: 120,
    production: null,
    jobCategory: null,
    eatingPoint: true,
    unlockedBy: 'foundations',
  },
  workshop: {
    type: 'workshop',
    name: 'Workshop',
    description: 'Crafts tools from wood and stone. Tools speed up all work.',
    footprint: { w: 2, h: 2 },
    cost: { wood: 40, stone: 25 },
    buildHours: 12,
    placeable: true,
    allowedTerrain: BUILD_LAND,
    requiresNearby: null,
    maxWorkers: 1,
    maxBuilders: 3,
    workRadius: 0,
    outputCap: 10,
    forage: null,
    drinkingPoint: false,
    housing: 0,
    storage: 0,
    production: { output: 'tools', amount: 1, cycleHours: 3, inputs: { wood: 3, stone: 2 }, skill: 'crafting' },
    jobCategory: 'crafting',
    eatingPoint: false,
    unlockedBy: 'timber',
  },
};

// --- Traits -----------------------------------------------------------------------------------

export interface TraitDef {
  name: string;
  description: string;
}

export const TRAIT_DEFS: Record<TraitId, TraitDef> = {
  hardworking: { name: 'Hardworking', description: 'Puts in an honest day and then some. Works 15% faster but tires sooner.' },
  lazy: { name: 'Lazy', description: "Never met a hammock they didn't like. Works 15% slower." },
  cheerful: { name: 'Cheerful', description: 'Sees the bright side of mud. Happiness +8.' },
  gloomy: { name: 'Gloomy', description: 'Expects the worst and is rarely disappointed. Happiness -8.' },
  glutton: { name: 'Glutton', description: 'Eats a quarter more, and loves a full belly.' },
  frugal: { name: 'Frugal', description: 'Gets by on little. Eats 15% less.' },
  tough: { name: 'Tough', description: 'Frontier-hardened. Shrugs off cold, rain and fever.' },
  frail: { name: 'Frail', description: 'Catches every cold going. Takes 30% more damage.' },
  nightOwl: { name: 'Night Owl', description: 'Comes alive after dark. Works at night without penalty.' },
  earlyBird: { name: 'Early Bird', description: 'Up before the rooster. Works the dawn at full speed.' },
  sociable: { name: 'Sociable', description: 'Needs company. Gets twice the joy from a chat.' },
  loner: { name: 'Loner', description: 'Happiest left alone.' },
  nimble: { name: 'Nimble', description: 'Light on their feet. Walks 20% faster.' },
  clumsy: { name: 'Clumsy', description: 'All thumbs. Builds and crafts 15% slower.' },
};

/** Mechanical trait effects (1 = no effect; absent fields are neutral). GAME_DESIGN §3.3. */
export const TRAIT_EFFECTS = {
  hardworking: { workSpeed: 1.15, energyDecay: 1.1, workScore: 5 },
  lazy: { workSpeed: 0.85, energyDecay: 0.9, workScore: -5, wanderScore: 15 },
  cheerful: { happinessBaseline: 8 },
  gloomy: { happinessBaseline: -8 },
  glutton: { hungerDecay: 1.25, wellFedMoodlet: 4, wellFedAtHunger: 70 },
  frugal: { hungerDecay: 0.85 },
  tough: { healthDamage: 0.7, sicknessDuration: 0.5, ignoresWeatherMood: true },
  frail: { healthDamage: 1.3, healthRegen: 0.75, sicknessPickWeight: 2 },
  nightOwl: { noLightPenalty: ['dawn', 'dusk', 'night'] },
  earlyBird: { noLightPenalty: ['dawn'] },
  sociable: { socializeScore: 15, socializedMoodlet: 12, lonelyMoodlet: -5, lonelyAfterHours: 24 },
  loner: { happinessBaseline: 4, socializeScore: -20, noSocialMoodlets: true },
  nimble: { walkSpeed: 1.2 },
  clumsy: { walkSpeed: 0.9, constructionSpeed: 0.85, craftingSpeed: 0.85 },
} as const;

// --- Difficulty (GAME_DESIGN §14) ----------------------------------------------------------------

export interface DifficultyDef {
  needDecayMult: number;
  productionMult: number;
  healthDamageMult: number;
  negEventMult: number;
  posEventMult: number;
  growthMult: number;
  graceDays: number;
  /** Continuous hours in the Breaking mood band before a settler deserts. */
  desertionHours: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  relaxed: { needDecayMult: 0.85, productionMult: 1.15, healthDamageMult: 0.75, negEventMult: 0.6, posEventMult: 1.3, growthMult: 1.25, graceDays: 5, desertionHours: 72 },
  normal: { needDecayMult: 1.0, productionMult: 1.0, healthDamageMult: 1.0, negEventMult: 1.0, posEventMult: 1.0, growthMult: 1.0, graceDays: 3, desertionHours: 48 },
  harsh: { needDecayMult: 1.15, productionMult: 0.9, healthDamageMult: 1.25, negEventMult: 1.4, posEventMult: 0.8, growthMult: 0.8, graceDays: 2, desertionHours: 36 },
};

// --- Time of day (GAME_DESIGN §2) -----------------------------------------------------------------

export const DAY_PHASES = { dawnStart: 5, dayStart: 7, duskStart: 18, nightStart: 20 } as const;
export const LIGHT_WORK_MULT = { dawn: 0.85, day: 1.0, dusk: 0.85, night: 0.6 } as const;
export const NIGHT_WALK_MULT = 0.9;
/** Personal night window [startHour, endHour), wrapping midnight. */
export const PERSONAL_NIGHT_WINDOW: Record<'default' | 'nightOwl' | 'earlyBird', readonly [number, number]> = {
  default: [20, 5],
  nightOwl: [0, 8],
  earlyBird: [19, 4],
};

// --- Weather effects (GAME_DESIGN §9) ---------------------------------------------------------------

export const WEATHER_EFFECTS: Record<WeatherKind, { outdoorWork: number; farmGrowth: number; walk: number; energyDecay: number; wellMult: number }> = {
  clear: { outdoorWork: 1.0, farmGrowth: 1.0, walk: 1.0, energyDecay: 1.0, wellMult: 1.0 },
  cloudy: { outdoorWork: 1.0, farmGrowth: 1.0, walk: 1.0, energyDecay: 1.0, wellMult: 1.0 },
  rain: { outdoorWork: 0.85, farmGrowth: 1.25, walk: 0.9, energyDecay: 1.0, wellMult: 1.0 },
  storm: { outdoorWork: 0.6, farmGrowth: 0.6, walk: 0.75, energyDecay: 1.15, wellMult: 1.0 },
  snow: { outdoorWork: 0.8, farmGrowth: 0, walk: 0.8, energyDecay: 1.2, wellMult: 0.8 },
};
export const SEASON_ENERGY_DECAY_MULT: Record<Season, number> = { spring: 1.0, summer: 1.0, autumn: 1.0, winter: 1.1 };
export const SEASON_FARM_MULT: Record<Season, number> = { spring: 1.0, summer: 1.25, autumn: 1.0, winter: 0 };

// --- Needs (GAME_DESIGN §4) ------------------------------------------------------------------------

export const HUNGER_DECAY = 4.0;
export const MEAL = { food: 1, water: 1, hungerRestore: 48, hours: 0.5, maxHungerToEat: 50 } as const;
export const DRINK = { water: 1, hours: 0.15, starvingHungerRestore: 8, starvingCooldownHours: 4, starvingMaxHunger: 40 } as const;
export const ENERGY_DECAY = { working: 4.0, awakeOther: 3.0 } as const;
export const SLEEP_RESTORE = { bed: 9, outdoors: 6 } as const;
export const SLEEP_WAKE = { full: 100, nap: 90 } as const;
export const COLLAPSE_ENERGY = 5;
/** Outdoor bedrolls are placed within this many tiles of the town center. */
export const OUTDOOR_SLEEP_RADIUS_FROM_TOWN_CENTER = 3;

export const HEALTH = {
  regen: 1,
  regenInBed: 3,
  regenMinHunger: 25,
  regenMinEnergy: 20,
  starvingBelowHunger: 10,
  starvingDamage: 2.5,
  dehydratedDamage: 1.5,
  exhaustedDamage: 1,
  sickDamage: 1,
  coldNightDamage: 1,
  coldSnapNightDamage: 2,
  hurtBelow: 50,
  hurtWorkMult: 0.8,
  sickWorkMult: 0.7,
  criticalRestBelow: 25,
  restUntil: 50,
  damageLogHours: 6,
} as const;

export const HAPPINESS = { start: 65, baseTarget: 50, driftPerHour: 4 } as const;

export interface MoodBandDef {
  id: 'inspired' | 'content' | 'unhappy' | 'miserable' | 'breaking';
  min: number;
  workMult: number;
  workScoreMult: number;
  sulkChancePerHour: number;
  sulkHours: number;
  refusesWork: boolean;
}
/** Checked top-down. */
export const MOOD_BANDS: readonly MoodBandDef[] = [
  { id: 'inspired', min: 80, workMult: 1.1, workScoreMult: 1, sulkChancePerHour: 0, sulkHours: 0, refusesWork: false },
  { id: 'content', min: 50, workMult: 1.0, workScoreMult: 1, sulkChancePerHour: 0, sulkHours: 0, refusesWork: false },
  { id: 'unhappy', min: 30, workMult: 0.9, workScoreMult: 1, sulkChancePerHour: 0, sulkHours: 0, refusesWork: false },
  { id: 'miserable', min: 15, workMult: 0.75, workScoreMult: 0.85, sulkChancePerHour: 0.05, sulkHours: 2, refusesWork: false },
  { id: 'breaking', min: 0, workMult: 0, workScoreMult: 0, sulkChancePerHour: 0, sulkHours: 0, refusesWork: true },
];

export interface MoodletDef {
  value: number;
  /** Duration in game hours for timed moodlets; absent for state moodlets (re-evaluated hourly). */
  hours?: number;
  maxStacks?: number;
}
export const MOODLETS: Record<string, MoodletDef> = {
  sleptInHouse: { value: 6, hours: 18 },
  sleptOutdoors: { value: -10, hours: 18 },
  sleptOutdoorsCold: { value: -15, hours: 18 },
  hungry: { value: -8 },
  starving: { value: -20 },
  dehydrated: { value: -8 },
  tired: { value: -6 },
  hurt: { value: -10 },
  sick: { value: -8 },
  fineWeather: { value: 3 },
  rain: { value: -3 },
  storm: { value: -8 },
  snow: { value: -3 },
  socialized: { value: 6, hours: 12 },
  lonely: { value: -5 },
  overworked: { value: -6 },
  colonistDied: { value: -12, hours: 72, maxStacks: 3 },
  colonistLeft: { value: -5, hours: 48, maxStacks: 2 },
  newcomer: { value: 4, hours: 24, maxStacks: 2 },
  fullLarder: { value: 5 },
  emptyLarder: { value: -8 },
  wellFed: { value: 4 },
  festival: { value: 15, hours: 48 },
  wolves: { value: -5 },
};
export const MOODLET_THRESHOLDS = {
  hungryBelow: 25,
  starvingBelow: 10,
  tiredBelow: 20,
  overworkedHours: 12,
  fullLarderFoodDays: 5,
  fullLarderWaterDays: 3,
  sociableSocializedValue: 12,
  lonelyAfterHours: 24,
} as const;

// --- Utility AI (GAME_DESIGN §5) ---------------------------------------------------------------------

export const AI = {
  priorityBase: { 1: 40, 2: 55, 3: 70 } as Record<number, number>,
  skillScorePerLevel: 2,
  distPenaltyPerTile: 0.4,
  distPenaltyMaxTiles: 50,
  commitmentBonus: 15,
  jitterMax: 4,
  reevalHours: { work: 1.0, wander: 0.25 },
  storageFullPenalty: 30,
  eat: { base: 40, slope: 2.2, maxHunger: 50, distPenaltyPerTile: 0.3, distMaxTiles: 40 },
  drink: { dehydratedScore: 75 },
  sleep: { maxEnergy: 90, slope: 1.2, nightBonus: 60, distPenaltyPerTile: 0.2, distMaxTiles: 40 },
  socialize: {
    maxHappiness: 90,
    base: 20,
    slope: 0.5,
    slopeBelow: 75,
    duskBonus: 40,
    cooldownPenalty: 40,
    hours: 1,
    partnerRadius: 4,
    partnerOverlapHours: 0.5,
    sociableBonus: 15,
  },
  wander: { score: 12, lazyBonus: 15, hours: 0.5, radius: 6 },
  critical: { hungerBelow: 15, energyCollapseBelow: 5, healthRestBelow: 25, bonus: 200 },
  shortage: {
    food: { max: 25, targetDays: 3, autumnTargetDays: 8 },
    water: { max: 25, targetDays: 3 },
    wood: { max: 15, target: 50 },
    stone: { max: 15, target: 30 },
    tools: { max: 20, perPop: 0.6, min: 3 },
  },
  traitWorkBonus: { hardworking: 5, lazy: -5 },
  buildTaskBonus: { any: 10, houseWhileHomeless: 10, farmOrWellInShortage: 10, shortageThreshold: 12 },
  haul: { minLoad: 6, fillBonus: 25, fullBonus: 15, supplySiteBonus: 15, pickupHours: 0.1, dropHours: 0.1 },
  /** First decision of a settler happens on ticks where `tick % decisionStaggerTicks === id % decisionStaggerTicks`. */
  decisionStaggerTicks: 10,
  /** Game hours an idle settler waits after a failed path before deciding again. */
  pathFailCooldownHours: 0.25,
  /** Max A* node expansions per search. */
  pathIterationCap: 20000,
} as const;

// --- Economy: work (GAME_DESIGN §6) ------------------------------------------------------------------------

export const GATHER_RATE = { wood: 2.0, stone: 1.25 } as const;
export const TOOLS = {
  productivityMult: 1.4,
  durabilityHours: 48,
  usedBy: ['farming', 'woodcutting', 'mining', 'water', 'building'] as readonly JobCategory[],
  craftInputs: { wood: 3, stone: 2 },
  craftHours: 3,
} as const;
export const OUTDOOR_JOBS: readonly JobCategory[] = ['farming', 'woodcutting', 'mining', 'water', 'building'];
export const BUILD_RATE = 1.0;

/** Durability of one tool in worker-hours of tool-using work (GAME_DESIGN §6.4). */
export const TOOL_DURABILITY_HOURS = TOOLS.durabilityHours;
/** A well gets this multiplier when water lies within `radius` tiles (GAME_DESIGN §6.3). */
export const WELL_NEAR_WATER = { radius: 4, mult: 1.5 } as const;

// --- Progression (GAME_DESIGN §11) --------------------------------------------------------------------

export interface ObjectiveDef {
  id: string;
  title: string;
  description: string;
}
/** In display order. Conditions are evaluated in progression.ts; unlocks come from `BuildingDef.unlockedBy`. */
export const OBJECTIVES: readonly ObjectiveDef[] = [
  { id: 'roof', title: 'Roof Over Heads', description: 'Complete a house.' },
  { id: 'bread', title: 'Daily Bread', description: 'Complete a farm.' },
  { id: 'water', title: 'Fresh Water', description: 'Complete a well.' },
  { id: 'foundations', title: 'Lay the Foundations', description: 'Complete 3 buildings. Unlocks the storage.' },
  { id: 'timber', title: 'Stone and Timber', description: 'Complete a lumber camp and a mine. Unlocks the workshop.' },
  { id: 'toolmaker', title: 'Toolmaker', description: 'Craft 5 tools in total.' },
  { id: 'growing', title: 'Growing Settlement', description: 'Reach 10 settlers.' },
  { id: 'larder', title: 'Ready for Winter', description: 'Have food for 5 days per settler when winter begins.' },
  { id: 'winter', title: 'Survive the Winter', description: 'Reach day 21 with at least one settler alive.' },
  { id: 'thriving', title: 'Thriving Frontier', description: 'Reach 20 settlers with an average happiness of at least 50.' },
];
export const VICTORY = { population: 20, minAvgHappiness: 50 } as const;
/** Objective thresholds. */
export const OBJECTIVE_TARGETS = { foundationsBuildings: 3, toolsCrafted: 5, growingPopulation: 10, larderFoodPerSettler: 10, winterDay: 21 } as const;

// --- Weather (GAME_DESIGN §9) ------------------------------------------------------------------------

export const WEATHER_DURATION_HOURS: Record<WeatherKind, readonly [number, number]> = {
  clear: [6, 18],
  cloudy: [4, 12],
  rain: [3, 9],
  storm: [2, 5],
  snow: [4, 12],
};
export const WEATHER_INTENSITY_RANGE = [0.4, 1.0] as const;
/** Column order of the transition rows. */
export const WEATHER_ORDER: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow'];
/** Rows: the current weather; columns follow `WEATHER_ORDER`. */
export const WEATHER_TRANSITIONS: Record<'warm' | 'winter', Record<WeatherKind, readonly number[]>> = {
  warm: {
    clear: [0.45, 0.4, 0.12, 0.03, 0],
    cloudy: [0.4, 0.2, 0.3, 0.1, 0],
    rain: [0.2, 0.45, 0.2, 0.15, 0],
    storm: [0.1, 0.4, 0.5, 0, 0],
    snow: [0, 1.0, 0, 0, 0],
  },
  winter: {
    clear: [0.4, 0.35, 0, 0.05, 0.2],
    cloudy: [0.25, 0.25, 0, 0.1, 0.4],
    rain: [0, 0, 0, 0, 1.0],
    storm: [0.1, 0.4, 0, 0, 0.5],
    snow: [0.15, 0.4, 0, 0.15, 0.3],
  },
};
export const RAIN_BARREL_WATER_PER_HOUR = 0.5;

// --- Schedule, growth and nature (GAME_DESIGN §2, §6.5, §8) -------------------------------------------

export const SCHEDULE = { regrowthHour: 0, growthCheckHour: 8, eventRollHour: 8, wildfireRollHour: 14 } as const;
export const GROWTH = {
  minFreeBeds: 1,
  minFoodDays: 2,
  minWaterDays: 2,
  minAvgHappiness: 50,
  noDeathWithinHours: 24,
  baseChance: 0.5,
  perExtraBed: 0.1,
  maxExtraBeds: 3,
  pairChance: 0.3,
  pairMinFreeBeds: 2,
} as const;
/** Days per year (4 seasons). */
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

// --- Random events (GAME_DESIGN §10) ------------------------------------------------------------------

export interface TraderOffer {
  give: Partial<Record<ResourceType, number>>;
  get: Partial<Record<ResourceType, number>>;
}
export const TRADER_OFFERS: readonly TraderOffer[] = [
  { give: { wood: 30 }, get: { food: 25 } },
  { give: { food: 25 }, get: { stone: 20 } },
  { give: { wood: 30, stone: 10 }, get: { tools: 4 } },
  { give: { food: 30 }, get: { wood: 35 } },
  { give: { wood: 20 }, get: { water: 25 } },
];
export const SUPPLY_CACHE_REWARDS: readonly Partial<Record<ResourceType, number>>[] = [{ wood: 30 }, { stone: 20 }, { food: 25 }, { tools: 3 }];

export const EVENTS = {
  traderVisit: { positive: true, p: 0.1, minDay: 3, windowHours: 12 },
  wanderer: { positive: true, p: 0.07, minDay: 2, maxPop: 28, pairChance: 0.4, windowHours: 12 },
  harvestFestival: { positive: true, p: 0.35, minFoodPerPop: 6, foodCostPerPop: 2, socializeHours: 4, windowHours: 6, festivalHours: 48 },
  bountifulHarvest: { positive: true, p: 0.06, durationHours: 48, farmMult: 1.5 },
  richVein: { positive: true, p: 0.05, stonePerTile: 40 },
  supplyCache: { positive: true, p: 0.05, minDay: 2 },
  wolves: { positive: false, p: 0.06, minDay: 4, durationHours: 24, attackDamage: 35, attackMinDistance: 10, gatherMult: 0.8 },
  sickness: { positive: false, p: 0.05, minDay: 5, extraPIfExposed: 0.05, infectFraction: 0.25, durationHours: 36, toughDurationHours: 18, sleepScoreBonus: 20 },
  cropBlight: { positive: false, p: 0.04, durationHours: 48 },
  drought: { positive: false, p: 0.08, durationHours: 72, farmMult: 0.6, wellMult: 0.7 },
  wildfire: { positive: false, p: 0.2, minDistanceFromTownCenter: 8, radius: 3 },
  stormDamage: { positive: false, pPerStormHour: 0.03 },
  toolsBreak: { positive: false, p: 0.04, minTools: 4, lossFraction: 0.25 },
  coldSnap: { positive: false, p: 0.2, durationHours: 48, energyDecayMult: 1.3, wellMult: 0.5 },
} as const;
export const DAMAGE_REPAIR_PROGRESS = 0.7;
export const DAMAGE_IMMUNE: readonly BuildingType[] = ['townCenter', 'storage'];

/** Food and water one settler eats and drinks per in-game day (24 h x 4 hunger/h / 48 per meal). */
export const FOOD_PER_SETTLER_DAY = (24 * HUNGER_DECAY) / MEAL.hungerRestore;
export const WATER_PER_SETTLER_DAY = FOOD_PER_SETTLER_DAY;
