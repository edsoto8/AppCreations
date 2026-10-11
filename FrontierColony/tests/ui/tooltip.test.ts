import { describe, expect, it } from 'vitest';
import { placeTooltip } from '../../src/ui/components/Tooltip';

const VIEW = { w: 1000, h: 700 };
const anchor = (left: number, top: number, width = 80, height = 40) => ({ left, top, width, height });

describe('placeTooltip', () => {
  it('centres below the anchor when there is room', () => {
    const p = placeTooltip(anchor(400, 100), 200, 60, VIEW.w, VIEW.h, 'bottom');
    expect(p.side).toBe('bottom');
    expect(p.left).toBe(400 + 40 - 100);
    expect(p.top).toBe(100 + 40 + 10);
  });

  it('flips above when there is no room below', () => {
    const p = placeTooltip(anchor(400, 650), 200, 60, VIEW.w, VIEW.h, 'bottom');
    expect(p.side).toBe('top');
    expect(p.top).toBe(650 - 10 - 60);
  });

  it('flips below when a top tooltip would leave the screen', () => {
    expect(placeTooltip(anchor(400, 5), 200, 60, VIEW.w, VIEW.h, 'top').side).toBe('bottom');
  });

  it('clamps horizontally inside the viewport', () => {
    const left = placeTooltip(anchor(0, 100, 30), 300, 50, VIEW.w, VIEW.h, 'bottom');
    expect(left.left).toBe(8);
    const right = placeTooltip(anchor(980, 100, 20), 300, 50, VIEW.w, VIEW.h, 'bottom');
    expect(right.left).toBe(VIEW.w - 300 - 8);
  });

  it('never goes off screen even when it fits on neither side', () => {
    const p = placeTooltip(anchor(100, 100, 50, 500), 200, 400, VIEW.w, VIEW.h, 'bottom');
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 400).toBeLessThanOrEqual(VIEW.h - 8);
  });

  it('supports side placement', () => {
    const p = placeTooltip(anchor(100, 300), 150, 60, VIEW.w, VIEW.h, 'right');
    expect(p.side).toBe('right');
    expect(p.left).toBe(100 + 80 + 10);
  });
});
