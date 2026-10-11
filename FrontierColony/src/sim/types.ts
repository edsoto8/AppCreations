/**
 * Frontier Colony — simulation data model (the contract every module builds against).
 *
 * Rules (see CLAUDE.md "Simulation rules"):
 * - `GameState` is plain JSON data: no class instances, Maps, Sets, functions, `undefined` values
 *   or typed arrays. `JSON.parse(JSON.stringify(state))` must produce an equal, playable state.
 * - The sim mutates the state in place (one tick at a time). Renderer and UI treat it as read-only.
 * - Entities are referenced by numeric ids (`EntityId`), unique across settlers and buildings,
 *   allocated from `GameState.nextId`, starting at 1. Id 0 means "none" in tile arrays.
 * - Tile data is stored in flat row-major arrays: index = y * width + x (see `tileIndex`).
 * - Changing this file is a contract change: additive changes need lead sign-off, breaking
 *   changes also bump `SAVE_SCHEMA_VERSION` (src/sim/constants.ts) and add a migration.
 */

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

/** Positive integer id of a settler or building. 0 is never a valid id. */
export type EntityId = number;

/** Integer tile coordinate. Tile (x, y) covers the continuous square [x, x+1) × [y, y+1). */
export interface TilePos {
  x: number;
  y: number;
}

/** Continuous position in tile units. A settler standing in the middle of tile (3, 4) is at (3.5, 4.5). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Iso-facing used for sprite selection. `se` faces +x on screen-right-down, `sw` faces +y. */
export type Facing = 'ne' | 'nw' | 'se' | 'sw';

// ---------------------------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------------------------

/** Stockpiled resources. Housing is not a resource: it is derived from completed houses. */
export type ResourceType = 'wood' | 'stone' | 'food' | 'water' | 'tools';
export const RESOURCE_TYPES: readonly ResourceType[] = ['wood', 'stone', 'food', 'water', 'tools'];

/** Full amount table (every resource present, 0 when empty). Amounts are non-negative numbers. */
export type ResourceAmounts = Record<ResourceType, number>;
/** Sparse amount table used for costs and recipes. */
export type ResourceCost = Partial<Record<ResourceType, number>>;

// ---------------------------------------------------------------------------------------------
// Terrain and world
// ---------------------------------------------------------------------------------------------

/**
 * Terrain codes stored in `WorldState.terrain`. A const object instead of a TS `enum`
 * (the project uses `erasableSyntaxOnly`). New terrains are appended, never renumbered,
 * because the numbers are persisted in saves.
 */
export const Terrain = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  /** Rocky hills: walkable, minable stone deposits. */
  Hills: 5,
  /** Impassable peaks. */
  Mountain: 6,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];
/** Static properties of a terrain. Values live in `TERRAIN_DEFS` (src/sim/balance.ts). */
export interface TerrainDef {
  name: string;
  walkable: boolean;
  /** Path cost multiplier for walkable terrain (1 = grass). */
  moveCost: number;
  /** Whether building footprints may cover it (subject to BuildingDef.allowedTerrain). */
  buildable: boolean;
}

export type MapPreset = 'continent' | 'archipelago' | 'highlands' | 'riverValley';
export const MAP_PRESETS: readonly MapPreset[] = ['continent', 'archipelago', 'highlands', 'riverValley'];

export type MapSize = 'small' | 'medium' | 'large';
export const MAP_SIZES: readonly MapSize[] = ['small', 'medium', 'large'];

/**
 * The tile grid. All arrays have length `width * height`, row-major (index = y * width + x).
 * They are plain `number[]` (JSON-friendly); saves store them as-is.
 */
export interface WorldState {
  width: number;
  height: number;
  /** `Terrain` code per tile. */
  terrain: number[];
  /** Integer height level per tile, 0..MAX_ELEVATION (constants.ts). Drives iso vertical offset. */
  elevation: number[];
  /**
   * Harvestable units left on the tile: wood on Forest, stone on Hills/Mountain, 0 elsewhere.
   * When a forest tile reaches 0 the sim turns it into Grass and emits `tileChanged`.
   */
  resource: number[];
  /** Id of the building whose footprint covers the tile, or 0. Kept in sync by the sim. */
  building: number[];
  /**
   * Incremented whenever the *structure* of the map changes after creation: a terrain code,
   * elevation or building footprint. Renderers cache terrain geometry and rebuild (or patch from
   * `tileChanged` events) when this changes. A change of only `resource` (a tree being chopped,
   * a seam being quarried) emits `tileChanged` but does NOT bump the revision, so it stays cheap.
   */
  revision: number;
}

// ---------------------------------------------------------------------------------------------
// Time, weather, events
// ---------------------------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface TimeState {
  /** Number of fixed simulation ticks since the game started. */
  tick: number;
  /** Day counter, starting at 1. */
  day: number;
  /** In-game hours in [0, 24). 0 = midnight, 12 = noon. */
  timeOfDay: number;
  season: Season;
}

/** Extendable union: append new kinds; never rename (persisted in saves). */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow';
export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'snow'];

export interface WeatherState {
  current: WeatherKind;
  /** 0..1 strength (particle density, effect scaling). */
  intensity: number;
  /** In-game hours until the next weather roll. */
  hoursRemaining: number;
}

/** Random colony events. Extendable union (balance.ts holds their numbers). */
export type RandomEventKind =
  | 'wanderer'
  | 'bountifulHarvest'
  | 'cropBlight'
  | 'drought'
  | 'sickness'
  | 'wildfire'
  | 'toolsBreak'
  | 'coldSnap'
  | 'traderVisit'
  | 'wolves'
  | 'stormDamage'
  | 'richVein'
  | 'supplyCache'
  | 'harvestFestival';

/** A random event with a duration that is currently affecting the colony. */
export interface ActiveRandomEvent {
  id: number;
  kind: RandomEventKind;
  startedTick: number;
  /** In-game hours left; instant events are never stored here. */
  hoursRemaining: number;
  /** 0..1 strength rolled when the event started. */
  magnitude: number;
  /** Entity the event affects (e.g. the farm hit by crop blight, the settler who is sick), or null. */
  targetId: EntityId | null;
  /** Tile the event is centred on (e.g. wildfire), or null. */
  tile: TilePos | null;
}

export type LogSeverity = 'info' | 'good' | 'warning' | 'danger';

/** A persisted line in the colony's event log (shown in the events panel). */
export interface LogEntry {
  id: number;
  tick: number;
  day: number;
  /** Hours [0, 24) when it happened. */
  timeOfDay: number;
  severity: LogSeverity;
  message: string;
  /** Optional link targets so the UI can jump the camera / select. */
  settlerId: EntityId | null;
  buildingId: EntityId | null;
  tile: TilePos | null;
}

// ---------------------------------------------------------------------------------------------
// Settlers
// ---------------------------------------------------------------------------------------------

export type SkillType = 'farming' | 'woodcutting' | 'mining' | 'construction' | 'hauling' | 'crafting';
export const SKILL_TYPES: readonly SkillType[] = [
  'farming',
  'woodcutting',
  'mining',
  'construction',
  'hauling',
  'crafting',
];
/** Skill levels range 0..SKILL_MAX (constants.ts). Higher = faster work. */
export type Skills = Record<SkillType, number>;

/**
 * Personality traits. Extendable union; the effect of each trait is defined in balance.ts
 * (`TRAITS`) from docs/GAME_DESIGN.md.
 */
export type TraitId =
  | 'hardworking'
  | 'lazy'
  | 'cheerful'
  | 'gloomy'
  | 'glutton'
  | 'frugal'
  | 'tough'
  | 'frail'
  | 'nightOwl'
  | 'earlyBird'
  | 'sociable'
  | 'loner'
  | 'nimble'
  | 'clumsy';

/**
 * Needs, each 0..100 where **100 is best** for every need:
 * hunger 100 = fully fed (0 = starving), energy 100 = rested, happiness 100 = content,
 * health 100 = healthy (0 = dead).
 */
export interface Needs {
  hunger: number;
  energy: number;
  happiness: number;
  health: number;
}
export type NeedType = keyof Needs;
export const NEED_TYPES: readonly NeedType[] = ['hunger', 'energy', 'happiness', 'health'];

/** Palette indices (0..APPEARANCE_VARIANTS-1) the renderer maps to colours. */
export interface Appearance {
  skin: number;
  hair: number;
  shirt: number;
}

/** Job categories the player can prioritise. */
export type JobCategory = 'building' | 'farming' | 'woodcutting' | 'mining' | 'hauling' | 'water' | 'crafting';
export const JOB_CATEGORIES: readonly JobCategory[] = [
  'building',
  'farming',
  'woodcutting',
  'mining',
  'hauling',
  'water',
  'crafting',
];
/** 0 = disabled, 1 = low, 2 = normal (default), 3 = high. */
export type PriorityLevel = 0 | 1 | 2 | 3;
export type Priorities = Record<JobCategory, PriorityLevel>;

/**
 * What the settler is visibly doing. Renderer (animation) and UI (labels) read only this,
 * never `Settler.task`, so the sim can restructure tasks freely.
 */
export type ActivityKind =
  | 'idle'
  | 'walking'
  | 'carrying'
  | 'chopping'
  | 'mining'
  | 'farming'
  | 'building'
  | 'crafting'
  | 'fetchingWater'
  | 'eating'
  | 'sleeping'
  | 'resting'
  | 'socializing'
  | 'wandering';

export interface Activity {
  kind: ActivityKind;
  /** Human-readable, e.g. "Chopping wood", "Walking to Farm", "Sleeping at home". */
  label: string;
  /** 0..1 progress of the current action for progress bars, or null. */
  progress: number | null;
  /** Tile being worked on (for facing / particles), or null. */
  targetTile: TilePos | null;
  /**
   * The building the settler is inside right now (asleep or resting in a bed), or null. The renderer
   * hides or draws settlers indoors from this, not from the label. Updated every tick.
   */
  indoorsBuildingId: EntityId | null;
}

/** Where a task is in its lifecycle. */
export type TaskPhase = 'moving' | 'working' | 'returning';

interface TaskBase {
  phase: TaskPhase;
  /** Sim-internal timer/progress for the current phase (units defined by the sim). */
  progress: number;
}

/**
 * The settler's current job — sim-internal. Other modules must not depend on its variants.
 * The Simulation Engineer may add variants (contract change, additive).
 */
export type Task =
  | (TaskBase & { kind: 'idle' })
  | (TaskBase & { kind: 'wander'; targetTile: TilePos })
  | (TaskBase & { kind: 'gather'; resource: ResourceType; targetTile: TilePos; dropOffBuildingId: EntityId | null })
  | (TaskBase & {
      kind: 'haul';
      resource: ResourceType;
      amount: number;
      fromBuildingId: EntityId | null;
      toBuildingId: EntityId;
    })
  | (TaskBase & { kind: 'construct'; buildingId: EntityId })
  | (TaskBase & { kind: 'work'; buildingId: EntityId })
  | (TaskBase & { kind: 'eat'; buildingId: EntityId })
  | (TaskBase & { kind: 'drink'; buildingId: EntityId })
  /** `buildingId` is the bed (house or town center); null = bedroll by the campfire. `progress` is 1 for a nap. */
  | (TaskBase & { kind: 'sleep'; buildingId: EntityId | null })
  /** Critical-health rest (counts as sleep for restore rates) until health reaches the rest threshold. */
  | (TaskBase & { kind: 'rest'; buildingId: EntityId | null })
  | (TaskBase & { kind: 'socialize'; withSettlerId: EntityId | null })
  /** Desertion: walking to a map edge, then the settler leaves the colony. */
  | (TaskBase & { kind: 'depart'; edgeTile: TilePos });
export type TaskKind = Task['kind'];

export interface Carrying {
  resource: ResourceType;
  amount: number;
}

/** Timed or state-based mood modifier (docs/GAME_DESIGN.md §4.4). */
export interface Moodlet {
  /** Moodlet id, e.g. 'sleptInHouse', 'hungry' (catalogue in balance.ts). */
  id: string;
  /** Happiness target contribution (positive or negative). */
  value: number;
  /** In-game hours left, or null for a state moodlet re-evaluated hourly. */
  hoursLeft: number | null;
}

/** Sim-internal per-settler counters and flags (docs/GAME_DESIGN.md §4). UI may display them. */
export interface SettlerStatus {
  dehydrated: boolean;
  /** 0 when healthy. */
  sickHoursLeft: number;
  drinkCooldownHours: number;
  /** Continuous hours with happiness in the "breaking" band (desertion timer). */
  breakingHours: number;
  hoursWorkedSinceWake: number;
  sulkHoursLeft: number;
  lastSocializedTick: number | null;
  /** Rolling health damage per cause ("starvation", "cold", ...) used to name the cause of death. */
  damageLog: Record<string, number>;
  /**
   * Per-episode flags for `needCritical`: true once the event was sent for the current episode,
   * cleared when the need recovers. Keyed by need.
   */
  needAlerts: Record<NeedType, boolean>;
  /** The settler slept outdoors during the last night (raises sickness odds, GAME_DESIGN §10). */
  sleptOutdoorsLastNight: boolean;
}

export interface Settler {
  id: EntityId;
  name: string;
  /** Day the settler joined (1 for founders). */
  joinedDay: number;
  traits: TraitId[];
  skills: Skills;
  needs: Needs;
  appearance: Appearance;
  /** Current continuous position (tile units). */
  pos: Vec2;
  /** Position at the start of the last tick; renderer lerps prevPos→pos by the frame alpha. */
  prevPos: Vec2;
  facing: Facing;
  /** Remaining waypoints (tile coords, walked via tile centres); empty when not moving. */
  path: TilePos[];
  task: Task;
  activity: Activity;
  carrying: Carrying | null;
  homeId: EntityId | null;
  workplaceId: EntityId | null;
  /** Practice XP towards the next level, per skill. */
  xp: Record<SkillType, number>;
  moodlets: Moodlet[];
  status: SettlerStatus;
  /** Durability left on the tool this settler holds, or null when working bare-handed. */
  toolDurability: number | null;
  /** In-game hours since the AI last re-evaluated this settler's task. */
  hoursSinceDecision: number;
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

export type BuildingType =
  | 'townCenter'
  | 'house'
  | 'farm'
  | 'lumberCamp'
  | 'mine'
  | 'well'
  | 'storage'
  | 'workshop';
export const BUILDING_TYPES: readonly BuildingType[] = [
  'townCenter',
  'house',
  'farm',
  'lumberCamp',
  'mine',
  'well',
  'storage',
  'workshop',
];

export interface Footprint {
  w: number;
  h: number;
}

/** Production recipe of a building, per completed cycle. */
export interface ProductionRecipe {
  output: ResourceType;
  amount: number;
  /** In-game hours of work for one cycle at skill-neutral speed with one worker. */
  cycleHours: number;
  /** Consumed from the colony stock at the start of each cycle. */
  inputs: ResourceCost;
  /** Skill that speeds this up. */
  skill: SkillType;
}

/** Static definition of a building type. Values live in `BUILDING_DEFS` (src/sim/balance.ts). */
export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  footprint: Footprint;
  cost: ResourceCost;
  /** Builder work to finish construction, in in-game worker-hours. */
  buildHours: number;
  /** False for the pre-placed town center. */
  placeable: boolean;
  /** Terrains every footprint tile may stand on. */
  allowedTerrain: Terrain[];
  /**
   * If set, at least `minCount` tiles within `radius` (Chebyshev distance from the footprint)
   * must be one of these terrains (lumber camp near forest, mine near hills, ...).
   */
  requiresNearby: { terrain: Terrain[]; radius: number; minCount: number } | null;
  maxWorkers: number;
  /** Builders allowed at once on the construction site (GAME_DESIGN §7.1 "Max builders"). */
  maxBuilders: number;
  /** Radius (Chebyshev, from the footprint edge) in which workers gather tiles; 0 for buildings that do not gather. */
  workRadius: number;
  /** Capacity of the building's output buffer, per resource (0 = no buffer). */
  outputCap: number;
  /**
   * Town-center style forage slots: this many settlers can gather wood and this many stone from
   * tiles within `workRadius` at `rateMult` speed. Null for buildings without forage.
   */
  forage: { wood: number; stone: number; rateMult: number } | null;
  /** Settlers can drink here when complete (eating points and wells). */
  drinkingPoint: boolean;
  /** Settlers this building can house (houses, town center). */
  housing: number;
  /** Storage capacity added per resource while complete. */
  storage: number;
  production: ProductionRecipe | null;
  /** Job category of work done here (null for houses/storage). */
  jobCategory: JobCategory | null;
  /** Settlers can eat (and drink) here when complete. */
  eatingPoint: boolean;
  /** Objective id that unlocks this type, or null when available from the start. */
  unlockedBy: string | null;
}

export type BuildingStatus = 'construction' | 'complete';

export interface ConstructionState {
  /**
   * `'new'`: a blueprint being built for the first time (cancellable, emits `buildingCompleted`).
   * `'repair'`: a completed building that was damaged and is being repaired (not cancellable,
   * emits `buildingRepaired`, does not count toward stats or objectives).
   */
  kind: 'new' | 'repair';
  /** 0..1, = workDone / buildHours. Renderer draws scaffolding from this. */
  progress: number;
  /** Worker-hours applied so far. */
  workDone: number;
  /**
   * TOTAL materials needed to finish the site. Constant: a copy of `def.cost` taken at placement
   * (all zero for repairs). Never decreases. What is still missing is `required - delivered`
   * (minus goods already being carried to the site).
   */
  required: ResourceAmounts;
  /** Materials hauled to the site so far. Cancelling refunds these to the stock. */
  delivered: ResourceAmounts;
}

export interface Building {
  id: EntityId;
  type: BuildingType;
  /** Minimum-x, minimum-y corner of the footprint. */
  origin: TilePos;
  footprint: Footprint;
  status: BuildingStatus;
  /** Non-null exactly while `status === 'construction'`. */
  construction: ConstructionState | null;
  // Workers and residents are NOT stored here: the settler side is the single source of truth
  // (`Settler.workplaceId`, `Settler.homeId`). Use `getWorkers` / `getResidents` (queries.ts).
  /** Produced goods waiting to be hauled to storage. */
  output: ResourceAmounts;
  /** 0..1 progress of the current production cycle. */
  productionProgress: number;
  placedTick: number;
}

// ---------------------------------------------------------------------------------------------
// Colony, stats, outcome
// ---------------------------------------------------------------------------------------------

/** A settler who died, kept for the statistics screen and for unique-name checks. */
export interface GraveEntry {
  id: EntityId;
  name: string;
  diedDay: number;
  cause: string;
}

export interface ColonyState {
  name: string;
  /** Every settler name ever used (living, dead or departed); new settlers avoid these. */
  usedNames: string[];
  /** Settlers who died, oldest first. */
  graveyard: GraveEntry[];
  /** Colony-wide stockpile held in the town center and storage buildings. */
  stock: ResourceAmounts;
  priorities: Priorities;
}

/** One hourly sample used for charts and rate calculation. */
export interface StatsSample {
  tick: number;
  day: number;
  timeOfDay: number;
  stock: ResourceAmounts;
  population: number;
  /** Totals produced / consumed during the hour that ended with this sample. */
  produced: ResourceAmounts;
  consumed: ResourceAmounts;
}

export interface ColonyStats {
  /** Most recent samples, oldest first, at most STATS_HISTORY_LENGTH entries (constants.ts). */
  history: StatsSample[];
  /** Produced / consumed during the current (partial) sample hour. */
  producedThisHour: ResourceAmounts;
  consumedThisHour: ResourceAmounts;
  totalProduced: ResourceAmounts;
  totalConsumed: ResourceAmounts;
  /** Deprecated: the design has no births, so this stays 0. */
  births: number;
  arrivals: number;
  deaths: number;
  peakPopulation: number;
  buildingsCompleted: number;
}

/**
 * 'won' does not stop the simulation. The colony stays 'won' until the player sends
 * `acknowledgeVictory`; that sets `progress.victoryAcknowledged = true` and returns the status to
 * 'playing' (sandbox mode), and victory never triggers again. Only 'lost' stops the simulation.
 */
export type GameStatus = 'playing' | 'won' | 'lost';

export interface GameOutcome {
  status: GameStatus;
  /** Human-readable reason once the game has ended. */
  reason: string | null;
  endedTick: number | null;
}

/**
 * Trader offer (GAME_DESIGN §10 #1). Flat keys, one per resource and side, present only when non-zero:
 * `giveWood: 30, getFood: 25` means "30 wood for 25 food". Accept swaps the goods at once.
 */
export type TraderPayload = {
  [K in `${'give' | 'get'}${Capitalize<ResourceType>}`]?: number;
};
/** Wanderers (§10 #2) asking to join when there are not enough beds. */
export type WandererPayload = {
  /** Group size, 1 or 2. */
  count: number;
  /** Free beds at the time of the offer (less than `count`). */
  freeBeds: number;
};
/** Harvest festival (§10 #3). */
export type FestivalPayload = {
  /** Food the festival costs when accepted (2 per settler). */
  foodCost: number;
};

interface PendingDecisionBase {
  /** Matches `ActiveRandomEvent.id` / log ids (allocated from nextLogId). */
  eventId: number;
  /** In-game hours until it expires (expiry counts as decline). */
  hoursLeft: number;
  /** Total length of the decision window in in-game hours (so the UI can scale a countdown). */
  windowHours: number;
}

/**
 * An event that waits for the player's accept/decline. Only three kinds are decisions; each has its
 * own typed payload. `resolveEvent` with `accept: false`, or expiry, takes the default (decline).
 */
export type PendingDecision = PendingDecisionBase &
  (
    | { kind: 'traderVisit'; payload: TraderPayload }
    | { kind: 'wanderer'; payload: WandererPayload }
    | { kind: 'harvestFestival'; payload: FestivalPayload }
  );

/** Objectives, unlocks and long-running counters (docs/GAME_DESIGN.md). */
export interface ProgressState {
  objectivesDone: string[];
  /** Building types the player may place (others are locked until objectives unlock them). */
  unlocked: BuildingType[];
  toolsCrafted: number;
  /** Year in which the harvest festival last ran, or null. */
  festivalYear: number | null;
  lastDeathTick: number | null;
  victoryAcknowledged: boolean;
}

export type Difficulty = 'relaxed' | 'normal' | 'harsh';
export const DIFFICULTIES: readonly Difficulty[] = ['relaxed', 'normal', 'harsh'];

/** sfc32 generator state: four unsigned 32-bit integers. See src/sim/rng.ts. */
export type RngState = [number, number, number, number];

export interface GameMeta {
  schemaVersion: number;
  /** The seed string the player typed (or a generated one). */
  seed: string;
  /** `hashSeed(seed)`: the uint32 the world generator and RNG were seeded with. */
  seedNumber: number;
  preset: MapPreset;
  mapSize: MapSize;
  difficulty: Difficulty;
}

/** The entire game. JSON-serializable; see the rules at the top of this file. */
export interface GameState {
  meta: GameMeta;
  time: TimeState;
  world: WorldState;
  colony: ColonyState;
  settlers: Settler[];
  buildings: Building[];
  weather: WeatherState;
  activeEvents: ActiveRandomEvent[];
  /** Newest last, capped at EVENT_LOG_LIMIT entries. */
  eventLog: LogEntry[];
  stats: ColonyStats;
  outcome: GameOutcome;
  /** Simulation RNG stream. World generation uses its own stream derived from the seed. */
  rng: RngState;
  /** Next free entity id (settlers and buildings share the counter). */
  nextId: number;
  /** Next free id for log entries and active events. */
  nextLogId: number;
  pendingDecisions: PendingDecision[];
  progress: ProgressState;
}

// ---------------------------------------------------------------------------------------------
// Inputs and outputs of the sim API
// ---------------------------------------------------------------------------------------------

export interface NewGameOptions {
  /** Any string; hashed to a uint32 with `hashSeed`. Same options ⇒ identical world. */
  seed: string;
  preset: MapPreset;
  mapSize: MapSize;
  colonyName: string;
  difficulty: Difficulty;
}

/** Player actions. Speed and pause are not commands: they are loop settings (src/game). */
export type PlayerCommand =
  | { type: 'placeBuilding'; buildingType: BuildingType; x: number; y: number }
  /** Remove a construction site; delivered materials are refunded. */
  | { type: 'cancelBuilding'; buildingId: EntityId }
  /** Remove a completed building; partial refund per balance.ts. The town center cannot be demolished. */
  | { type: 'demolishBuilding'; buildingId: EntityId }
  | { type: 'setPriority'; category: JobCategory; level: PriorityLevel }
  | { type: 'renameColony'; name: string }
  /** Answer a PendingDecision. */
  | { type: 'resolveEvent'; eventId: number; accept: boolean }
  /** Dismiss the victory screen: status returns to 'playing' and the colony continues as a sandbox. */
  | { type: 'acknowledgeVictory' };
export type PlayerCommandType = PlayerCommand['type'];

export type CommandError =
  | 'gameOver'
  | 'outOfBounds'
  | 'blocked'
  | 'invalidTerrain'
  | 'missingNearbyResource'
  | 'insufficientResources'
  | 'notPlaceable'
  | 'locked'
  | 'notFound'
  | 'invalidState'
  | 'invalidArgument';

export type CommandResult =
  | { ok: true; events: SimEvent[]; entityId: EntityId | null }
  | { ok: false; error: CommandError; message: string };

/** Result of `canPlaceBuilding`; `tiles` lets the renderer colour each ghost tile. */
export interface PlacementCheck {
  ok: boolean;
  error: CommandError | null;
  message: string | null;
  tiles: { x: number; y: number; ok: boolean }[];
}

/**
 * Transient notifications produced by `stepGame` / `applyCommand`. Not stored in GameState.
 * Renderer uses them for particles/effects, UI for toasts and sounds. Consumers must ignore
 * unknown `type`s so new events can be added without breaking them.
 */
export type SimEvent =
  | { type: 'resourceGathered'; settlerId: EntityId; resource: ResourceType; amount: number; x: number; y: number }
  | { type: 'resourceDelivered'; settlerId: EntityId; buildingId: EntityId; resource: ResourceType; amount: number }
  | { type: 'resourceProduced'; buildingId: EntityId; resource: ResourceType; amount: number }
  | { type: 'resourceConsumed'; resource: ResourceType; amount: number; reason: string }
  /** A builder applied a burst of work (hammer particles). */
  | { type: 'constructionWork'; settlerId: EntityId; buildingId: EntityId }
  | { type: 'tileChanged'; x: number; y: number }
  | { type: 'buildingPlaced'; buildingId: EntityId; buildingType: BuildingType }
  /** Goods were destroyed because the storage was full (a cancelled task, a refund, a trade or a cache). */
  | { type: 'goodsLost'; resource: ResourceType; amount: number; reason: string }
  | { type: 'buildingCompleted'; buildingId: EntityId; buildingType: BuildingType }
  /** A completed building was damaged (storm, wildfire) and went back to construction as a repair. */
  | { type: 'buildingDamaged'; buildingId: EntityId; buildingType: BuildingType; cause: string }
  /** A damaged building finished its repair (not a new completion). */
  | { type: 'buildingRepaired'; buildingId: EntityId; buildingType: BuildingType }
  | { type: 'buildingRemoved'; buildingId: EntityId; buildingType: BuildingType; reason: 'cancelled' | 'demolished' | 'destroyed' }
  /** Deprecated: the design has no births, so this is never emitted. */
  | { type: 'settlerBorn'; settlerId: EntityId }
  | { type: 'settlerArrived'; settlerId: EntityId }
  | { type: 'settlerDied'; settlerId: EntityId; name: string; cause: string; x: number; y: number }
  | { type: 'needCritical'; settlerId: EntityId; need: NeedType }
  | { type: 'weatherChanged'; from: WeatherKind; to: WeatherKind }
  | { type: 'randomEvent'; kind: RandomEventKind; message: string; severity: LogSeverity }
  | { type: 'dayStarted'; day: number }
  | { type: 'seasonChanged'; season: Season }
  | { type: 'priorityChanged'; category: JobCategory; level: PriorityLevel }
  | { type: 'decisionPending'; eventId: number; kind: RandomEventKind; message: string }
  | { type: 'objectiveCompleted'; objectiveId: string; message: string }
  | { type: 'buildingUnlocked'; buildingType: BuildingType }
  /** A settler left the colony alive (desertion). */
  | { type: 'settlerLeft'; settlerId: EntityId; name: string; reason: string }
  | { type: 'gameOver'; status: 'won' | 'lost'; reason: string };
export type SimEventType = SimEvent['type'];

/** Flattened read-only view of one tile (query helper result). */
export interface TileInfo {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number;
  resource: number;
  buildingId: EntityId | null;
}
