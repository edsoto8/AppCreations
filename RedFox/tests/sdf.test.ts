import { describe, expect, it } from 'vitest';
import { sculptFox } from '../src/fox/anatomy';
import { Ellipsoid, RoundCone, Sphere, smin } from '../src/fox/sdf/primitives';
import { SdfModel } from '../src/fox/sdf/SdfModel';

describe('SDF primitives', () => {
  it('sphere is exact', () => {
    const s = new Sphere([1, 0, 0], 0.5);
    expect(s.eval(1, 0, 0)).toBeCloseTo(-0.5);
    expect(s.eval(2, 0, 0)).toBeCloseTo(0.5);
  });

  it('ellipsoid has the right sign on and around its axes', () => {
    const e = new Ellipsoid([0, 0, 0], [0.1, 0.2, 0.3]);
    expect(e.eval(0, 0, 0)).toBeLessThan(0);
    expect(Math.abs(e.eval(0.1, 0, 0))).toBeLessThan(1e-6);
    expect(Math.abs(e.eval(0, 0, 0.3))).toBeLessThan(1e-6);
    expect(e.eval(0, 0.25, 0)).toBeGreaterThan(0);
  });

  it('round cone interpolates radius between its ends', () => {
    const c = new RoundCone([0, 0, 0], [0, 1, 0], 0.2, 0.1);
    expect(c.eval(0.2, 0, 0)).toBeCloseTo(0, 2);
    expect(c.eval(0.1, 1, 0)).toBeCloseTo(0, 2);
    expect(c.eval(0, 0.5, 0)).toBeLessThan(0);
  });

  it('smooth min never exceeds the hard min', () => {
    for (const [a, b] of [[0.1, 0.2], [-0.3, 0.05], [0.4, 0.4]]) {
      expect(smin(a, b, 0.05)).toBeLessThanOrEqual(Math.min(a, b));
    }
  });
});

describe('accelerated evaluation', () => {
  it('matches the brute-force field near the surface', () => {
    const { model, bounds } = sculptFox();
    const brute = new SdfModel();
    for (const p of model.parts) brute.add(p);
    model.accelerate(bounds.min, bounds.max, 0.03, 0.13);
    let checked = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20000; i++) {
      const x = bounds.min[0] + rnd() * (bounds.max[0] - bounds.min[0]);
      const y = bounds.min[1] + rnd() * (bounds.max[1] - bounds.min[1]);
      const z = bounds.min[2] + rnd() * (bounds.max[2] - bounds.min[2]);
      const exact = brute.eval(x, y, z);
      if (Math.abs(exact) > 0.05) continue;
      // Bound-type primitives can contribute a sub-micron blend from beyond the reach.
      expect(Math.abs(model.eval(x, y, z) - exact)).toBeLessThan(1e-5);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });
});
