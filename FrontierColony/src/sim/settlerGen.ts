/**
 * Settler creation: names, skills, traits, needs and appearance rolled with the seeded RNG
 * (GAME_DESIGN §3). Used for the founders at game creation and, later, for newcomers.
 */
import {
  FOUNDER_SPECIALTIES,
  FOUNDER_TRAIT_LIMITS,
  MOODLETS,
  NEWCOMER_SPECIALTY_BONUS,
  NEWCOMER_START_NEEDS,
  SETTLER_START_NEEDS,
  SKILL_SPAWN,
  SPECIALTY_RANGE,
  STARTING_SETTLERS,
  TRAIT_COUNT_WEIGHTS,
  TRAIT_EXCLUSIVE_PAIRS,
} from './balance';
import { addTimedMoodlet } from './stateOps';
import { APPEARANCE_VARIANTS, NEED_MAX, SKILL_MAX } from './constants';
import { SETTLER_FIRST_NAMES, SETTLER_LAST_NAMES } from './names';
import { chance, nextInt, pick, shuffle } from './rng';
import {
  SKILL_TYPES,
  type Difficulty,
  type GameState,
  type RngState,
  type Settler,
  type SkillType,
  type TilePos,
  type TraitId,
  type Vec2,
} from './types';

/** Names already taken in this colony (living or dead), so new settlers get unique names. */
export interface NameRegistry {
  first: Set<string>;
  full: Set<string>;
}

export function createNameRegistry(existing: readonly string[] = []): NameRegistry {
  const registry: NameRegistry = { first: new Set(), full: new Set() };
  for (const name of existing) {
    registry.full.add(name);
    registry.first.add(name.split(' ')[0] ?? name);
  }
  return registry;
}

/** First name not used yet (while one is available), surname re-rolled until the full name is unique. */
export function rollName(rng: RngState, registry: NameRegistry): string {
  const unusedFirst = SETTLER_FIRST_NAMES.filter((n) => !registry.first.has(n));
  const first = pick(rng, unusedFirst.length > 0 ? unusedFirst : SETTLER_FIRST_NAMES);
  let name = `${first} ${pick(rng, SETTLER_LAST_NAMES)}`;
  for (let attempt = 0; attempt < 50 && registry.full.has(name); attempt++) {
    name = `${first} ${pick(rng, SETTLER_LAST_NAMES)}`;
  }
  registry.first.add(first);
  registry.full.add(name);
  return name;
}

/** Roll 1 trait (60%) or 2 (40%) from distinct exclusive pairs, never using a trait in `banned`. */
export function rollTraits(rng: RngState, banned: ReadonlySet<TraitId>): TraitId[] {
  const count = chance(rng, TRAIT_COUNT_WEIGHTS.two) ? 2 : 1;
  const pairs = shuffle(rng, [...TRAIT_EXCLUSIVE_PAIRS]);
  const traits: TraitId[] = [];
  for (const pair of pairs) {
    if (traits.length >= count) break;
    const options = pair.filter((t) => !banned.has(t));
    if (options.length === 0) continue;
    traits.push(pick(rng, options));
  }
  return traits;
}

/** Skill rolls: every skill 1-4, one specialty from the difficulty range, one secondary of 3-5. */
export function rollSkills(rng: RngState, difficulty: Difficulty, specialty: SkillType | null, specialtyBonus = 0): Settler['skills'] {
  const skills = Object.fromEntries(
    SKILL_TYPES.map((s) => [s, nextInt(rng, SKILL_SPAWN.baseMin, SKILL_SPAWN.baseMax)]),
  ) as Settler['skills'];
  const main = specialty ?? pick(rng, SKILL_TYPES);
  const [lo, hi] = SPECIALTY_RANGE[difficulty];
  skills[main] = Math.min(SKILL_MAX, nextInt(rng, lo, hi) + specialtyBonus);
  const secondary = pick(
    rng,
    SKILL_TYPES.filter((s) => s !== main),
  );
  skills[secondary] = Math.max(skills[secondary], nextInt(rng, SKILL_SPAWN.secondaryMin, SKILL_SPAWN.secondaryMax));
  return skills;
}

export interface SettlerSpawnOptions {
  difficulty: Difficulty;
  names: NameRegistry;
  /** Forced specialty skill, or null for a random one. */
  specialty: SkillType | null;
  /** Traits that may not be rolled (founder limits). */
  bannedTraits: ReadonlySet<TraitId>;
  /** Days elapsed since the game started when spawning a newcomer; null for a founder. */
  newcomerDays: number | null;
}

/** Create one settler at `pos`, allocating its id from `state.nextId`. Does not add it to the state. */
export function createSettler(state: GameState, rng: RngState, pos: Vec2, options: SettlerSpawnOptions): Settler {
  const name = rollName(rng, options.names);
  const traits = rollTraits(rng, options.bannedTraits);
  const bonus =
    options.newcomerDays === null
      ? 0
      : Math.min(NEWCOMER_SPECIALTY_BONUS.max, Math.floor(options.newcomerDays / NEWCOMER_SPECIALTY_BONUS.perDays));
  const skills = rollSkills(rng, options.difficulty, options.specialty, bonus);
  const needs =
    options.newcomerDays === null
      ? {
          hunger: clampNeed(SETTLER_START_NEEDS.hunger + nextInt(rng, -SETTLER_START_NEEDS.hungerEnergyJitter, SETTLER_START_NEEDS.hungerEnergyJitter)),
          energy: clampNeed(SETTLER_START_NEEDS.energy + nextInt(rng, -SETTLER_START_NEEDS.hungerEnergyJitter, SETTLER_START_NEEDS.hungerEnergyJitter)),
          happiness: SETTLER_START_NEEDS.happiness,
          health: SETTLER_START_NEEDS.health,
        }
      : { ...NEWCOMER_START_NEEDS };
  return {
    id: state.nextId++,
    name,
    joinedDay: state.time.day,
    traits,
    skills,
    needs,
    appearance: {
      skin: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
      hair: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
      shirt: nextInt(rng, 0, APPEARANCE_VARIANTS - 1),
    },
    pos: { x: pos.x, y: pos.y },
    prevPos: { x: pos.x, y: pos.y },
    facing: 'se',
    path: [],
    task: { kind: 'idle', phase: 'working', progress: 0 },
    activity: { kind: 'idle', label: 'Idle', progress: null, targetTile: null },
    carrying: null,
    homeId: null,
    workplaceId: null,
    xp: Object.fromEntries(SKILL_TYPES.map((s) => [s, 0])) as Settler['xp'],
    moodlets: [],
    status: {
      dehydrated: false,
      sickHoursLeft: 0,
      drinkCooldownHours: 0,
      breakingHours: 0,
      hoursWorkedSinceWake: 0,
      sulkHoursLeft: 0,
      lastSocializedTick: null,
      damageLog: {},
      needAlerts: { hunger: false, energy: false, happiness: false, health: false },
      sleptOutdoorsLastNight: false,
    },
    toolDurability: null,
    hoursSinceDecision: 0,
  };
}

function clampNeed(v: number): number {
  return Math.max(0, Math.min(NEED_MAX, v));
}

/**
 * Create the founders on the given spawn tiles (in order). Founders #1..#3 get the specialties in
 * `FOUNDER_SPECIALTIES`; at most one lazy and one gloomy founder (FOUNDER_TRAIT_LIMITS).
 */
export function createFounders(state: GameState, rng: RngState, spawnTiles: readonly TilePos[]): Settler[] {
  const names = createNameRegistry(state.colony.usedNames);
  const counts = new Map<TraitId, number>();
  const founders: Settler[] = [];
  const total = Math.min(STARTING_SETTLERS, spawnTiles.length);
  for (let i = 0; i < total; i++) {
    const banned = new Set<TraitId>();
    for (const [trait, limit] of Object.entries(FOUNDER_TRAIT_LIMITS) as [TraitId, number][]) {
      if ((counts.get(trait) ?? 0) >= limit) banned.add(trait);
    }
    const tile = spawnTiles[i] as TilePos;
    const settler = createSettler(state, rng, { x: tile.x + 0.5, y: tile.y + 0.5 }, {
      difficulty: state.meta.difficulty,
      names,
      specialty: FOUNDER_SPECIALTIES[i] ?? null,
      bannedTraits: banned,
      newcomerDays: null,
    });
    for (const t of settler.traits) counts.set(t, (counts.get(t) ?? 0) + 1);
    state.colony.usedNames.push(settler.name);
    founders.push(settler);
  }
  return founders;
}

/**
 * Add a newcomer at `pos`: rolls a settler with the newcomer needs and specialty bonus, records the name,
 * counts the arrival and gives everyone the `newcomer` mood bonus. The caller logs and emits the event.
 */
export function addNewcomer(state: GameState, pos: Vec2): Settler {
  const names = createNameRegistry(state.colony.usedNames);
  const settler = createSettler(state, state.rng, pos, {
    difficulty: state.meta.difficulty,
    names,
    specialty: null,
    bannedTraits: new Set(),
    newcomerDays: state.time.day - 1,
  });
  state.settlers.push(settler);
  state.colony.usedNames.push(settler.name);
  state.stats.arrivals++;
  state.stats.peakPopulation = Math.max(state.stats.peakPopulation, state.settlers.length);
  const mood = MOODLETS.newcomer as { value: number; hours: number; maxStacks: number };
  for (const s of state.settlers) addTimedMoodlet(s, 'newcomer', mood.value, mood.hours, mood.maxStacks);
  return settler;
}
