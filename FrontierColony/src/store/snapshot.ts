/**
 * HUD snapshot: a small, detached copy of the parts of GameState the React UI shows.
 * The game loop publishes one every ~150 ms (SNAPSHOT_INTERVAL_MS), so React re-renders at
 * ~6–7 Hz instead of 60 fps, and never holds references into the mutable GameState.
 */
import type { Selection } from '../shared/types';
import {
  BUILDING_DEFS,
  RESOURCE_TYPES,
  emptyResources,
  getHousingCapacity,
  getAvailableStock,
  getOutstandingMaterials,
  getStorageCapacity,
  type Activity,
  type Appearance,
  type ActiveRandomEvent,
  type BuildingStatus,
  type ConstructionState,
  type BuildingType,
  type Carrying,
  type EntityId,
  type Footprint,
  type GameOutcome,
  type GameState,
  type LogEntry,
  type Moodlet,
  type Needs,
  type PendingDecision,
  type Priorities,
  type ProgressState,
  type ResourceAmounts,
  type Season,
  type SettlerStatus,
  type Skills,
  type TilePos,
  type TraitId,
  type Vec2,
  type WeatherKind,
} from '../sim';

export const SNAPSHOT_INTERVAL_MS = 150;
/** Log entries copied into each snapshot (newest last). */
export const SNAPSHOT_LOG_ENTRIES = 50;

/** Roster-level facts about every settler. Kept small: the heavy detail is only built for the selection. */
export interface SettlerSummary {
  id: EntityId;
  name: string;
  joinedDay: number;
  traits: TraitId[];
  needs: Needs;
  activity: Activity;
  homeId: EntityId | null;
  workplaceId: EntityId | null;
  appearance: Appearance;
  /** A tool is currently held (see `toolDurability` in the detail). */
  hasTool: boolean;
  sick: boolean;
  dehydrated: boolean;
  /** Current position in tile units (for "centre camera on settler"). */
  pos: Vec2;
}

/** Everything the settler inspector shows. Built only for the selected settler. */
export interface SettlerDetail extends SettlerSummary {
  skills: Skills;
  xp: Skills;
  moodlets: Moodlet[];
  carrying: Carrying | null;
  /** Durability left on the held tool (worker-hours), or null. */
  toolDurability: number | null;
  status: SettlerStatus;
  homeName: string | null;
  workplaceName: string | null;
}

export interface BuildingSummary {
  id: EntityId;
  type: BuildingType;
  name: string;
  origin: TilePos;
  footprint: Footprint;
  status: BuildingStatus;
  /** Construction progress 0..1 (1 when complete). */
  constructionProgress: number;
  /** Production cycle progress 0..1 (0 for non-producers). */
  productionProgress: number;
  workerIds: EntityId[];
  maxWorkers: number;
  residentIds: EntityId[];
  housing: number;
}

export interface NamedId {
  id: EntityId;
  name: string;
}

/** Everything the building inspector shows. Built only for the selected building. */
export interface BuildingDetail extends BuildingSummary {
  /** Non-null while a site is being built or repaired. */
  construction: { kind: ConstructionState['kind']; progress: number; required: ResourceAmounts; delivered: ResourceAmounts } | null;
  /** Goods waiting to be hauled away. */
  output: ResourceAmounts;
  workers: NamedId[];
  residents: NamedId[];
}

export interface HudSnapshot {
  tick: number;
  day: number;
  /** Hours [0, 24). */
  timeOfDay: number;
  season: Season;
  colonyName: string;
  weather: { current: WeatherKind; intensity: number };
  stock: ResourceAmounts;
  /** Per-resource capacity. */
  storageCapacity: number;
  /** Materials construction sites have reserved but not yet received. */
  reserved: ResourceAmounts;
  /** Stock minus `reserved`: what can still be spent on new orders (use this for affordability). */
  available: ResourceAmounts;
  /** Net change per in-game day. */
  rates: ResourceAmounts;
  population: number;
  housingCapacity: number;
  priorities: Priorities;
  settlers: SettlerSummary[];
  buildings: BuildingSummary[];
  activeEvents: ActiveRandomEvent[];
  recentLog: LogEntry[];
  outcome: GameOutcome;
  pendingDecisions: PendingDecision[];
  progress: ProgressState;
  /** Detail of the selected settler / building (null when the selection is something else). */
  selectedSettler: SettlerDetail | null;
  selectedBuilding: BuildingDetail | null;
  stats: { births: number; arrivals: number; deaths: number; peakPopulation: number; buildingsCompleted: number };
}

const clone = <T>(v: T): T => structuredClone(v);

/** Samples of `stats.history` (one per in-game hour) used for the per-day rates. */
export const RATE_WINDOW_HOURS = 24;

/**
 * Net change per in-game day = (produced - consumed) over the last 24 hourly samples plus the current
 * partial hour, scaled to 24 h (docs/GAME_DESIGN.md §15). One-off spending such as construction
 * costs is not recorded as consumption, so it does not distort the rate. Zero until a full hour of
 * data exists.
 */
export function computeNetRates(state: Readonly<GameState>): ResourceAmounts {
  const rates = emptyResources();
  const history = state.stats.history.slice(-RATE_WINDOW_HOURS);
  const partial = state.time.timeOfDay - Math.floor(state.time.timeOfDay);
  const elapsed = history.length + partial;
  if (elapsed < 1) return rates;
  for (const r of RESOURCE_TYPES) {
    let net = (state.stats.producedThisHour[r] ?? 0) - (state.stats.consumedThisHour[r] ?? 0);
    for (const h of history) net += (h.produced?.[r] ?? 0) - (h.consumed?.[r] ?? 0);
    rates[r] = (net / elapsed) * 24;
  }
  return rates;
}

function summarizeSettler(st: GameState['settlers'][number]): SettlerSummary {
  return {
    id: st.id,
    name: st.name,
    joinedDay: st.joinedDay,
    traits: [...st.traits],
    needs: { ...st.needs },
    activity: { ...st.activity, targetTile: st.activity.targetTile ? { ...st.activity.targetTile } : null },
    homeId: st.homeId,
    workplaceId: st.workplaceId,
    appearance: { ...st.appearance },
    hasTool: st.toolDurability !== null,
    sick: st.status.sickHoursLeft > 0,
    dehydrated: st.status.dehydrated,
    pos: { x: st.pos.x, y: st.pos.y },
  };
}

/** Detail for one settler, or null when it does not exist. Pure and detached from `state`. */
export function buildSettlerDetail(state: Readonly<GameState>, id: EntityId): SettlerDetail | null {
  const st = state.settlers.find((x) => x.id === id);
  if (!st) return null;
  const nameOf = (bid: EntityId | null): string | null => {
    if (bid === null) return null;
    const b = state.buildings.find((x) => x.id === bid);
    return b ? BUILDING_DEFS[b.type].name : null;
  };
  return {
    ...summarizeSettler(st),
    skills: { ...st.skills },
    xp: { ...st.xp },
    moodlets: clone(st.moodlets),
    carrying: st.carrying ? { ...st.carrying } : null,
    toolDurability: st.toolDurability,
    status: clone(st.status),
    homeName: nameOf(st.homeId),
    workplaceName: nameOf(st.workplaceId),
  };
}

function summarizeBuilding(
  state: Readonly<GameState>,
  b: GameState['buildings'][number],
  workers?: Map<EntityId, EntityId[]>,
  residents?: Map<EntityId, EntityId[]>,
): BuildingSummary {
  const def = BUILDING_DEFS[b.type];
  // The settler side is the source of truth for assignments (Settler.workplaceId / homeId).
  return {
    id: b.id,
    type: b.type,
    name: def.name,
    origin: { ...b.origin },
    footprint: { ...b.footprint },
    status: b.status,
    constructionProgress: b.construction ? b.construction.progress : 1,
    productionProgress: b.productionProgress,
    workerIds: workers ? (workers.get(b.id) ?? []) : state.settlers.filter((s) => s.workplaceId === b.id).map((s) => s.id),
    maxWorkers: def.maxWorkers,
    residentIds: residents ? (residents.get(b.id) ?? []) : state.settlers.filter((s) => s.homeId === b.id).map((s) => s.id),
    housing: def.housing,
  };
}

/** Detail for one building, or null when it does not exist. Pure and detached from `state`. */
export function buildBuildingDetail(state: Readonly<GameState>, id: EntityId): BuildingDetail | null {
  const b = state.buildings.find((x) => x.id === id);
  if (!b) return null;
  const summary = summarizeBuilding(state, b);
  const named = (ids: EntityId[]): NamedId[] =>
    ids.map((sid) => ({ id: sid, name: state.settlers.find((s) => s.id === sid)?.name ?? 'Settler' }));
  return {
    ...summary,
    construction: b.construction
      ? {
          kind: b.construction.kind ?? 'new',
          progress: b.construction.progress,
          required: { ...emptyResources(), ...b.construction.required },
          delivered: { ...emptyResources(), ...b.construction.delivered },
        }
      : null,
    output: { ...emptyResources(), ...b.output },
    workers: named(summary.workerIds),
    residents: named(summary.residentIds),
  };
}

/**
 * Build a detached snapshot (no shared references with `state`). Pure.
 * Pass the current selection so the snapshot carries the (more expensive) detail of just that entity.
 */
export function buildHudSnapshot(state: Readonly<GameState>, selection: Selection | null = null): HudSnapshot {
  const s = state;
  const workers = new Map<EntityId, EntityId[]>();
  const residents = new Map<EntityId, EntityId[]>();
  for (const st of s.settlers) {
    if (st.workplaceId !== null) (workers.get(st.workplaceId) ?? workers.set(st.workplaceId, []).get(st.workplaceId)!).push(st.id);
    if (st.homeId !== null) (residents.get(st.homeId) ?? residents.set(st.homeId, []).get(st.homeId)!).push(st.id);
  }
  return {
    tick: s.time.tick,
    day: s.time.day,
    timeOfDay: s.time.timeOfDay,
    season: s.time.season,
    colonyName: s.colony.name,
    weather: { current: s.weather.current, intensity: s.weather.intensity },
    stock: { ...s.colony.stock },
    storageCapacity: getStorageCapacity(s),
    reserved: getOutstandingMaterials(s),
    available: getAvailableStock(s),
    rates: computeNetRates(s),
    population: s.settlers.length,
    housingCapacity: getHousingCapacity(s),
    priorities: { ...s.colony.priorities },
    settlers: s.settlers.map(summarizeSettler),
    buildings: s.buildings.map((b) => summarizeBuilding(s, b, workers, residents)),
    activeEvents: clone(s.activeEvents),
    recentLog: clone(s.eventLog.slice(-SNAPSHOT_LOG_ENTRIES)),
    outcome: { ...s.outcome },
    pendingDecisions: clone(s.pendingDecisions),
    progress: clone(s.progress),
    selectedSettler: selection?.kind === 'settler' ? buildSettlerDetail(s, selection.id) : null,
    selectedBuilding: selection?.kind === 'building' ? buildBuildingDetail(s, selection.id) : null,
    stats: {
      births: s.stats.births,
      arrivals: s.stats.arrivals,
      deaths: s.stats.deaths,
      peakPopulation: s.stats.peakPopulation,
      buildingsCompleted: s.stats.buildingsCompleted,
    },
  };
}
