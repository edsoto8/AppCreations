import {
  BUILDING_DEFS,
  DEFAULT_NEW_GAME_OPTIONS,
  canAfford,
  getAvailableStock,
  applyCommand,
  canPlaceBuilding,
  createGame,
  stepGame,
  type BuildingType,
  type GameState,
  type MapPreset,
  type SimEvent,
} from '../../../src/sim';

/** Place a building at the valid spot nearest the town center (ring search). Returns the building id or null. */
export function placeNearTown(state: GameState, type: BuildingType, minRing = 3, maxRing = 16): number | null {
  // Cheap rejections first: a locked type or an order the stock cannot cover is not worth a map scan.
  if (!state.progress.unlocked.includes(type)) return null;
  const avail = getAvailableStock(state);
  const cost = BUILDING_DEFS[type].cost;
  if (!canAfford(avail, cost)) return null;
  const town = state.buildings[0]!.origin;
  for (let r = minRing; r <= maxRing; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = town.x + dx;
        const y = town.y + dy;
        if (!canPlaceBuilding(state, type, x, y).ok) continue;
        const result = applyCommand(state, { type: 'placeBuilding', buildingType: type, x, y });
        if (result.ok) return result.entityId;
      }
    }
  }
  return null;
}

export interface ScriptItem {
  /** In-game day (1-based) from which to try placing. */
  day: number;
  type: BuildingType;
}

export interface Snapshot {
  day: number;
  hour: number;
  pop: number;
  stock: GameState['colony']['stock'];
}

export interface RunReport {
  state: GameState;
  /** Day (fractional, 1 = start) at which each placed building completed, in completion order. */
  completed: { type: BuildingType; id: number; placedDay: number; doneDay: number }[];
  checkpoints: Snapshot[];
  minFood: number;
  minWater: number;
  events: SimEvent[];
}

const TICKS_PER_DAY = 1800;

/** Play a scripted game: place each item once its day has come (and it is affordable), run for `days`. */
export function playScript(
  options: { seed: string; preset: MapPreset; difficulty?: 'relaxed' | 'normal' | 'harsh' },
  script: ScriptItem[],
  days: number,
  checkpointDays: number[],
  hooks: { every?: number; onTick?: (state: GameState, tick: number) => void } = {},
): RunReport {
  const state = createGame({ ...DEFAULT_NEW_GAME_OPTIONS, seed: options.seed, preset: options.preset, difficulty: options.difficulty ?? 'normal' });
  const pending = [...script];
  const placedDay = new Map<number, number>();
  const completed: RunReport['completed'] = [];
  const checkpoints: Snapshot[] = [];
  const events: SimEvent[] = [];
  let minFood = Infinity;
  let minWater = Infinity;
  const dayNow = () => state.time.day + state.time.timeOfDay / 24;
  for (let tick = 0; tick < days * TICKS_PER_DAY; tick++) {
    if (tick % 100 === 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const item = pending[i]!;
        if (state.time.day < item.day) continue;
        const id = placeNearTown(state, item.type);
        if (id !== null) {
          placedDay.set(id, dayNow());
          pending.splice(i, 1);
        }
      }
    }
    const ev = stepGame(state);
    for (const e of ev) {
      events.push(e);
      if (e.type === 'buildingCompleted') {
        completed.push({ type: e.buildingType, id: e.buildingId, placedDay: placedDay.get(e.buildingId) ?? 0, doneDay: dayNow() });
      }
    }
    hooks.onTick?.(state, tick);
    if (tick % 75 === 0) {
      minFood = Math.min(minFood, state.colony.stock.food);
      minWater = Math.min(minWater, state.colony.stock.water);
    }
    if (tick % TICKS_PER_DAY === 0 && checkpointDays.includes(state.time.day)) {
      checkpoints.push({ day: state.time.day, hour: state.time.timeOfDay, pop: state.settlers.length, stock: { ...state.colony.stock } });
    }
  }
  return { state, completed, checkpoints, minFood, minWater, events };
}
