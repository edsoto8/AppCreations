import { describe, expect, it } from 'vitest';
import { batteryLevel, fmtClock, fmtCount, fmtDist, fmtPct, fmtRange, humanize, isTypingTarget, manualAxes, toDeg, wheelSpeeds } from '../../src/ui/format';

describe('ui format helpers', () => {
  it('formats sim clock as mm:ss / h:mm:ss', () => {
    expect(fmtClock(0)).toBe('00:00');
    expect(fmtClock(65.9)).toBe('01:05');
    expect(fmtClock(3600 + 61)).toBe('1:01:01');
    expect(fmtClock(-1)).toBe('--:--');
    expect(fmtClock(Number.NaN)).toBe('--:--');
  });

  it('formats percentages, distances, counts and ranges', () => {
    expect(fmtPct(0.423)).toBe('42%');
    expect(fmtPct(1.4)).toBe('100%');
    expect(fmtDist(3.456)).toBe('3.46 m');
    expect(fmtDist(1500)).toBe('1.50 km');
    expect(fmtCount(12345)).toBe('12.3k');
    expect(fmtCount(2_500_000)).toBe('2.5M');
    expect(fmtRange(Infinity)).toBe('clear');
    expect(fmtRange(0.25)).toBe('25 cm');
  });

  it('humanizes identifiers', () => {
    expect(humanize('dustExtraction')).toBe('Dust extraction');
    expect(humanize('no_path')).toBe('No path');
    expect(humanize('')).toBe('');
  });

  it('classifies battery level', () => {
    expect(batteryLevel(0.8)).toBe('ok');
    expect(batteryLevel(0.2)).toBe('warn');
    expect(batteryLevel(0.05)).toBe('error');
  });

  it('normalises degrees', () => {
    expect(toDeg(Math.PI)).toBe(180);
    expect(toDeg(-Math.PI / 2)).toBeCloseTo(-90);
    expect(toDeg(3 * Math.PI)).toBeCloseTo(180);
  });

  it('differential-drive inverse kinematics is consistent with v and ω', () => {
    const L = 0.235;
    const { left, right } = wheelSpeeds(0.2, 1, L);
    expect((left + right) / 2).toBeCloseTo(0.2);
    expect((right - left) / L).toBeCloseTo(1);
  });

  it('maps pressed keys to robot-centric manual axes (left = +turn)', () => {
    expect(manualAxes(new Set(['w']))).toEqual({ forward: 1, turn: 0 });
    expect(manualAxes(new Set(['arrowdown', 'arrowleft']))).toEqual({ forward: -1, turn: 1 });
    expect(manualAxes(new Set(['d']))).toEqual({ forward: 0, turn: -1 });
    expect(manualAxes(new Set(['w', 's', 'a', 'd']))).toEqual({ forward: 0, turn: 0 });
  });

  it('detects text-entry targets for shortcut suppression', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
    expect(isTypingTarget(el('INPUT', { type: 'number' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'range' }))).toBe(false);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
