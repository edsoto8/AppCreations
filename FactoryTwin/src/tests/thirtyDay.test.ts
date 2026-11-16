import { describe, expect, it } from 'vitest';
import { runScenario } from '../simulation/runner';
import { defaultScenario } from '../scenarios/default';

describe('invariant 10: 30 simulated production days headless', () => {
  it('completes in under 60 s with no invariant violations and units reconcile', () => {
    const t0 = performance.now();
    const r = runScenario(defaultScenario(), { days: 30, checkEvery: 6 * 3600 });
    const ms = performance.now() - t0;
    const f = r.factory;
    const c = f.metrics.c;
    console.log(`30 days: ${ms.toFixed(0)} ms, ${r.events} events, shipped ${c.unitsShipped}, packed ${c.unitsPacked}`);
    expect(ms).toBeLessThan(60_000);
    expect(r.violations).toEqual([]);
    // conservation: released = in progress + finished (on pallets, not shipped) + shipped + scrapped
    let inProgress = 0;
    let finished = 0;
    for (const p of f.products.values()) (p.location.kind === 'pallet' ? finished++ : inProgress++);
    expect(c.unitsReleased).toBe(inProgress + finished + c.unitsShipped + c.unitsScrapped);
    expect(c.unitsShipped).toBeGreaterThan(25 * 1000);
    expect(f.engine.now).toBeGreaterThan(30 * 86400 - 3600);
  });
});
