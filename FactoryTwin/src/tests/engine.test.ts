import { describe, expect, it } from 'vitest';
import { Engine } from '../simulation/engine';

describe('engine', () => {
  it('processes events in time order and breaks ties by scheduling order', () => {
    const e = new Engine();
    const seen: string[] = [];
    e.on('x', (ev) => seen.push(ev.k));
    e.at(5, 'x', 'c');
    e.at(1, 'x', 'a');
    e.at(5, 'x', 'd');
    e.at(3, 'x', 'b');
    e.at(5, 'x', 'e', 0, 1); // injected class runs after model events at the same time
    e.at(5, 'x', 'f');
    e.advanceTo(10);
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'f', 'e']);
    expect(e.now).toBe(5);
  });

  it('only moves time by processing events', () => {
    const e = new Engine();
    e.on('x', () => {});
    e.at(2, 'x');
    const r = e.advanceTo(100);
    expect(r.time).toBe(2);
    expect(e.now).toBe(2);
    expect(r.complete).toBe(true);
  });

  it('cancels events, including ids that already fired', () => {
    const e = new Engine();
    const seen: number[] = [];
    e.on('x', (ev) => seen.push(ev.n));
    const a = e.at(1, 'x', '', 1);
    const b = e.at(2, 'x', '', 2);
    e.cancel(b);
    e.advanceTo(1.5);
    e.cancel(a); // already processed: no effect
    e.at(3, 'x', '', 3);
    e.advanceTo(10);
    expect(seen).toEqual([1, 3]);
    expect(e.pending).toBe(0);
  });

  it('respects the per-call event cap', () => {
    const e = new Engine();
    e.on('x', () => {});
    for (let i = 0; i < 10; i++) e.at(i, 'x');
    const r = e.advanceTo(100, 4);
    expect(r.events).toBe(4);
    expect(r.complete).toBe(false);
  });

  it('rejects scheduling in the past', () => {
    const e = new Engine();
    e.on('x', () => {});
    e.at(5, 'x');
    e.advanceTo(5);
    expect(() => e.at(4, 'x')).toThrow();
  });
});
