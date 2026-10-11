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
  type Priorities,
  type ResourceAmounts,
  type TerrainDef,
  type TraitId,
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
/** Walking speed on moveCost-1 terrain, tiles per sim second. */
export const SETTLER_WALK_SPEED = 1.6;
/** Base units a settler carries at once (GAME_DESIGN: 10 + hauling level). */
export const CARRY_CAPACITY = 10;

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

/** Initial harvestable units per tile. */
export const TILE_RESOURCE_START = { forestWood: 40, hillsStone: 60, mountainStone: 120 } as const;

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
  hardworking: { name: 'Hardworking', description: 'Works faster.' },
  lazy: { name: 'Lazy', description: 'Works slower and rests more.' },
  cheerful: { name: 'Cheerful', description: 'Happiness drops more slowly.' },
  gloomy: { name: 'Gloomy', description: 'Happiness drops faster.' },
  glutton: { name: 'Glutton', description: 'Gets hungry faster.' },
  frugal: { name: 'Frugal', description: 'Eats less.' },
  tough: { name: 'Tough', description: 'Resists sickness and bad weather.' },
  frail: { name: 'Frail', description: 'Gets sick more easily.' },
  nightOwl: { name: 'Night Owl', description: 'Prefers to work late and sleep in.' },
  earlyBird: { name: 'Early Bird', description: 'Up at dawn, to bed early.' },
  sociable: { name: 'Sociable', description: 'Gains happiness from company.' },
  loner: { name: 'Loner', description: 'Prefers working alone.' },
  nimble: { name: 'Nimble', description: 'Walks faster.' },
  clumsy: { name: 'Clumsy', description: 'Walks slower and drops things.' },
};
