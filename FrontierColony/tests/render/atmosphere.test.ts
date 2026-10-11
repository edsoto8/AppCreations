import { describe, expect, it } from 'vitest';
import { ambientColor, dayFactor, isNeutral, lightStrength, twilight, weatherTint } from '../../src/render/atmosphere/daylight';
import { NEUTRAL_LOOK, seasonLook } from '../../src/render/atmosphere/seasons';
import { fixturesFor, lightPointsFor } from '../../src/render/atmosphere/lightPoints';
import { BUILDING_TYPES } from '../../src/sim';

describe('dayFactor', () => {
  it('is dark at night, bright by day and smooth through dawn and dusk', () => {
    expect(dayFactor(2)).toBe(0);
    expect(dayFactor(23)).toBe(0);
    expect(dayFactor(12)).toBe(1);
    let prev = 0;
    for (let h = 5; h <= 8; h += 0.25) {
      const d = dayFactor(h);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    for (let h = 17; h <= 20; h += 0.25) {
      const d = dayFactor(h);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it('wraps hours outside 0..24', () => {
    expect(dayFactor(36)).toBe(dayFactor(12));
    expect(dayFactor(-1)).toBe(dayFactor(23));
  });
});

describe('twilight and lights', () => {
  it('peaks at golden hour and vanishes at noon and midnight', () => {
    expect(twilight(6.5)).toBeCloseTo(1, 6);
    expect(twilight(18.6)).toBeCloseTo(1, 6);
    expect(twilight(12)).toBe(0);
    expect(twilight(0)).toBe(0);
  });

  it('lights glow at night, are off by day and ramp in between', () => {
    expect(lightStrength(23)).toBe(1);
    expect(lightStrength(12)).toBe(0);
    expect(lightStrength(19)).toBeGreaterThan(0.2);
    expect(lightStrength(19)).toBeLessThan(1);
  });
});

describe('ambientColor', () => {
  it('is neutral on a clear day so the overlay can be skipped', () => {
    expect(isNeutral(ambientColor(12, 'clear', 0, 0))).toBe(true);
  });

  it('is a cool, dim blue at night', () => {
    const [r, g, b] = ambientColor(1, 'clear', 0, 0);
    expect(b).toBeGreaterThan(r);
    expect(r).toBeLessThan(0.5);
    expect(isNeutral([r, g, b])).toBe(false);
  });

  it('is warm at dawn (more red than blue)', () => {
    const [r, , b] = ambientColor(6.5, 'clear', 0, 0);
    expect(r).toBeGreaterThan(b);
  });

  it('storms are darker than clear skies; drought is warmer', () => {
    const clear = ambientColor(12, 'clear', 0, 0);
    const storm = ambientColor(12, 'storm', 1, 0);
    expect(storm[0] + storm[1] + storm[2]).toBeLessThan(clear[0] + clear[1] + clear[2]);
    const dry = ambientColor(12, 'clear', 0, 1);
    expect(dry[2]).toBeLessThan(dry[0]);
  });

  it('weather intensity scales the tint', () => {
    const light = weatherTint('rain', 0.1, 0).tint;
    const heavy = weatherTint('rain', 1, 0).tint;
    expect(heavy[0]).toBeLessThan(light[0]);
  });
});

describe('seasonLook', () => {
  const t = (day: number, hour: number, season: 'spring' | 'summer' | 'autumn' | 'winter') => ({ day, timeOfDay: hour, season });

  it('is fully in effect after the first day of a season', () => {
    expect(seasonLook(t(18, 12, 'winter'), 0, 'clear', 0).snow).toBe(1);
    expect(seasonLook(t(13, 12, 'autumn'), 0, 'clear', 0).autumn).toBe(1);
    expect(seasonLook(t(3, 12, 'spring'), 0, 'clear', 0).snow).toBe(0);
  });

  it('blends gradually into winter: snow grows over the first days, not at once', () => {
    const samples = [0, 6, 12, 18, 23].map((h) => seasonLook(t(16, h, 'winter'), 0, 'clear', 0).snow);
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    expect(samples[0]!).toBeLessThan(0.2);
    expect(samples[4]!).toBeLessThan(1);
  });

  it('trees go autumn then bare: autumn stays on while bare rises', () => {
    const early = seasonLook(t(16, 6, 'winter'), 0, 'clear', 0);
    expect(early.autumn).toBeGreaterThan(0.5);
    expect(early.bare).toBeLessThan(early.autumn);
    const late = seasonLook(t(19, 12, 'winter'), 0, 'clear', 0);
    expect(late.bare).toBe(1);
  });

  it('starts a new game in clean spring, not blended from a winter that never happened', () => {
    const l = seasonLook(t(1, 6, 'spring'), 0, 'clear', 0);
    expect(l.snow).toBe(0);
    expect(l.bare).toBe(0);
  });

  it('falling snow dusts the ground before winter proper and drought sets dryness', () => {
    const dust = seasonLook(t(12, 12, 'autumn'), 0, 'snow', 1);
    expect(dust.snow).toBeGreaterThan(0);
    expect(seasonLook(t(8, 12, 'summer'), 1, 'clear', 0).dry).toBe(1);
  });

  it('changes its key only when a quantised channel changes', () => {
    const a = seasonLook(t(8, 12, 'summer'), 0, 'clear', 0);
    const b = seasonLook(t(8, 12.01, 'summer'), 0, 'clear', 0);
    expect(a.key).toBe(b.key);
    expect(seasonLook(t(18, 12, 'winter'), 0, 'clear', 0).key).not.toBe(a.key);
    expect(NEUTRAL_LOOK.key).toBe('neutral');
  });
});

describe('light points', () => {
  it('every lit building type returns finite positions, and fixtures stay in sync', () => {
    for (const type of BUILDING_TYPES) {
      for (const p of lightPointsFor(type)) {
        expect(Number.isFinite(p.u + p.v + p.h)).toBe(true);
        expect(p.size).toBeGreaterThan(0);
      }
      for (const f of fixturesFor(type)) {
        // every fixture has a matching fire light at the same spot
        expect(lightPointsFor(type).some((p) => p.kind === 'fire' && Math.abs(p.u - f.u) < 0.01 && Math.abs(p.v - f.v) < 0.01)).toBe(true);
      }
    }
  });

  it('houses only light up when occupied; the town center always does', () => {
    expect(lightPointsFor('house').every((p) => p.needsOccupant)).toBe(true);
    expect(lightPointsFor('townCenter').some((p) => !p.needsOccupant)).toBe(true);
  });
});
