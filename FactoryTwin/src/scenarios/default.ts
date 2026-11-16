import type { FactoryConfig, Scenario } from '../simulation/types';

/**
 * DEFAULT SCENARIO — calibrated parameters for the electronics assembly & packaging plant.
 *
 * Products
 *   A  Smart-home sensor hub : 1 PCB, 1 enclosure, 2 sensors, 1 packaging kit. Assembly 90 s mean.
 *   B  Wireless speaker      : 1 PCB, 1 enclosure, 1 speaker driver, 1 battery, 1 packaging kit. 120 s.
 *   Mix 35% A / 65% B by order arrival.
 *
 * Process times are triangular (0.75 m, m, 1.25 m) around the stated mean m.
 *
 * Calibration (see DECISIONS.md D-010 and `npm run calibrate`):
 *   The spec asks for assembly ~85-95%, inspection ~50-60%, packaging ~60-70% utilisation.
 *   With assembly 90/120 s on 3 cells and inspection 25 s on 2 stations those targets are
 *   arithmetically inconsistent (inspection would sit near 33%). We keep every stated mean and add
 *   explicit, physically motivated handling time that the spec leaves open:
 *     - robot handling per assembly cycle: 8 s load + 7 s unload (counts as busy time),
 *     - inspection handling per unit: 20 s load/unload/label around the 25 s test.
 *   Order arrivals are then set so that assembly runs at about 90% of its open time.
 *
 * Quality: 4% reject at inspection. A rejected unit returns by AGV to an assembly cell for ONE
 * rework (50% of the assembly time, consumes 1 replacement PCB). If it fails inspection again it
 * is scrapped and the order gets a replacement unit released.
 *
 * Failures: Weibull time-to-failure on BUSY time (shape > 1 = wear-out). A failure interrupts
 * the current job; after repair the job RESUMES with its remaining time (preempt-resume). Repair
 * starts when a technician arrives. Conveyors and vehicles fail on operating time.
 *
 * Shifts: 06:00-14:00 and 14:00-22:00, 30-minute staggered breaks covered by a floater.
 *
 * Costs are illustrative USD figures for a small contract manufacturer.
 */
export function defaultConfig(): FactoryConfig {
  return {
    name: 'Default plant',
    products: {
      A: {
        name: 'Smart-home sensor hub',
        bom: { PCB: 1, ENCLOSURE: 1, SENSOR: 2, PACKAGING_KIT: 1 },
        assemblyTimeSec: 90,
        price: 89,
        mix: 0.35,
      },
      B: {
        name: 'Wireless speaker',
        bom: { PCB: 1, ENCLOSURE: 1, SPEAKER_DRIVER: 1, BATTERY: 1, PACKAGING_KIT: 1 },
        assemblyTimeSec: 120,
        price: 129,
        mix: 0.65,
      },
    },
    materials: {
      PCB: { unitCost: 14.5, initialStock: 3000, reorderPoint: 2200, orderQty: 2400, leadTimeHours: { min: 16, mode: 24, max: 36 } },
      ENCLOSURE: { unitCost: 4.2, initialStock: 3000, reorderPoint: 2200, orderQty: 2400, leadTimeHours: { min: 16, mode: 24, max: 36 } },
      SENSOR: { unitCost: 3.1, initialStock: 2200, reorderPoint: 1600, orderQty: 1800, leadTimeHours: { min: 16, mode: 24, max: 36 } },
      SPEAKER_DRIVER: { unitCost: 6.8, initialStock: 2200, reorderPoint: 1700, orderQty: 1600, leadTimeHours: { min: 20, mode: 30, max: 44 } },
      BATTERY: { unitCost: 5.5, initialStock: 2200, reorderPoint: 1700, orderQty: 1600, leadTimeHours: { min: 20, mode: 30, max: 44 } },
      PACKAGING_KIT: { unitCost: 1.2, initialStock: 2600, reorderPoint: 1500, orderQty: 2000, leadTimeHours: { min: 12, mode: 18, max: 30 } },
    },
    assembly: {
      cells: 3,
      robotLoadSec: 8,
      robotUnloadSec: 7,
      speedFactor: 1,
      reworkTimeFactor: 0.5,
      failure: { mtbfHours: 40, mttrMin: 25, weibullShape: 1.5 },
      pmIntervalHours: 0,
      pmDurationMin: 20,
      wipPerCell: 3,
    },
    inspection: {
      stations: 2,
      testSec: 25,
      handlingSec: 20,
      speedFactor: 1,
      rejectRate: 0.04,
      failure: { mtbfHours: 80, mttrMin: 15, weibullShape: 1.2 },
      infeedCapacity: 8,
      rejectBinCapacity: 6,
    },
    packaging: {
      packSec: 30,
      speedFactor: 1,
      failure: { mtbfHours: 60, mttrMin: 20, weibullShape: 1.3 },
    },
    palletizer: { unitsPerPallet: 24, wrapSec: 20, buildPositions: 2 },
    conveyors: { speedMps: 0.4, pitchM: 0.7, failure: { mtbfHours: 120, mttrMin: 15, weibullShape: 1 } },
    vehicles: {
      agvCount: 2,
      agvSpeedMps: 1.2,
      agvCapacityKits: 4,
      forkliftCount: 1,
      forkliftSpeedMps: 1.8,
      loadSec: 12,
      unloadSec: 10,
      agvFailure: { mtbfHours: 100, mttrMin: 10, weibullShape: 1 },
      forkliftFailure: { mtbfHours: 150, mttrMin: 20, weibullShape: 1 },
    },
    staffing: {
      assemblersPerCell: 1,
      inspectorsPerStation: 1,
      packers: 2,
      drivers: 1,
      floaters: 1,
      technicians: 1,
      walkSpeedMps: 1.3,
      absenceProbability: 0.03,
    },
    shifts: { startHours: [6, 14], lengthHours: 8, breakMin: 30, firstBreakAfterHours: 2.5 },
    orders: {
      arrivalsPerDay: 31,
      qtyMin: 12,
      qtyMax: 72,
      priorityWeights: { high: 0.2, normal: 0.6, low: 0.2 },
      dueHours: { high: 24, normal: 40, low: 60 },
      initialBacklogOrders: 6,
      dispatchRule: 'priority-edd',
    },
    logistics: { receivingBays: 2, unloadMin: 20, shippingBays: 2, carrierLeadMin: { min: 20, mode: 40, max: 90 } },
    costs: {
      machineCostPerHour: { assembly: 38, inspection: 22, packaging: 30, palletizer: 12 },
      conveyorCostPerHour: 3,
      agvCostPerHour: 9,
      forkliftCostPerHour: 14,
      laborCostPerHour: 32,
      expediteFee: 1500,
      latenessPenaltyPerHour: 25,
    },
  };
}

export const DEFAULT_SEED = 20261116;

export function defaultScenario(seed = DEFAULT_SEED): Scenario {
  return {
    id: 'normal',
    name: 'Normal operation',
    description: 'Default calibrated plant: 3 assembly cells, 2 inspection stations, 1 packaging line, 2 shifts.',
    seed,
    config: defaultConfig(),
    injectedEvents: [],
  };
}
