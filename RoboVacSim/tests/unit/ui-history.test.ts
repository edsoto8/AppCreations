import { describe, expect, it } from 'vitest';
import { SeriesHistory } from '../../src/ui/history';

describe('SeriesHistory', () => {
  it('samples at the configured interval', () => {
    const h = new SeriesHistory(['a'] as const, 10, 1);
    for (let t = 0; t <= 5; t += 0.25) h.push(t, { a: t });
    expect(h.series('a')).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('decimates 2:1 and doubles the interval when full, keeping the whole run', () => {
    const h = new SeriesHistory(['a'] as const, 8, 1);
    for (let t = 0; t <= 8; t++) h.push(t, { a: t });
    expect(h.length).toBeLessThanOrEqual(8);
    expect(h.sampleInterval).toBe(2);
    expect(h.series('a')[0]).toBe(0);
    for (let t = 9; t <= 40; t++) h.push(t, { a: t });
    expect(h.length).toBeLessThanOrEqual(8);
    expect(h.series('a')[0]).toBe(0);
  });

  it('rolling mode keeps only the latest samples', () => {
    const h = new SeriesHistory(['a'] as const, 3, 0, 'rolling');
    for (let t = 0; t < 6; t++) h.push(t, { a: t });
    expect(h.series('a')).toEqual([3, 4, 5]);
  });

  it('clears when time goes backwards (sim reset) and notifies subscribers', () => {
    const h = new SeriesHistory(['a', 'b'] as const, 10, 1);
    let calls = 0;
    const un = h.subscribe(() => calls++);
    h.push(0, { a: 1, b: 2 });
    h.push(5, { a: 1, b: 2 });
    h.push(1, { a: 9, b: 9 });
    expect(h.series('a')).toEqual([9]);
    expect(h.series('b')).toEqual([9]);
    expect(calls).toBe(3);
    un();
    h.push(10, { a: 0, b: 0 });
    expect(calls).toBe(3);
  });
});
