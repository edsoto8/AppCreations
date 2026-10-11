import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, createUiStore, mergeToast, type Toast } from '../../src/store';

const t = (toasts: Toast[], msg: string, sev: Toast['severity'] = 'info', id = toasts.length + 1, now = 1000 + id) => mergeToast(toasts, msg, sev, id, now);

describe('toast grouping', () => {
  it('counts identical messages instead of stacking them', () => {
    let toasts: Toast[] = [];
    toasts = t(toasts, 'Not enough wood.', 'warning', 1);
    toasts = t(toasts, 'Not enough wood.', 'warning', 2);
    toasts = t(toasts, 'Not enough wood.', 'warning', 3);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ id: 1, count: 3, message: 'Not enough wood.' });
    expect(toasts[0]!.updatedAt).toBeGreaterThan(toasts[0]!.createdAt);
  });

  it('adds up gains and losses of the same thing', () => {
    let toasts: Toast[] = [];
    for (const m of ['+5 wood', '+3 wood', '+4 wood']) toasts = t(toasts, m, 'good');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ message: '+12 wood', count: 3 });
    toasts = t(toasts, '+2 stone', 'good');
    toasts = t(toasts, '−3 wood', 'good');
    expect(toasts.map((x) => x.message)).toEqual(['+12 wood', '+2 stone', '−3 wood']);
  });

  it('does not merge across severities and moves the merged toast to the end', () => {
    let toasts: Toast[] = [];
    toasts = t(toasts, 'A', 'info', 1);
    toasts = t(toasts, 'B', 'info', 2);
    toasts = t(toasts, 'A', 'danger', 3);
    expect(toasts.map((x) => `${x.message}:${x.severity}`)).toEqual(['A:info', 'B:info', 'A:danger']);
    toasts = t(toasts, 'A', 'info', 4);
    expect(toasts.map((x) => `${x.message}:${x.severity}`)).toEqual(['B:info', 'A:danger', 'A:info']);
    expect(toasts[2]).toMatchObject({ count: 2, severity: 'info' });
  });

  it('still caps the stack', () => {
    let toasts: Toast[] = [];
    for (let i = 0; i < MAX_TOASTS + 3; i++) toasts = t(toasts, `m${i}`, 'info', i + 1);
    expect(toasts).toHaveLength(MAX_TOASTS);
  });

  it('is wired into the store', () => {
    const store = createUiStore();
    for (let i = 0; i < 5; i++) store.getState().pushToast('+5 wood', 'good');
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0]).toMatchObject({ message: '+25 wood', count: 5 });
  });
});
