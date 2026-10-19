/**
 * Message protocol between the Monte Carlo runner (main thread) and `workers/montecarlo.worker.ts`.
 *
 * main → worker: `run` with one contiguous path range (or `warm`, see below).
 * worker → main: `progress` after each sub-chunk, then exactly one `chunk` (typed-array buffers
 * transferred, not copied) or `error`. Every reply carries the request's `runId`, so replies from a
 * superseded run are ignored. Cancel terminates the worker (the runner recreates it on the next run).
 */
import type { EngineResult, MonteCarloChunk } from '@rn/engine';
import type { ChunkRequest } from './chunking';

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

export type WorkerRequest = RunMessage | WarmMessage;

export type WorkerResponse =
  | { type: 'progress'; runId: number; pathsDone: number; pathsTotal: number }
  | { type: 'chunk'; runId: number; chunk: MonteCarloChunk }
  | { type: 'error'; runId: number; result: Exclude<EngineResult<never>, { status: 'ok' }> }
  | { type: 'error'; runId: number; message: string };
