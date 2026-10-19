/**
 * Message protocol between the Monte Carlo runners (main thread) and `workers/montecarlo.worker.ts`.
 *
 * main → worker: `run` with one contiguous path range (or `warm`, see below), or `optimize` with a
 * retirement-age scan (`optimizeRetirementAge`, see `optimizeSteps.ts`).
 * worker → main:
 * - for `run`: `progress` after each sub-chunk, then exactly one `chunk` (typed-array buffers
 *   transferred, not copied) or `error`;
 * - for `optimize`: `optimizeProgress` after each age, then exactly one `optimized` (the engine's
 *   result, which may be `invalid`) or `error`.
 * Every reply carries the request's `runId`, so replies from a superseded run are ignored. Cancel
 * terminates the worker (the runner recreates it on the next run).
 */
import type { EngineResult, MonteCarloChunk, OptimizerResult } from '@rn/engine';
import type { ChunkRequest } from './chunking';
import type { OptimizeRequest } from './optimizeSteps';

export interface RunMessage extends ChunkRequest {
  type: 'run';
  runId: number;
}

/**
 * Warm-up: run a short range and discard it, yielding between sub-chunks so a `run` that arrives
 * meanwhile stops it at once. No reply. Cold engine code runs two to three times slower.
 */
export interface WarmMessage extends ChunkRequest {
  type: 'warm';
}

/** Retirement-age scan (`optimizeRetirementAge`), one age at a time so progress can be reported. */
export interface OptimizeMessage extends OptimizeRequest {
  type: 'optimize';
  runId: number;
}

export type WorkerRequest = RunMessage | WarmMessage | OptimizeMessage;

export type WorkerResponse =
  | { type: 'progress'; runId: number; pathsDone: number; pathsTotal: number }
  | { type: 'chunk'; runId: number; chunk: MonteCarloChunk }
  | { type: 'optimizeProgress'; runId: number; agesDone: number; agesTotal: number }
  | { type: 'optimized'; runId: number; result: EngineResult<OptimizerResult> }
  | { type: 'error'; runId: number; result: Exclude<EngineResult<never>, { status: 'ok' }> }
  | { type: 'error'; runId: number; message: string };
