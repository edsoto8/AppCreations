/**
 * Shared by the Monte Carlo worker and the in-process executor: run one contiguous path range in
 * sub-chunks (so progress and cancel stay responsive) and stitch the sub-chunks into one chunk.
 * No financial logic: every number comes from `runMonteCarloChunk`; this only copies typed arrays.
 */
import {
  runMonteCarloChunk,
  type EngineContext,
  type EngineResult,
  type Household,
  type MonteCarloChunk,
  type MonteCarloConfig,
} from '@rn/engine';

/** Paths per sub-chunk: about 0.1 s of work on a 60-year plan, so progress moves ~10 times a second. */
export const SUB_CHUNK_PATHS = 100;

export interface PathRange {
  pathStart: number;
  /** Exclusive. */
  pathEnd: number;
}

export interface ChunkRequest extends PathRange {
  household: Household;
  ctx: EngineContext;
  config: MonteCarloConfig;
}

/** Split [start, end) into at most `parts` contiguous ranges whose sizes differ by at most one. */
export function splitRange(start: number, end: number, parts: number): PathRange[] {
  const total = Math.max(0, end - start);
  const n = Math.max(1, Math.min(parts, total));
  const base = Math.floor(total / n);
  const extra = total % n;
  const out: PathRange[] = [];
  let cursor = start;
  for (let i = 0; i < n && cursor < end; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push({ pathStart: cursor, pathEnd: cursor + size });
    cursor += size;
  }
  return out;
}

export type SubChunkOutcome = EngineResult<MonteCarloChunk> | { status: 'cancelled' };

/**
 * Run `req`'s range in sub-chunks of `subChunk` paths. `onProgress` receives the paths done so far.
 * `between`, when given, is awaited between sub-chunks and returns false to stop (cancel); without it
 * the loop is synchronous (the worker cancels by being terminated).
 */
export async function runInSubChunks(
  req: ChunkRequest,
  opts: {
    subChunk?: number;
    onProgress?: (pathsDone: number) => void;
    between?: () => Promise<boolean>;
  } = {},
): Promise<SubChunkOutcome> {
  const size = Math.max(1, opts.subChunk ?? SUB_CHUNK_PATHS);
  const n = req.pathEnd - req.pathStart;
  let merged: MonteCarloChunk | null = null;
  let warnings: Extract<EngineResult<MonteCarloChunk>, { status: 'ok' }>['warnings'] = [];
  for (let start = req.pathStart; start < req.pathEnd; start += size) {
    if (opts.between && start > req.pathStart && !(await opts.between())) return { status: 'cancelled' };
    const end = Math.min(req.pathEnd, start + size);
    const r = runMonteCarloChunk(req.household, req.ctx, req.config, { pathStart: start, pathEnd: end });
    if (r.status !== 'ok') return r;
    const part = r.value;
    if (merged === null) {
      warnings = r.warnings;
      const years = part.years;
      merged = {
        pathStart: req.pathStart,
        pathEnd: req.pathEnd,
        years,
        balances: new Float64Array(n * years),
        balancesReal: new Float64Array(n * years),
        success: new Uint8Array(n),
        depletionAge: new Int16Array(n),
      };
    }
    const offset = start - req.pathStart;
    merged.balances.set(part.balances, offset * merged.years);
    merged.balancesReal.set(part.balancesReal, offset * merged.years);
    merged.success.set(part.success, offset);
    merged.depletionAge.set(part.depletionAge, offset);
    opts.onProgress?.(end - req.pathStart);
  }
  if (merged === null) {
    return { status: 'invalid', issues: [{ path: ['range'], message: 'The path range is empty' }] };
  }
  return { status: 'ok', value: merged, warnings };
}

/** The typed-array buffers of a chunk, for a zero-copy postMessage transfer. */
export function chunkBuffers(chunk: MonteCarloChunk): ArrayBuffer[] {
  return [chunk.balances, chunk.balancesReal, chunk.success, chunk.depletionAge].map((a) => a.buffer as ArrayBuffer);
}
