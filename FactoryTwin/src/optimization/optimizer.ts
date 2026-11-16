import type { CandidateResult, OptimizerOptions, OptimizerProgress, OptimizerResult, Scenario } from '../simulation/types';
import { RandomStream, hashString } from '../simulation/rng';
import { evaluate } from './evaluate';
import { applyParams, describeChanges, param, readParams, round, SEARCH_KEYS } from './params';

/**
 * Objective (per simulated day, averaged over seeds):
 *   revenue of shipped units - operating cost - lateness penalty (order-hours late x $/h)
 *
 * Search: first-improvement hill climbing over a bounded discrete space with a fixed evaluation
 * budget. Neighbours change one parameter by one step; candidates are evaluated with the same
 * seeds (common random numbers). After a full neighbourhood without improvement the search
 * restarts from a random perturbation of the best point. Deterministic for a given base seed.
 */
export function optimize(
  scenario: Scenario,
  opts: OptimizerOptions,
  onProgress?: (p: OptimizerProgress) => void,
  keys: string[] = SEARCH_KEYS,
): OptimizerResult {
  const rng = new RandomStream('optimizer', hashString(`opt:${opts.baseSeed}`));
  const cache = new Map<string, CandidateResult>();
  const keyOf = (p: Record<string, number>) => keys.map((k) => `${k}=${p[k]}`).join('&');
  let evaluated = 0;

  const run = (p: Record<string, number>): CandidateResult => {
    const k = keyOf(p);
    const hit = cache.get(k);
    if (hit) return hit;
    const cfg = applyParams(scenario.config, p);
    const res = evaluate({ ...scenario, config: cfg }, opts.seeds, opts.days, p);
    cache.set(k, res);
    evaluated++;
    onProgress?.({ evaluated, budget: opts.budget, best: bestOf() });
    return res;
  };
  const bestOf = () => [...cache.values()].sort((a, b) => b.objective.mean - a.objective.mean)[0] ?? null;

  const start = readParams(scenario.config, keys);
  const baseline = run(start);
  let current = baseline;

  const neighbours = (p: Record<string, number>) => {
    const out: Record<string, number>[] = [];
    for (const k of keys) {
      const d = param(k);
      for (const dir of [1, -1]) {
        const v = round(p[k] + dir * d.step);
        if (v < d.min - 1e-9 || v > d.max + 1e-9) continue;
        out.push({ ...p, [k]: v });
      }
    }
    // deterministic shuffle
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  while (evaluated < opts.budget) {
    let improved = false;
    for (const n of neighbours(current.params)) {
      if (evaluated >= opts.budget) break;
      if (cache.has(keyOf(n))) continue;
      const r = run(n);
      if (r.objective.mean > current.objective.mean) {
        current = r;
        improved = true;
        break;
      }
    }
    if (!improved && evaluated < opts.budget) {
      // random restart around the best point (two random steps)
      const best = bestOf()!;
      const p = { ...best.params };
      for (let s = 0; s < 2; s++) {
        const k = keys[Math.floor(rng.next() * keys.length)];
        const d = param(k);
        const v = round(p[k] + (rng.next() < 0.5 ? -1 : 1) * d.step);
        if (v >= d.min - 1e-9 && v <= d.max + 1e-9) p[k] = v;
      }
      if (cache.has(keyOf(p))) {
        // neighbourhood exhausted around the best: stop early
        if (neighbours(best.params).every((n) => cache.has(keyOf(n)))) break;
        current = best;
        continue;
      }
      current = run(p);
    }
  }

  const ranked = [...cache.values()].filter((c) => c !== baseline).sort((a, b) => b.objective.mean - a.objective.mean);
  const top = ranked.slice(0, 3).map((c) => ({
    ...c,
    gain: c.objective.mean - baseline.objective.mean,
    changes: describeChanges(baseline.params, c.params),
  }));
  return { baseline, top, evaluated };
}
