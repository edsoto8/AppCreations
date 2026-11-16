import { describe, expect, it } from 'vitest';
import { runScenario } from '../simulation/runner';
import { defaultScenario } from '../scenarios/default';

describe('default scenario calibration', () => {
  const runs = [1, 2].map((seed) => runScenario(defaultScenario(seed), { days: 12 }));

  it('assembly is the reported bottleneck', () => {
    for (const r of runs) {
      const b = r.factory.metrics.snapshot(r.factory.engine.now).bottleneck;
      expect(b.ranking[0].stage).toBe('Assembly');
      expect(b.explanation).toMatch(/^Assembly is the bottleneck/);
    }
  });

  it('utilisation targets: assembly 85-95%, inspection ~50-60%, packaging ~60-70%', () => {
    const avg = (k: string) => runs.reduce((s, r) => s + r.summary.utilization[k], 0) / runs.length;
    const a = avg('Assembly');
    const i = avg('Inspection');
    const p = avg('Packaging');
    console.log(`assembly ${(a * 100).toFixed(1)}% inspection ${(i * 100).toFixed(1)}% packaging ${(p * 100).toFixed(1)}%`);
    expect(a).toBeGreaterThanOrEqual(0.85);
    expect(a).toBeLessThanOrEqual(0.95);
    expect(i).toBeGreaterThanOrEqual(0.47);
    expect(i).toBeLessThanOrEqual(0.6);
    expect(p).toBeGreaterThanOrEqual(0.6);
    expect(p).toBeLessThanOrEqual(0.72);
  });
});
