/**
 * HUD snapshot: a small, detached copy of the parts of GameState the React UI shows.
 * The game loop publishes one every ~150 ms (SNAPSHOT_INTERVAL_MS), so React re-renders at
 * ~6–7 Hz instead of 60 fps, and never holds references into the mutable GameState.
 */
import {
  BUILDING_DEFS,
  getHousingCapacity,
  getResourceRates,
  getStorageCapacity,
  type Activity,
  type ActiveRandomEvent,
  type BuildingStatus,
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

export interface SettlerSummary {
  id: EntityId;
  name: string;
  joinedDay: number;
  traits: TraitId[];
  skills: Skills;
  needs: Needs;
  activity: Activity;
  carrying: Carrying | null;
  homeId: EntityId | null;
  workplaceId: EntityId | null;
  xp: Skills;
  moodlets: Moodlet[];
  status: SettlerStatus;
  toolDurability: number | null;
  /** Current position in tile units (for "centre camera on settler"). */
  pos: Vec2;
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
  stats: { births: number; arrivals: number; deaths: number; peakPopulation: number; buildingsCompleted: number };
}

const clone = <T>(v: T): T => structuredClone(v);

/** Build a detached snapshot (no shared references with `state`). Pure. */
export function buildHudSnapshot(state: Readonly<GameState>): HudSnapshot {
  const s = state;
  return {
    tick: s.time.tick,
    day: s.time.day,
    timeOfDay: s.time.timeOfDay,
    season: s.time.season,
    colonyName: s.colony.name,
    weather: { current: s.weather.current, intensity: s.weather.intensity },
    stock: { ...s.colony.stock },
    storageCapacity: getStorageCapacity(s),
    rates: getResourceRates(s),
    population: s.settlers.length,
    housingCapacity: getHousingCapacity(s),
    priorities: { ...s.colony.priorities },
    settlers: s.settlers.map((st) => ({
      id: st.id,
      name: st.name,
      joinedDay: st.joinedDay,
      traits: [...st.traits],
      skills: { ...st.skills },
      needs: { ...st.needs },
      activity: clone(st.activity),
      carrying: st.carrying ? { ...st.carrying } : null,
      homeId: st.homeId,
      workplaceId: st.workplaceId,
      xp: { ...st.xp },
      moodlets: clone(st.moodlets),
      status: clone(st.status),
      toolDurability: st.toolDurability,
      pos: { x: st.pos.x, y: st.pos.y },
    })),
    buildings: s.buildings.map((b) => {
      const def = BUILDING_DEFS[b.type];
      return {
        id: b.id,
        type: b.type,
        name: def.name,
        origin: { ...b.origin },
        footprint: { ...b.footprint },
        status: b.status,
        constructionProgress: b.construction ? b.construction.progress : 1,
        productionProgress: b.productionProgress,
        workerIds: [...b.workerIds],
        maxWorkers: def.maxWorkers,
        residentIds: [...b.residentIds],
        housing: def.housing,
      };
    }),
    activeEvents: clone(s.activeEvents),
    recentLog: clone(s.eventLog.slice(-SNAPSHOT_LOG_ENTRIES)),
    outcome: { ...s.outcome },
    pendingDecisions: clone(s.pendingDecisions),
    progress: clone(s.progress),
    stats: {
      births: s.stats.births,
      arrivals: s.stats.arrivals,
      deaths: s.stats.deaths,
      peakPopulation: s.stats.peakPopulation,
      buildingsCompleted: s.stats.buildingsCompleted,
    },
  };
}
