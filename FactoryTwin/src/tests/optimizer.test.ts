import { describe, expect, it } from 'vitest';
import { optimize } from '../optimization/optimizer';
import { compare } from '../optimization/evaluate';
import { applyParams, PARAMS, readParams } from '../optimization/params';
import { growthScenario } from '../scenarios/presets';
import { defaultScenario } from '../scenarios/default';

describe('optimizer & comparison (headless)', () => {
  it('parameters read back what they write and stay in bounds', () => {
    const c = defaultScenario().config;
    for (const p of PARAMS) {
      const next = applyParams(c, { [p.key]: p.max + 10 });
      expect(readParams(next, [p.key])[p.key]).toBeCloseTo(p.max, 6);
    }
  });

  it('is deterministic and returns up to 3 ranked recommendations with gains', () => {
    const s = growthScenario();
    const opts = { budget: 8, seeds: [1], days: 2, baseSeed: 3 };
    const a = optimize(s, opts, undefined, ['assembly.cells', 'vehicles.agvCount', 'packaging.speedFactor']);
    const b = optimize(s, opts, undefined, ['assembly.cells', 'vehicles.agvCount', 'packaging.speedFactor']);
    expect(a.top.map((t) => t.params)).toEqual(b.top.map((t) => t.params));
    expect(a.top.length).toBeGreaterThan(0);
    expect(a.top.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < a.top.length; i++) expect(a.top[i - 1].objective.mean).toBeGreaterThanOrEqual(a.top[i].objective.mean);
    expect(a.top[0].gain).toBe(a.top[0].objective.mean - a.baseline.objective.mean);
    expect(a.evaluated).toBeLessThanOrEqual(8);
  });

  it('compare uses the same seeds for both and reports mean and spread', () => {
    const base = defaultScenario();
    const variant = { ...defaultScenario(), config: applyParams(base.config, { 'inspection.stations': 3 }) };
    const c = compare(base, variant, [1, 2], 1);
    expect(c.baseline.runs.map((r) => r.seed)).toEqual([1, 2]);
    expect(c.variant.runs.map((r) => r.seed)).toEqual([1, 2]);
    const thr = c.rows.find((r) => r.metric.startsWith('Throughput'))!;
    expect(thr.baseline.std).toBeGreaterThanOrEqual(0);
  });
});
