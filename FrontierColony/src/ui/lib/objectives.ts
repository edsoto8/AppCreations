/** Objectives from docs/GAME_DESIGN.md §11, with progress derived from the HUD snapshot. Pure. */
import { BUILDING_DEFS, BUILDING_TYPES, OBJECTIVES, OBJECTIVE_TARGETS, VICTORY, type BuildingStatus, type BuildingType } from '../../sim';

export interface ObjectiveInput {
  day: number;
  population: number;
  stock: { food: number };
  progress: { objectivesDone: readonly string[]; toolsCrafted: number };
  buildings: readonly { type: BuildingType; status: BuildingStatus }[];
  settlers: readonly { needs: { happiness: number } }[];
}

export interface ObjectiveDef {
  id: string;
  title: string;
  /** What to do, in a sentence (the sim's description without its unlock sentence). */
  hint: string;
  /** Names of the buildings this objective unlocks, or null. */
  unlocks: string | null;
  victory?: boolean;
}

const unlocksOf = (id: string): string | null => {
  const names = BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].unlockedBy === id).map((t) => BUILDING_DEFS[t].name);
  return names.length ? names.join(', ') : null;
};

/** The sim's objective list (titles, descriptions, order) plus what each unlocks, derived from the building definitions. */
export const OBJECTIVE_LIST: readonly ObjectiveDef[] = OBJECTIVES.map((o) => ({
  id: o.id,
  title: o.title,
  hint: o.description.replace(/\s*Unlocks[^.]*\./, '').trim(),
  unlocks: unlocksOf(o.id),
  ...(o.id === 'thriving' ? { victory: true } : {}),
}));


export interface ObjectiveProgress {
  current: number;
  target: number;
  /** Short readout such as "7/10". */
  label: string;
}

const completeCount = (b: ObjectiveInput['buildings'], type: BuildingType) => b.filter((x) => x.type === type && x.status === 'complete').length;

/** Progress toward one objective (0..target, clamped). */
export function objectiveProgress(id: string, s: ObjectiveInput): ObjectiveProgress {
  const make = (current: number, target: number, label?: string): ObjectiveProgress => {
    const c = Math.max(0, Math.min(target, current));
    return { current: c, target, label: label ?? `${Math.floor(c)}/${target}` };
  };
  switch (id) {
    case 'roof':
      return make(completeCount(s.buildings, 'house'), 1);
    case 'bread':
      return make(completeCount(s.buildings, 'farm'), 1);
    case 'water':
      return make(completeCount(s.buildings, 'well'), 1);
    case 'foundations':
      return make(s.buildings.filter((b) => b.type !== 'townCenter' && b.status === 'complete').length, OBJECTIVE_TARGETS.foundationsBuildings);
    case 'timber':
      return make((completeCount(s.buildings, 'lumberCamp') > 0 ? 1 : 0) + (completeCount(s.buildings, 'mine') > 0 ? 1 : 0), 2);
    case 'toolmaker':
      return make(s.progress.toolsCrafted, OBJECTIVE_TARGETS.toolsCrafted);
    case 'growing':
      return make(s.population, OBJECTIVE_TARGETS.growingPopulation, `${s.population}/${OBJECTIVE_TARGETS.growingPopulation}`);
    case 'larder': {
      const target = Math.max(1, s.population * OBJECTIVE_TARGETS.larderFoodPerSettler);
      return make(s.stock.food, target, `${Math.floor(s.stock.food)}/${target} food`);
    }
    case 'winter':
      return make(s.day, OBJECTIVE_TARGETS.winterDay, `Day ${s.day}/${OBJECTIVE_TARGETS.winterDay}`);
    case 'thriving': {
      const avg = s.settlers.length ? s.settlers.reduce((a, x) => a + x.needs.happiness, 0) / s.settlers.length : 0;
      return make(s.population, VICTORY.population, `${s.population}/${VICTORY.population} settlers · mood ${Math.round(avg)}/${VICTORY.minAvgHappiness}`);
    }
    default:
      return make(0, 1);
  }
}

export interface ObjectiveRow extends ObjectiveDef {
  done: boolean;
  progress: ObjectiveProgress;
}

export function objectiveRows(s: ObjectiveInput): ObjectiveRow[] {
  return OBJECTIVE_LIST.map((o) => ({ ...o, done: s.progress.objectivesDone.includes(o.id), progress: objectiveProgress(o.id, s) }));
}

/** First objective not yet done, and the next one that unlocks something. */
export function currentObjective(rows: readonly ObjectiveRow[]): ObjectiveRow | null {
  return rows.find((r) => !r.done) ?? null;
}

export function nextUnlock(rows: readonly ObjectiveRow[]): ObjectiveRow | null {
  return rows.find((r) => !r.done && r.unlocks !== null) ?? null;
}

/** Ids that are in `now` but were not in `before`. */
export function newlyDone(before: ReadonlySet<string>, now: readonly string[]): string[] {
  return now.filter((id) => !before.has(id));
}
