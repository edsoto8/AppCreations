import type { SimConfig } from '../config';
import { clamp } from '../core/math';
import type { Resources } from '../resources/Resources';

export type DockPhase = 'idle' | 'charging' | 'dustExtraction' | 'mopWash' | 'waterTransfer' | 'drying' | 'ready';

export interface ServiceRequest {
  emptyBin: boolean;
  washMop: boolean;
  /** Refill robot water & drain recovery tank. */
  water: boolean;
  dry: boolean;
}

export interface DockLogEntry {
  time: number;
  message: string;
}

/**
 * Multifunction dock. Owns its tanks and runs the service cycle as a timed state machine in simulated
 * time: dust extraction -> mop wash -> water transfer -> drying, all while charging. Phases that are
 * not requested are skipped. Robot battery charging is handled by Resources (dock just reports
 * whether contacts are engaged).
 */
export class DockStation {
  phase: DockPhase = 'idle';
  phaseTime = 0;
  phaseDuration = 0;
  robotDocked = false;
  cleanTank: number;
  dirtyTank = 0;
  dustBag = 0;
  private queue: DockPhase[] = [];
  readonly log: DockLogEntry[] = [];
  /** Totals moved during the last cycle (for UI). */
  lastCycle = { dust: 0, washWater: 0, refill: 0, drained: 0 };
  private dryingActive = false;

  constructor(private readonly cfg: SimConfig) {
    this.cleanTank = cfg.dock.cleanTankCapacity;
  }

  get phaseProgress(): number {
    return this.phaseDuration > 0 ? clamp(this.phaseTime / this.phaseDuration, 0, 1) : 1;
  }

  get busy(): boolean {
    return this.phase === 'dustExtraction' || this.phase === 'mopWash' || this.phase === 'waterTransfer';
  }

  get drying(): boolean {
    return this.phase === 'drying';
  }

  /** Robot made contact: start charging and queue the requested service phases. */
  dock(time: number, req: ServiceRequest): void {
    this.robotDocked = true;
    this.queue = [];
    if (req.emptyBin) this.queue.push('dustExtraction');
    if (req.washMop) this.queue.push('mopWash');
    if (req.water) this.queue.push('waterTransfer');
    if (req.dry) this.queue.push('drying');
    this.lastCycle = { dust: 0, washWater: 0, refill: 0, drained: 0 };
    this.addLog(time, 'Robot docked — charging contacts engaged');
    this.enter('charging', 1.5);
  }

  undock(time: number): void {
    if (!this.robotDocked) return;
    this.robotDocked = false;
    this.queue = [];
    this.dryingActive = false;
    this.addLog(time, 'Robot departed');
    this.enter('idle', 0);
  }

  /** Can the robot leave? (service phases that need the robot are done) */
  get serviceComplete(): boolean {
    return !this.busy && !this.queue.some((p) => p !== 'drying');
  }

  step(dt: number, time: number, res: Resources): void {
    if (!this.robotDocked) {
      this.phase = 'idle';
      return;
    }
    this.phaseTime += dt;
    const d = this.cfg.dock;
    switch (this.phase) {
      case 'dustExtraction': {
        // Move dust from robot bin to the bag at a rate that empties it by the end of the phase.
        const rate = Math.max(res.dustbin, 1) / Math.max(0.1, this.phaseDuration - this.phaseTime + dt);
        const moved = Math.min(res.dustbin, rate * dt, this.cfg.dock.dustBagCapacity - this.dustBag);
        res.dustbin -= moved;
        this.dustBag += moved;
        this.lastCycle.dust += moved;
        break;
      }
      case 'mopWash': {
        const use = Math.min((d.washWater / d.mopWashTime) * dt, this.cleanTank);
        this.cleanTank -= use;
        this.dirtyTank = Math.min(d.dirtyTankCapacity, this.dirtyTank + use);
        this.lastCycle.washWater += use;
        res.padSoil = Math.max(0, res.padSoil - dt / d.mopWashTime);
        break;
      }
      case 'waterTransfer': {
        // Drain robot recovery tank into dock dirty tank, refill robot clean tank from dock clean tank.
        const drain = Math.min(res.dirtyWater, (this.cfg.water.dirtyCapacity / d.waterTransferTime) * dt * 1.2, d.dirtyTankCapacity - this.dirtyTank);
        res.dirtyWater -= drain;
        this.dirtyTank += drain;
        this.lastCycle.drained += drain;
        const need = this.cfg.water.tankCapacity - res.cleanWater;
        const fill = Math.min(need, (this.cfg.water.tankCapacity / d.waterTransferTime) * dt * 1.2, this.cleanTank);
        res.cleanWater += fill;
        this.cleanTank -= fill;
        this.lastCycle.refill += fill;
        res.padWetness = Math.max(res.padWetness, 0.6);
        break;
      }
      case 'drying':
        res.padWetness = Math.max(0, res.padWetness - dt / d.dryingTime);
        break;
      default:
        break;
    }
    if (this.phaseTime >= this.phaseDuration && this.phaseDuration > 0) this.advance(time);
  }

  private advance(time: number): void {
    const prev = this.phase;
    if (prev === 'dustExtraction') this.addLog(time, `Self-empty complete (${this.lastCycle.dust.toFixed(1)} g to dust bag)`);
    if (prev === 'mopWash') this.addLog(time, 'Mop pads washed');
    if (prev === 'waterTransfer') this.addLog(time, `Water exchanged (+${this.lastCycle.refill.toFixed(0)} ml clean, ${this.lastCycle.drained.toFixed(0)} ml drained)`);
    if (prev === 'drying') this.addLog(time, 'Mop drying finished');
    const next = this.queue.shift();
    const d = this.cfg.dock;
    if (next === 'dustExtraction') {
      this.addLog(time, 'Self-empty: vacuum motor extracting dustbin');
      this.enter(next, d.dustExtractionTime);
    } else if (next === 'mopWash') {
      this.addLog(time, 'Washing mop pads');
      this.enter(next, d.mopWashTime);
    } else if (next === 'waterTransfer') {
      this.enter(next, d.waterTransferTime);
    } else if (next === 'drying') {
      this.dryingActive = true;
      this.addLog(time, 'Hot-air drying mop pads');
      this.enter(next, d.dryingTime);
    } else {
      this.enter(prev === 'charging' && !this.dryingActive ? 'charging' : 'ready', 0);
      if (this.phase === 'ready') this.addLog(time, 'Service cycle complete — ready');
      this.dryingActive = false;
    }
  }

  private enter(phase: DockPhase, duration: number): void {
    this.phase = phase;
    this.phaseTime = 0;
    this.phaseDuration = duration;
  }

  private addLog(time: number, message: string): void {
    this.log.push({ time, message });
    if (this.log.length > 60) this.log.shift();
  }

  /** User service actions. */
  refillCleanTank(): void {
    this.cleanTank = this.cfg.dock.cleanTankCapacity;
  }
  emptyDirtyTank(): void {
    this.dirtyTank = 0;
  }
  replaceDustBag(): void {
    this.dustBag = 0;
  }
}
