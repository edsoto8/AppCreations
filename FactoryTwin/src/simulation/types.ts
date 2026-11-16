/**
 * Shared interfaces for the Factory Twin.
 *
 * This file is the contract between the simulation (pure TypeScript, no React/Three/DOM)
 * and everything that consumes it (renderer, dashboard, optimizer, tests).
 *
 * Units: all times are SIMULATION SECONDS unless a field name says otherwise
 * (`...Min` = minutes, `...Hours` = hours). Distances are metres. Money is USD.
 * Sim time t = 0 is Day 1, 06:00 (the start of shift 1).
 */

// ---------------------------------------------------------------------------
// Identifiers and enums
// ---------------------------------------------------------------------------

export type ProductType = 'A' | 'B';
export const PRODUCT_TYPES: readonly ProductType[] = ['A', 'B'];

export type MaterialId = 'PCB' | 'ENCLOSURE' | 'SENSOR' | 'SPEAKER_DRIVER' | 'BATTERY' | 'PACKAGING_KIT';
export const MATERIAL_IDS: readonly MaterialId[] = [
  'PCB',
  'ENCLOSURE',
  'SENSOR',
  'SPEAKER_DRIVER',
  'BATTERY',
  'PACKAGING_KIT',
];

export type Priority = 'high' | 'normal' | 'low';
export type DispatchRule = 'priority-edd' | 'edd' | 'fifo';

export type StationKind = 'assembly' | 'inspection' | 'packaging' | 'palletizer';

/** Visible machine state; drives beacon colour and whether animation runs. */
export type MachineState =
  | 'closed' // outside shift hours
  | 'idle' // open, ready, nothing to do (and not starved by material)
  | 'starved' // open, waiting for input (kit, product, material)
  | 'running' // actively processing
  | 'blocked' // finished, output full
  | 'failed' // broken down, waiting for/under repair
  | 'maintenance' // preventive maintenance
  | 'unstaffed'; // open but no operator present

export type ConveyorState = 'running' | 'stopped' | 'failed' | 'closed';

export type ProductStage =
  | 'released' // released to a cell, kit waiting to be picked
  | 'kit-transport' // kit on an AGV
  | 'awaiting-assembly' // kit in cell buffer
  | 'assembly'
  | 'to-inspection' // on C1 conveyor or infeed table
  | 'inspection'
  | 'rework-wait' // rejected, waiting in reject bin
  | 'rework-transport' // on AGV back to a cell
  | 'to-packaging'
  | 'packaging'
  | 'to-palletizer'
  | 'palletizing'
  | 'finished' // on a pallet (in palletizer, on forklift or in FG storage)
  | 'shipped'
  | 'scrapped';

export type QualityStatus = 'unknown' | 'passed' | 'rejected-once' | 'passed-after-rework' | 'scrapped';

export type VehicleKind = 'agv' | 'forklift';
export type VehicleState =
  | 'idle'
  | 'to-pickup'
  | 'loading'
  | 'to-dropoff'
  | 'unloading'
  | 'returning'
  | 'queued' // waiting for an occupied pickup/drop-off point
  | 'failed'
  | 'off-shift';

export type WorkerRole = 'assembler' | 'inspector' | 'packer' | 'driver' | 'floater' | 'technician';
export type WorkerState = 'off-shift' | 'walking' | 'working' | 'idle' | 'on-break' | 'absent' | 'repairing';

export type ShiftIndex = 0 | 1;

// ---------------------------------------------------------------------------
// Configuration (what a scenario parameterises)
// ---------------------------------------------------------------------------

/** Triangular distribution in the field's own unit. */
export interface Tri {
  min: number;
  mode: number;
  max: number;
}

export interface MaterialSpec {
  unitCost: number;
  initialStock: number;
  reorderPoint: number;
  orderQty: number;
  /** Supplier lead time in hours. */
  leadTimeHours: Tri;
}

export interface ProductSpec {
  name: string;
  bom: Partial<Record<MaterialId, number>>;
  /** Mean assembly process time (machine only, excludes robot handling). */
  assemblyTimeSec: number;
  /** Selling price, used for throughput value. */
  price: number;
  /** Share of order arrivals, 0..1. */
  mix: number;
}

export interface FailureSpec {
  /** Mean busy (operating) hours between failures. 0 disables random failures. */
  mtbfHours: number;
  /** Mean time to repair once a technician is on site. */
  mttrMin: number;
  /** Weibull shape for time-to-failure (1 = exponential, >1 = wear-out). */
  weibullShape: number;
}

export interface AssemblyConfig {
  cells: number;
  /** Robot pick kit -> machine (load) seconds. */
  robotLoadSec: number;
  /** Robot pick unit -> conveyor (unload) seconds. */
  robotUnloadSec: number;
  /** Multiplier on processing speed (1 = nominal, 1.2 = 20% faster). */
  speedFactor: number;
  /** Rework time as a fraction of the product's assembly time. */
  reworkTimeFactor: number;
  failure: FailureSpec;
  /** Preventive maintenance every N busy hours (0 = off). */
  pmIntervalHours: number;
  pmDurationMin: number;
  /** Max units committed to a cell (kits requested + in transit + buffered + in process). */
  wipPerCell: number;
}

export interface InspectionConfig {
  stations: number;
  testSec: number;
  /** Load + unload + label handling, split evenly before and after the test. */
  handlingSec: number;
  speedFactor: number;
  /** Probability that an inspected unit is rejected. */
  rejectRate: number;
  failure: FailureSpec;
  infeedCapacity: number;
  rejectBinCapacity: number;
}

export interface PackagingConfig {
  packSec: number;
  speedFactor: number;
  failure: FailureSpec;
}

export interface PalletizerConfig {
  unitsPerPallet: number;
  wrapSec: number;
  buildPositions: number;
}

export interface ConveyorConfig {
  speedMps: number;
  pitchM: number;
  failure: FailureSpec;
}

export interface VehicleConfig {
  agvCount: number;
  agvSpeedMps: number;
  agvCapacityKits: number;
  forkliftCount: number;
  forkliftSpeedMps: number;
  loadSec: number;
  unloadSec: number;
  agvFailure: FailureSpec;
  forkliftFailure: FailureSpec;
}

export interface StaffingConfig {
  /** Workers per assembly cell per shift. */
  assemblersPerCell: number;
  inspectorsPerStation: number;
  packers: number;
  drivers: number;
  floaters: number;
  technicians: number;
  walkSpeedMps: number;
  /** Probability that a scheduled worker is absent for a whole shift. */
  absenceProbability: number;
}

export interface ShiftConfig {
  /** Shift start hours of day; t = 0 is 06:00. */
  startHours: number[];
  lengthHours: number;
  breakMin: number;
  /** First break starts this many hours after shift start; breaks are staggered by `breakMin`. */
  firstBreakAfterHours: number;
}

export interface OrderConfig {
  /** Mean orders per 24h (Poisson). */
  arrivalsPerDay: number;
  qtyMin: number;
  qtyMax: number;
  priorityWeights: Record<Priority, number>;
  dueHours: Record<Priority, number>;
  initialBacklogOrders: number;
  dispatchRule: DispatchRule;
}

export interface LogisticsConfig {
  receivingBays: number;
  unloadMin: number;
  shippingBays: number;
  carrierLeadMin: Tri;
}

export interface CostConfig {
  machineCostPerHour: Record<StationKind, number>;
  conveyorCostPerHour: number;
  agvCostPerHour: number;
  forkliftCostPerHour: number;
  laborCostPerHour: number;
  /** One-off premium charged by expedite-material and repair-now recoveries. */
  expediteFee: number;
  /** Objective penalty per order-hour late (not part of operating cost). */
  latenessPenaltyPerHour: number;
}

export interface FactoryConfig {
  name: string;
  products: Record<ProductType, ProductSpec>;
  materials: Record<MaterialId, MaterialSpec>;
  assembly: AssemblyConfig;
  inspection: InspectionConfig;
  packaging: PackagingConfig;
  palletizer: PalletizerConfig;
  conveyors: ConveyorConfig;
  vehicles: VehicleConfig;
  staffing: StaffingConfig;
  shifts: ShiftConfig;
  orders: OrderConfig;
  logistics: LogisticsConfig;
  costs: CostConfig;
}

// ---------------------------------------------------------------------------
// Scenarios and injected events
// ---------------------------------------------------------------------------

export type IncidentKind =
  | 'machine-failure'
  | 'conveyor-breakdown'
  | 'material-shortage'
  | 'worker-absence'
  | 'inspection-spike'
  | 'order-surge'
  | 'shipping-bottleneck'
  | 'packaging-slowdown';

export type RecoveryKind = 'repair-now' | 'reassign-worker' | 'reroute' | 'expedite-material';

export type InjectedKind = IncidentKind | RecoveryKind;

/**
 * A user action that happens at a sim time. Scenarios carry a list of these so that a replay
 * reproduces every intervention. `params` values are numbers or strings only (JSON-safe).
 */
export interface InjectedEvent {
  at: number;
  kind: InjectedKind;
  target?: string;
  params?: Record<string, number | string>;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  seed: number;
  config: FactoryConfig;
  injectedEvents: InjectedEvent[];
}

// ---------------------------------------------------------------------------
// Event log (domain events, the source of truth for metrics and replay hashing)
// ---------------------------------------------------------------------------

/** A domain record written by the simulation. Fields are primitives so the log hashes canonically. */
export interface LogRecord {
  t: number;
  type: LogType;
  /** Primary subject id (product, order, station, vehicle, worker, material...). */
  id: string;
  /** Optional secondary id (station, order, ...). */
  ref?: string;
  /** Optional numeric value (quantity, duration, cost...). */
  v?: number;
}

export type LogType =
  | 'order.arrive'
  | 'order.complete' // all good units palletised and stored
  | 'order.ship'
  | 'unit.release'
  | 'unit.kitted'
  | 'unit.assembly-start'
  | 'unit.assembled'
  | 'unit.inspect-start'
  | 'unit.inspect-pass'
  | 'unit.inspect-reject'
  | 'unit.rework-start'
  | 'unit.scrap'
  | 'unit.pack-start'
  | 'unit.packed'
  | 'unit.palletized'
  | 'unit.ship'
  | 'material.consume'
  | 'material.po' // purchase order placed
  | 'material.receive' // put away into raw storage
  | 'material.quarantine'
  | 'material.stockout'
  | 'station.fail'
  | 'station.repair'
  | 'station.pm'
  | 'conveyor.fail'
  | 'conveyor.repair'
  | 'vehicle.fail'
  | 'vehicle.repair'
  | 'vehicle.trip'
  | 'pallet.close'
  | 'pallet.store'
  | 'worker.absent'
  | 'worker.break'
  | 'incident'
  | 'recovery'
  | 'cost'; // one-off cost (expedite fee); v = amount

// ---------------------------------------------------------------------------
// Snapshot (what the renderer reads every frame)
// ---------------------------------------------------------------------------

export type Vec2 = [number, number]; // [x, z] on the factory floor

/**
 * Movement along a polyline, parameterised by sim time. Position at time t is found by
 * interpolating arc length from d0 (at t0) to d1 (at t1). The renderer evaluates this at its
 * own render time, so motion is a pure function of simulation state.
 */
export interface MotionSegment {
  points: Vec2[];
  t0: number;
  t1: number;
  /** Arc-length distance along `points` at t0 and t1 (allows partial segments after a breakdown). */
  d0: number;
  d1: number;
}

/** Timed phase used to animate machines (robot arm poses, gantry sweep, press stroke...). */
export interface PhaseInfo {
  name: string;
  t0: number;
  t1: number;
  /** When frozen (failure, blocked) the phase progress is fixed at this value, 0..1. */
  frozenProgress?: number;
}

export interface StationSnap {
  id: string;
  kind: StationKind;
  index: number;
  name: string;
  state: MachineState;
  phase: PhaseInfo | null;
  /** Product currently in the machine (or being handled by its robot). */
  productId: string | null;
  productType: ProductType | null;
  /** Units waiting immediately upstream of this station. */
  queue: number;
  staffed: number;
  staffRequired: number;
  utilization: number;
  produced: number;
  failures: number;
  /** Inspection only: outcome once the test phase is over. */
  result: 'pass' | 'reject' | null;
  /** Palletizer only: build position the current job works on. */
  buildPos: number | null;
}

export interface ConveyorItemSnap {
  productId: string;
  type: ProductType;
  boxed: boolean;
  /** Item position = min(basePos + (beltPos - baseBelt), cap from item ahead). */
  basePos: number;
  baseBelt: number;
}

export interface ConveyorSnap {
  id: string;
  points: Vec2[];
  length: number;
  pitch: number;
  state: ConveyorState;
  speed: number;
  /** Belt odometer at snapshot time; advances at `speed` while state === 'running'. */
  beltPos: number;
  beltTime: number;
  /** Head first. */
  items: ConveyorItemSnap[];
}

export interface BufferSnap {
  id: string;
  /** Product ids in slot order. */
  items: { productId: string; type: ProductType; rework: boolean }[];
  capacity: number;
}

export interface VehicleSnap {
  id: string;
  kind: VehicleKind;
  name: string;
  state: VehicleState;
  /** Position when not moving (also the last position when motion is null). */
  pos: Vec2;
  heading: number;
  motion: MotionSegment | null;
  /** Lift/fork phase for animation. */
  phase: PhaseInfo | null;
  cargo: { kind: 'kits' | 'rework' | 'pallet' | 'material'; count: number; label: string } | null;
  trips: number;
}

export interface WorkerSnap {
  id: string;
  name: string;
  role: WorkerRole;
  shift: ShiftIndex;
  state: WorkerState;
  pos: Vec2;
  heading: number;
  motion: MotionSegment | null;
  stationId: string | null;
}

export type PalletLocation = 'palletizer' | 'forklift' | 'fg' | 'truck';

export interface PalletSnap {
  id: string;
  orderId: string;
  type: ProductType;
  units: number;
  location: PalletLocation;
  /** Build position (palletizer), rack slot index (fg), bay (truck) or vehicle id (forklift). */
  slot: number;
  vehicleId: string | null;
}

export interface TruckSnap {
  id: string;
  kind: 'inbound' | 'outbound';
  bay: number; // -1 while waiting in the yard
  state: 'arriving' | 'waiting' | 'docked' | 'departing';
  label: string;
  pallets: number;
}

export interface ProductLocation {
  kind: 'pending' | 'vehicle' | 'buffer' | 'station' | 'conveyor' | 'pallet' | 'gone';
  /** vehicle id, buffer id, station id, conveyor id or pallet id. */
  ref: string | null;
  slot: number;
}

export interface ProductSnap {
  id: string;
  type: ProductType;
  stage: ProductStage;
  rework: boolean;
  location: ProductLocation;
}

export interface ClockInfo {
  day: number; // 1-based
  hour: number;
  minute: number;
  shift: ShiftIndex | null;
  label: string; // "Day 2 14:05 (Shift 2)"
}

export interface SimSnapshot {
  /** Increments each time state changes (cheap change detection for consumers). */
  version: number;
  /** Time of the last processed event. */
  time: number;
  clock: ClockInfo;
  stations: StationSnap[];
  conveyors: ConveyorSnap[];
  buffers: BufferSnap[];
  vehicles: VehicleSnap[];
  workers: WorkerSnap[];
  products: ProductSnap[];
  pallets: PalletSnap[];
  trucks: TruckSnap[];
  inventory: Record<MaterialId, number>;
  activeIncidents: IncidentInfo[];
}

// ---------------------------------------------------------------------------
// Metrics (dashboard) — all derived from events/state, sampled on sim time
// ---------------------------------------------------------------------------

export interface MetricsTotals {
  ordersArrived: number;
  ordersShipped: number;
  ordersOnTime: number;
  activeOrders: number;
  unitsReleased: number;
  unitsAssembled: number;
  unitsInspected: number;
  unitsRejected: number;
  unitsReworked: number;
  unitsScrapped: number;
  unitsPacked: number; // "total manufactured"
  unitsShipped: number;
  wip: number;
  avgCycleTimeSec: number; // release -> packed, mean over packed units
  avgOrderLeadTimeSec: number; // arrival -> shipped
  onTimeRate: number; // ordersOnTime / ordersShipped (1 if none)
  materialCost: number;
  machineCost: number;
  laborCost: number;
  vehicleCost: number;
  otherCost: number;
  operatingCost: number;
  revenue: number;
  latenessHours: number;
}

export interface MetricsSample {
  t: number;
  unitsPerHour: number; // packed in the last sim hour
  wip: number;
  activeOrders: number;
  onTimeRate: number;
  operatingCost: number;
  unitsPacked: number;
  inventory: Record<MaterialId, number>;
  utilization: Record<string, number>; // per stage
}

export interface ResourceStats {
  id: string;
  name: string;
  kind: StationKind | 'conveyor' | 'agv' | 'forklift';
  stage: string;
  utilization: number; // busy / open
  blockedFrac: number;
  starvedFrac: number;
  failedFrac: number;
  avgQueue: number;
  produced: number;
  failures: number;
}

export interface BottleneckEntry {
  stage: string;
  score: number;
  utilization: number;
  failedFrac: number;
  blockedFrac: number;
  starvedFrac: number;
  avgQueue: number;
}

export interface BottleneckReport {
  ranking: BottleneckEntry[];
  explanation: string;
}

export interface Alert {
  t: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ref?: string;
}

export interface IncidentInfo {
  id: string;
  kind: InjectedKind;
  target?: string;
  start: number;
  end: number | null;
  description: string;
}

export interface MetricsSnapshot {
  time: number;
  totals: MetricsTotals;
  current: MetricsSample;
  series: MetricsSample[];
  resources: ResourceStats[];
  bottleneck: BottleneckReport;
  alerts: Alert[];
  incidents: IncidentInfo[];
}

// ---------------------------------------------------------------------------
// Entity detail (inspector panel; fetched on demand, not per frame)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  t: number;
  text: string;
}

export interface EntityDetail {
  kind: 'station' | 'conveyor' | 'vehicle' | 'worker' | 'product' | 'pallet' | 'order' | 'storage';
  id: string;
  title: string;
  fields: { label: string; value: string }[];
  history: HistoryEntry[];
}

export type EntityRef = { kind: EntityDetail['kind']; id: string };

// ---------------------------------------------------------------------------
// Engine API — implemented on the main thread and in a Web Worker
// ---------------------------------------------------------------------------

export interface AdvanceResult {
  /** Sim time reached (last processed event, or target if no events remained before it). */
  time: number;
  events: number;
  /** False when the per-call event cap stopped processing before the target. */
  complete: boolean;
}

/**
 * The surface the UI talks to. Implementations: LocalSimHost (main thread) and WorkerSimHost
 * (Web Worker). `snapshot` and `metrics` are the latest values available synchronously — the
 * renderer reads them from refs inside useFrame.
 */
export interface SimHost {
  readonly snapshot: SimSnapshot | null;
  readonly metrics: MetricsSnapshot | null;
  load(scenario: Scenario): Promise<void>;
  /** Process all events with time <= target (bounded by maxEvents). */
  advanceTo(target: number, maxEvents?: number): void;
  /** Schedule a user intervention at max(ev.at, now); it is recorded in the scenario. */
  inject(ev: InjectedEvent): void;
  getScenario(): Promise<Scenario>;
  getDetail(ref: EntityRef): Promise<EntityDetail | null>;
  getLogHash(): Promise<string>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Optimisation
// ---------------------------------------------------------------------------

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Reads/writes the value on a FactoryConfig (pure functions). */
  get(c: FactoryConfig): number;
  set(c: FactoryConfig, v: number): void;
}

export interface RunSummary {
  seed: number;
  days: number;
  unitsShipped: number;
  unitsPacked: number;
  throughputPerDay: number;
  operatingCost: number;
  revenue: number;
  costPerUnit: number;
  onTimeRate: number;
  avgOrderLeadTimeHours: number;
  latenessHours: number;
  objective: number;
  utilization: Record<string, number>;
  bottleneck: string;
  logHash: string;
}

export interface Stat {
  mean: number;
  std: number;
  min: number;
  max: number;
}

export interface CandidateResult {
  params: Record<string, number>;
  runs: RunSummary[];
  objective: Stat;
  throughputPerDay: Stat;
  operatingCost: Stat;
  onTimeRate: Stat;
}

export interface OptimizerOptions {
  budget: number;
  seeds: number[];
  days: number;
  baseSeed: number;
}

export interface OptimizerProgress {
  evaluated: number;
  budget: number;
  best: CandidateResult | null;
}

export interface OptimizerResult {
  baseline: CandidateResult;
  top: (CandidateResult & { gain: number; changes: string[] })[];
  evaluated: number;
}
