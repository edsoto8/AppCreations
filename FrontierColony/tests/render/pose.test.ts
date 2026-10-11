import { describe, expect, it } from 'vitest';
import type { ActivityKind } from '../../src/sim';
import { badgeFor, computePose, facingFromVector, facingView, newPose, strikeCrossed, swingAngle, workCycle } from '../../src/render/entities/pose';
import { lookFor } from '../../src/render/entities/palettes';

describe('computePose', () => {
  it('walks with opposite leg and arm swing and a bob', () => {
    const p = newPose();
    computePose(p, 'walking', true, 1, Math.PI / 2, false);
    expect(p.legFront).toBeGreaterThan(0.5);
    expect(p.legBack).toBeCloseTo(-p.legFront, 6);
    expect(p.armFront).toBeLessThan(0);
    expect(p.tool).toBeNull();
  });

  it('holds both arms forward while carrying', () => {
    const p = newPose();
    computePose(p, 'carrying', true, 0, 1, true);
    expect(p.armsForward).toBe(true);
  });

  it.each([
    ['chopping', 'axe'],
    ['mining', 'pick'],
    ['building', 'hammer'],
    ['crafting', 'hammer'],
    ['farming', 'hoe'],
  ] as const)('%s uses the %s', (kind, tool) => {
    const p = newPose();
    computePose(p, kind, false, 0.3, 0, false);
    expect(p.tool).toBe(tool);
  });

  it('shows sitting, lying and standing poses', () => {
    const p = newPose();
    computePose(p, 'eating', false, 0, 0, false);
    expect(p.sit).toBe(true);
    computePose(p, 'sleeping', false, 0, 0, false);
    expect(p.lie).toBe(true);
    expect(p.sit).toBe(false);
    computePose(p, 'idle', false, 0, 0, false);
    expect(p.sit || p.lie || p.tool !== null).toBe(false);
  });

  it('is deterministic and resets state between calls', () => {
    const a = newPose();
    const b = newPose();
    computePose(a, 'chopping', false, 0.9, 0, false);
    computePose(a, 'idle', false, 0.9, 0, false);
    computePose(b, 'idle', false, 0.9, 0, false);
    expect(a).toEqual(b);
  });

  it('pulses `strike` right after the tool hits and not mid-swing', () => {
    const p = newPose();
    const c = workCycle('chopping')!;
    computePose(p, 'chopping', false, (c.impactAt + 0.01) * c.period, 0, false);
    expect(p.strike).toBeGreaterThan(0.8);
    computePose(p, 'chopping', false, 0.2 * c.period, 0, false);
    expect(p.strike).toBe(0);
  });
});

describe('swingAngle', () => {
  it('rises slowly to the top, then drops fast to the bottom', () => {
    const up = 2.4;
    const down = 0.3;
    expect(swingAngle(0, 0.6, up, down)).toBeCloseTo(down, 6);
    expect(swingAngle(0.6 - 1e-9, 0.6, up, down)).toBeCloseTo(up, 3);
    expect(swingAngle(0.6 + 0.2 * 0.4, 0.6, up, down)).toBeCloseTo(down, 2);
  });
});

describe('strikeCrossed', () => {
  it('fires once per swing', () => {
    const c = workCycle('mining')!;
    let hits = 0;
    let t = 0;
    for (let i = 0; i < 600; i++) {
      const n = t + 1 / 60;
      if (strikeCrossed('mining', t, n)) hits++;
      t = n;
    }
    // 10 seconds at 1.25 s per swing
    expect(hits).toBe(Math.floor(10 / c.period));
  });

  it('never fires for non-work activities', () => {
    expect(strikeCrossed('walking', 0, 100)).toBe(false);
    expect(strikeCrossed('sleeping', 0, 100)).toBe(false);
  });
});

describe('facing', () => {
  it('maps world directions onto the four iso facings', () => {
    expect(facingFromVector(1, 0, 'nw')).toBe('se');
    expect(facingFromVector(0, 1, 'nw')).toBe('sw');
    expect(facingFromVector(-1, 0, 'se')).toBe('nw');
    expect(facingFromVector(0, -1, 'se')).toBe('ne');
    expect(facingFromVector(0, 0, 'sw')).toBe('sw');
  });

  it('shows the back for north facings and mirrors for west facings', () => {
    expect(facingView('se')).toEqual({ back: false, flip: 1 });
    expect(facingView('sw')).toEqual({ back: false, flip: -1 });
    expect(facingView('ne')).toEqual({ back: true, flip: 1 });
    expect(facingView('nw')).toEqual({ back: true, flip: -1 });
  });
});

describe('badgeFor', () => {
  it('has a badge for work and needs, none for plain movement', () => {
    const withBadge: ActivityKind[] = ['chopping', 'mining', 'building', 'crafting', 'farming', 'fetchingWater', 'eating', 'sleeping', 'resting', 'socializing'];
    for (const k of withBadge) expect(badgeFor(k)).not.toBeNull();
    for (const k of ['idle', 'walking', 'carrying', 'wandering'] as ActivityKind[]) expect(badgeFor(k)).toBeNull();
  });
});

describe('lookFor', () => {
  it('matches the avatar rules (hat on every third shirt, hair style from hair + skin)', () => {
    expect(lookFor({ skin: 0, hair: 0, shirt: 0 }).hat).toBe(true);
    expect(lookFor({ skin: 0, hair: 0, shirt: 1 }).hat).toBe(false);
    expect(lookFor({ skin: 2, hair: 3, shirt: 3 }).hairStyle).toBe(1);
    expect(lookFor({ skin: 1, hair: 1, shirt: 0 }).skin).not.toBe(lookFor({ skin: 5, hair: 1, shirt: 0 }).skin);
  });
});
