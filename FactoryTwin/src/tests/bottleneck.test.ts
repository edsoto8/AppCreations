import { describe, expect, it } from 'vitest';
import { runScenario } from '../simulation/runner';
import { scenario } from './helpers';
import type { FactoryConfig } from '../simulation/types';

const saturated = (c: FactoryConfig) => {
  c.orders.arrivalsPerDay = 60; // demand well above capacity: output = capacity
  // scale the material policy so supply is not the constraint
  for (const m of Object.values(c.materials)) {
    m.initialStock *= 2;
    m.reorderPoint *= 2;
    m.orderQty *= 2;
  }
};

function packedPerDay(mut: (c: FactoryConfig) => void, seed: number): number {
  const r = runScenario(
    scenario(seed, (c) => {
      saturated(c);
      mut(c);
    }),
    { days: 4 },
  );
  return r.factory.metrics.c.unitsPacked / 4;
}

describe('invariant 4: the bottleneck limits real throughput', () => {
  const seeds = [1, 2];
  const avg = (mut: (c: FactoryConfig) => void) => seeds.reduce((s, x) => s + packedPerDay(mut, x), 0) / seeds.length;
  const base = avg(() => {});
  const moreAssembly = avg((c) => (c.assembly.cells = 4));
  const moreInspection = avg((c) => (c.inspection.stations = 3));
  const fasterPackaging = avg((c) => (c.packaging.speedFactor = 1.3));

  it('relieving the bottleneck (4th assembly cell) raises output', () => {
    console.log({ base, moreAssembly, moreInspection, fasterPackaging });
    expect(moreAssembly).toBeGreaterThan(base * 1.1);
  });

  it('relieving a non-bottleneck (3rd inspection station, faster packaging) does not raise output', () => {
    // no material gain (random paths differ between configurations, so allow small noise)
    expect(moreInspection).toBeLessThan(base * 1.03);
    expect(fasterPackaging).toBeLessThan(base * 1.03);
    // and the gain from relieving the bottleneck dwarfs either
    expect(moreAssembly - base).toBeGreaterThan(5 * Math.max(0, moreInspection - base, fasterPackaging - base));
  });
});
