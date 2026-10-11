/**
 * Settler needs, mood and work-speed formulas (GAME_DESIGN §2, §3.3, §4).
 *
 * Everything here is a pure function of the state or a mutation of one settler. The per-tick
 * orchestration (tasks, movement, decisions) lives in settlerSim.ts.
 */
import {
  DAY_PHASES,
  DIFFICULTY,
  ENERGY_DECAY,
  EVENTS,
  HAPPINESS,
  HEALTH,
  HUNGER_DECAY,
  LIGHT_WORK_MULT,
  MOODLETS,
  MOODLET_THRESHOLDS,
  MOOD_BANDS,
  NIGHT_WALK_MULT,
  OUTDOOR_JOBS,
  PERSONAL_NIGHT_WINDOW,
  SEASON_ENERGY_DECAY_MULT,
  SETTLER_WALK_SPEED,
  SKILL_SPEED,
  SLEEP_RESTORE,
  CARRYING_WALK_MULT,
  TOOLS,
  TRAIT_EFFECTS,
  WEATHER_EFFECTS,
  type DifficultyDef,
  type MoodBandDef,
} from './balance';
import { NEED_MAX, TICK_SECONDS } from './constants';
import type { GameState, JobCategory, Season, Settler, SimEvent, SkillType, TraitId, WeatherKind } from './types';

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Everything the per-tick settler code needs that is the same for all settlers. */
export interface TickContext {
  state: GameState;
  events: SimEvent[];
  /** Game hours per tick. */
  dt: number;
  /** Clock hour [0, 24). */
  hour: number;
  tick: number;
  /** True on the tick that crossed an hour boundary. */
  newHour: boolean;
  diff: DifficultyDef;
  weather: (typeof WEATHER_EFFECTS)[WeatherKind];
  weatherKind: WeatherKind;
  season: Season;
  phase: DayPhase;
  coldSnap: boolean;
  wolves: boolean;
  /** A drought is active (farms and wells slower, no rain). */
  drought: boolean;
  /** A bountiful harvest is active (farms faster). */
  bountiful: boolean;
  /** The harvest festival is on: everyone gathers at the town center. */
  festival: boolean;
}

export function dayPhase(hour: number): DayPhase {
  if (hour >= DAY_PHASES.nightStart || hour < DAY_PHASES.dawnStart) return 'night';
  if (hour < DAY_PHASES.dayStart) return 'dawn';
  if (hour < DAY_PHASES.duskStart) return 'day';
  return 'dusk';
}

export function makeContext(state: GameState, events: SimEvent[], dt: number, newHour: boolean): TickContext {
  const weatherKind = state.weather.current;
  let coldSnap = false;
  let wolves = false;
  let drought = false;
  let bountiful = false;
  let festival = false;
  for (const e of state.activeEvents) {
    if (e.kind === 'coldSnap') coldSnap = true;
    else if (e.kind === 'wolves') wolves = true;
    else if (e.kind === 'drought') drought = true;
    else if (e.kind === 'bountifulHarvest') bountiful = true;
    else if (e.kind === 'harvestFestival') festival = true;
  }
  return {
    state,
    events,
    dt,
    hour: state.time.timeOfDay,
    tick: state.time.tick,
    newHour,
    diff: DIFFICULTY[state.meta.difficulty],
    weather: WEATHER_EFFECTS[weatherKind],
    weatherKind,
    season: state.time.season,
    phase: dayPhase(state.time.timeOfDay),
    coldSnap,
    wolves,
    drought,
    bountiful,
    festival,
  };
}

export function hasTrait(s: Settler, trait: TraitId): boolean {
  return s.traits.includes(trait);
}

/** The settler's personal night window [start, end) contains the hour. */
export function inNightWindow(s: Settler, hour: number): boolean {
  const [start, end] = hasTrait(s, 'nightOwl')
    ? PERSONAL_NIGHT_WINDOW.nightOwl
    : hasTrait(s, 'earlyBird')
      ? PERSONAL_NIGHT_WINDOW.earlyBird
      : PERSONAL_NIGHT_WINDOW.default;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function moodBand(happiness: number): MoodBandDef {
  for (const band of MOOD_BANDS) if (happiness >= band.min) return band;
  return MOOD_BANDS[MOOD_BANDS.length - 1] as MoodBandDef;
}

export function skillMult(level: number): number {
  return SKILL_SPEED.base + SKILL_SPEED.perLevel * level;
}

export function isOutdoorJob(category: JobCategory): boolean {
  return OUTDOOR_JOBS.includes(category);
}

/** Light multiplier for outdoor work, honouring night owls and early birds. */
export function lightMult(ctx: TickContext, s: Settler): number {
  if (ctx.phase === 'day') return 1;
  if (hasTrait(s, 'nightOwl')) return 1;
  if (hasTrait(s, 'earlyBird') && ctx.phase === 'dawn') return 1;
  return LIGHT_WORK_MULT[ctx.phase];
}

/** Full work-speed multiplier (everything in GAME_DESIGN §6.3 except the building's own bonus). */
export function workSpeedMult(ctx: TickContext, s: Settler, category: JobCategory, skill: SkillType): number {
  let m = skillMult(s.skills[skill]);
  if (s.toolDurability !== null && TOOLS.usedBy.includes(category)) m *= TOOLS.productivityMult;
  if (hasTrait(s, 'hardworking')) m *= TRAIT_EFFECTS.hardworking.workSpeed;
  else if (hasTrait(s, 'lazy')) m *= TRAIT_EFFECTS.lazy.workSpeed;
  if (hasTrait(s, 'clumsy') && (skill === 'construction' || skill === 'crafting')) m *= TRAIT_EFFECTS.clumsy.constructionSpeed;
  m *= moodBand(s.needs.happiness).workMult;
  if (s.status.sickHoursLeft > 0) m *= HEALTH.sickWorkMult;
  else if (s.needs.health < HEALTH.hurtBelow) m *= HEALTH.hurtWorkMult;
  if (isOutdoorJob(category)) m *= lightMult(ctx, s) * ctx.weather.outdoorWork;
  return m * ctx.diff.productionMult;
}

/** Tiles walked per tick on terrain with move cost 1 (all modifiers except terrain). */
export function walkSpeedPerTick(ctx: TickContext, s: Settler): number {
  let v = SETTLER_WALK_SPEED * TICK_SECONDS;
  if (hasTrait(s, 'nimble')) v *= TRAIT_EFFECTS.nimble.walkSpeed;
  else if (hasTrait(s, 'clumsy')) v *= TRAIT_EFFECTS.clumsy.walkSpeed;
  if (s.carrying) v *= CARRYING_WALK_MULT;
  if (ctx.phase === 'night') v *= NIGHT_WALK_MULT;
  return v * ctx.weather.walk;
}

/** Is a task one that counts as "working" for energy decay and the worked-hours counter. */
export function isWorkTask(kind: Settler['task']['kind']): boolean {
  return kind === 'gather' || kind === 'haul' || kind === 'construct' || kind === 'work';
}

export function isSleepTask(kind: Settler['task']['kind']): boolean {
  return kind === 'sleep' || kind === 'rest';
}

function damageMult(ctx: TickContext, s: Settler): number {
  let m = ctx.diff.healthDamageMult;
  if (hasTrait(s, 'tough')) m *= TRAIT_EFFECTS.tough.healthDamage;
  else if (hasTrait(s, 'frail')) m *= TRAIT_EFFECTS.frail.healthDamage;
  return m;
}

function addDamage(ctx: TickContext, s: Settler, cause: string, perHour: number): void {
  const amount = perHour * damageMult(ctx, s) * ctx.dt;
  s.needs.health -= amount;
  s.status.damageLog[cause] = (s.status.damageLog[cause] ?? 0) + amount;
}

/** Sum of the moodlet values plus the trait baseline: the happiness the settler drifts toward. */
export function happinessTarget(s: Settler): number {
  let t: number = HAPPINESS.baseTarget;
  if (hasTrait(s, 'cheerful')) t += TRAIT_EFFECTS.cheerful.happinessBaseline;
  else if (hasTrait(s, 'gloomy')) t += TRAIT_EFFECTS.gloomy.happinessBaseline;
  if (hasTrait(s, 'loner')) t += TRAIT_EFFECTS.loner.happinessBaseline;
  for (let i = 0; i < s.moodlets.length; i++) t += (s.moodlets[i] as Settler['moodlets'][number]).value;
  return t < 0 ? 0 : t > 100 ? 100 : t;
}

/**
 * Advance hunger, energy, health and happiness by one tick.
 * `asleep` = the settler is actually sleeping/resting (not just walking to bed), `inBed` = in a house or town-center bed.
 */
export function updateNeeds(ctx: TickContext, s: Settler, asleep: boolean, inBed: boolean): void {
  const n = s.needs;
  const dt = ctx.dt;

  // Hunger: always, including asleep.
  let hungerRate = HUNGER_DECAY * ctx.diff.needDecayMult;
  if (hasTrait(s, 'glutton')) hungerRate *= TRAIT_EFFECTS.glutton.hungerDecay;
  else if (hasTrait(s, 'frugal')) hungerRate *= TRAIT_EFFECTS.frugal.hungerDecay;
  n.hunger -= hungerRate * dt;
  if (n.hunger < 0) n.hunger = 0;

  // Energy.
  if (asleep) {
    n.energy += (inBed ? SLEEP_RESTORE.bed : SLEEP_RESTORE.outdoors) * dt;
    if (n.energy > NEED_MAX) n.energy = NEED_MAX;
  } else {
    let rate = isWorkTask(s.task.kind) ? ENERGY_DECAY.working : ENERGY_DECAY.awakeOther;
    rate *= SEASON_ENERGY_DECAY_MULT[ctx.season] * ctx.weather.energyDecay * ctx.diff.needDecayMult;
    if (ctx.coldSnap) rate *= EVENTS.coldSnap.energyDecayMult;
    if (hasTrait(s, 'hardworking')) rate *= TRAIT_EFFECTS.hardworking.energyDecay;
    else if (hasTrait(s, 'lazy')) rate *= TRAIT_EFFECTS.lazy.energyDecay;
    n.energy -= rate * dt;
    if (n.energy < 0) n.energy = 0;
  }

  // Health: damage sources, then regeneration.
  const status = s.status;
  if (n.hunger < HEALTH.starvingBelowHunger) addDamage(ctx, s, 'starvation', HEALTH.starvingDamage);
  if (status.dehydrated) addDamage(ctx, s, 'thirst', HEALTH.dehydratedDamage);
  if (n.energy <= 0) addDamage(ctx, s, 'exhaustion', HEALTH.exhaustedDamage);
  if (status.sickHoursLeft > 0) addDamage(ctx, s, 'sickness', HEALTH.sickDamage);
  if (asleep && !inBed && ctx.season === 'winter') {
    addDamage(ctx, s, 'cold', ctx.coldSnap ? HEALTH.coldSnapNightDamage : HEALTH.coldNightDamage);
  }
  if (
    n.hunger >= HEALTH.regenMinHunger &&
    n.energy >= HEALTH.regenMinEnergy &&
    !status.dehydrated &&
    status.sickHoursLeft <= 0
  ) {
    let regen = asleep && inBed ? HEALTH.regenInBed : HEALTH.regen;
    if (hasTrait(s, 'frail')) regen *= TRAIT_EFFECTS.frail.healthRegen;
    n.health += regen * dt;
  }
  if (n.health > NEED_MAX) n.health = NEED_MAX;

  // Happiness drifts toward its target.
  const target = happinessTarget(s);
  const step = HAPPINESS.driftPerHour * dt;
  if (n.happiness < target) n.happiness = Math.min(target, n.happiness + step);
  else if (n.happiness > target) n.happiness = Math.max(target, n.happiness - step);

  // Timers.
  if (status.sickHoursLeft > 0) status.sickHoursLeft = Math.max(0, status.sickHoursLeft - dt);
  if (status.drinkCooldownHours > 0) status.drinkCooldownHours = Math.max(0, status.drinkCooldownHours - dt);
  if (status.sulkHoursLeft > 0) status.sulkHoursLeft = Math.max(0, status.sulkHoursLeft - dt);
  for (let i = s.moodlets.length - 1; i >= 0; i--) {
    const m = s.moodlets[i] as Settler['moodlets'][number];
    if (m.hoursLeft === null) continue;
    m.hoursLeft -= dt;
    if (m.hoursLeft <= 0) s.moodlets.splice(i, 1);
  }
  if (isWorkTask(s.task.kind) && s.task.phase !== 'moving') status.hoursWorkedSinceWake += dt;
  if (n.happiness < 15) status.breakingHours += dt;
  else status.breakingHours = 0;
}

/** Hourly: rebuild the state moodlets (the ones with `hoursLeft === null`). */
export function evaluateStateMoodlets(ctx: TickContext, s: Settler): void {
  const state = ctx.state;
  const keep = s.moodlets.filter((m) => m.hoursLeft !== null);
  const add = (id: string) => keep.push({ id, value: (MOODLETS[id] as { value: number }).value, hoursLeft: null });
  const n = s.needs;
  if (n.hunger < MOODLET_THRESHOLDS.starvingBelow) add('starving');
  else if (n.hunger < MOODLET_THRESHOLDS.hungryBelow) add('hungry');
  if (s.status.dehydrated) add('dehydrated');
  if (n.energy < MOODLET_THRESHOLDS.tiredBelow) add('tired');
  if (n.health < HEALTH.hurtBelow) add('hurt');
  if (s.status.sickHoursLeft > 0) add('sick');
  if (!hasTrait(s, 'tough')) {
    if (ctx.weatherKind === 'rain') add('rain');
    else if (ctx.weatherKind === 'storm') add('storm');
    else if (ctx.weatherKind === 'snow') add('snow');
  }
  if (ctx.weatherKind === 'clear' && ctx.phase !== 'night') add('fineWeather');
  if (hasTrait(s, 'sociable')) {
    const last = s.status.lastSocializedTick ?? 0;
    const hoursSince = (ctx.tick - last) * ctx.dt;
    if (hoursSince >= MOODLET_THRESHOLDS.lonelyAfterHours) add('lonely');
  }
  if (s.status.hoursWorkedSinceWake >= MOODLET_THRESHOLDS.overworkedHours) add('overworked');
  const pop = state.settlers.length;
  const stock = state.colony.stock;
  if (stock.food === 0) add('emptyLarder');
  else if (
    stock.food >= pop * 2 * MOODLET_THRESHOLDS.fullLarderFoodDays &&
    stock.water >= pop * 2 * MOODLET_THRESHOLDS.fullLarderWaterDays
  ) {
    add('fullLarder');
  }
  if (hasTrait(s, 'glutton') && n.hunger >= 70) add('wellFed');
  if (ctx.wolves) add('wolves');
  s.moodlets = keep;
}
