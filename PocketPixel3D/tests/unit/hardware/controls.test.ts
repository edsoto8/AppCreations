import { describe, expect, it } from 'vitest';
import { AnimatedValue, Ease, progressBetween } from '../../../src/animation/Tween';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../../src/app/Settings';
import { ButtonSystem } from '../../../src/hardware/ButtonSystem';
import { DialControl } from '../../../src/hardware/VolumeControl';
import { KEY_BINDINGS } from '../../../src/interaction/InputManager';

describe('ButtonSystem', () => {
  it('reports press and release edges per tick', () => {
    const b = new ButtonSystem();
    b.press('a', 'keyboard');
    b.latch();
    expect(b.isDown('a')).toBe(true);
    expect(b.wasPressed('a')).toBe(true);
    b.latch();
    expect(b.wasPressed('a')).toBe(false);
    expect(b.isDown('a')).toBe(true);
    b.release('a', 'keyboard');
    b.latch();
    expect(b.wasReleased('a')).toBe(true);
    expect(b.isDown('a')).toBe(false);
  });

  it('latches a tap that starts and ends between ticks', () => {
    const b = new ButtonSystem();
    b.press('start', 'pointer');
    b.release('start', 'pointer');
    b.latch();
    expect(b.wasPressed('start')).toBe(true);
    b.latch();
    expect(b.isDown('start')).toBe(false);
  });

  it('keeps a button held until every source lets go', () => {
    const b = new ButtonSystem();
    const changes: string[] = [];
    b.onChange((id, down) => changes.push(`${id}:${down}`));
    b.press('left', 'keyboard');
    b.press('left', 'pointer');
    b.release('left', 'keyboard');
    expect(b.isHeld('left')).toBe(true);
    b.release('left', 'pointer');
    expect(b.isHeld('left')).toBe(false);
    expect(changes).toEqual(['left:true', 'left:false']);
  });

  it('releaseAll(source) only clears that source', () => {
    const b = new ButtonSystem();
    b.press('a', 'keyboard');
    b.press('b', 'pointer');
    b.releaseAll('keyboard');
    expect(b.isHeld('a')).toBe(false);
    expect(b.isHeld('b')).toBe(true);
  });
});

describe('DialControl', () => {
  it('clamps and steps in detents', () => {
    const d = new DialControl('volume', 0.5, 0.05);
    const seen: number[] = [];
    d.onChange((v) => seen.push(v));
    d.step(2);
    expect(d.value).toBeCloseTo(0.6);
    d.set(5);
    expect(d.value).toBe(1);
    d.set(-1);
    expect(d.value).toBe(0);
    d.set(0);
    expect(seen).toHaveLength(3);
  });
});

describe('AnimatedValue', () => {
  it('reaches its target deterministically', () => {
    const v = new AnimatedValue(0);
    v.animateTo(10, 1, Ease.linear);
    v.update(0.25);
    expect(v.value).toBeCloseTo(2.5);
    v.update(1);
    expect(v.value).toBe(10);
    expect(v.active).toBe(false);
  });

  it('reverses mid-flight from the current value without jumping', () => {
    const v = new AnimatedValue(0);
    v.animateTo(1, 1, Ease.linear);
    v.update(0.4);
    v.animateTo(0, 1, Ease.linear);
    expect(v.value).toBeCloseTo(0.4);
    v.update(0.5);
    expect(v.value).toBeCloseTo(0.2);
  });

  it('progressBetween clamps', () => {
    expect(progressBetween(5, 0, 10)).toBe(0.5);
    expect(progressBetween(-1, 0, 10)).toBe(0);
    expect(progressBetween(20, 0, 10)).toBe(1);
  });
});

describe('Settings', () => {
  it('falls back to defaults for missing or malicious data', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ volume: 9, contrast: 'x', lighting: 'evil', idleMotion: 1, muted: true, lastCartridge: 42 });
    expect(s.volume).toBe(1);
    expect(s.contrast).toBe(DEFAULT_SETTINGS.contrast);
    expect(s.lighting).toBe('studio');
    expect(s.idleMotion).toBe(DEFAULT_SETTINGS.idleMotion);
    expect(s.muted).toBe(true);
    expect(s.lastCartridge).toBe(DEFAULT_SETTINGS.lastCartridge);
  });
});

describe('Key bindings', () => {
  it('match the documented controls', () => {
    expect(KEY_BINDINGS.ArrowUp).toBe('up');
    expect(KEY_BINDINGS.KeyZ).toBe('a');
    expect(KEY_BINDINGS.KeyX).toBe('b');
    expect(KEY_BINDINGS.Enter).toBe('start');
    expect(KEY_BINDINGS.ShiftLeft).toBe('select');
    expect(KEY_BINDINGS.ShiftRight).toBe('select');
  });
});
