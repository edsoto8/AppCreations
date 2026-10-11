import { describe, expect, it } from 'vitest';
import { screenToTile, tileToScreen } from '../../src/shared/iso';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '../../src/render/camera';

function makeCamera(): Camera {
  const cam = new Camera();
  cam.setViewport(1000, 700);
  cam.setMap(64, 64);
  return cam;
}

function settle(cam: Camera, seconds = 3): void {
  for (let i = 0; i < seconds * 60; i++) cam.update(1 / 60);
}

describe('Camera', () => {
  it('clamps the view centre to the map diamond', () => {
    const cam = makeCamera();
    cam.jumpTo(1e6, -1e6);
    const t = screenToTile(cam.x, cam.y, 0);
    expect(t.x).toBeGreaterThanOrEqual(-1.5 - 1e-6);
    expect(t.x).toBeLessThanOrEqual(64 + 1.5 + 1e-6);
    expect(t.y).toBeGreaterThanOrEqual(-1.5 - 1e-6);
    expect(t.y).toBeLessThanOrEqual(64 + 1.5 + 1e-6);
  });

  it('keeps a centre that is already inside the map untouched', () => {
    const cam = makeCamera();
    const p = tileToScreen(30, 20, 0);
    cam.jumpTo(p.x, p.y);
    expect(cam.x).toBeCloseTo(p.x, 6);
    expect(cam.y).toBeCloseTo(p.y, 6);
  });

  it('limits zoom on both ends', () => {
    const cam = makeCamera();
    cam.zoomAtScreen(1e6, 500, 350);
    settle(cam);
    expect(cam.zoom).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);
    cam.zoomAtScreen(1e-9, 500, 350);
    settle(cam);
    expect(cam.zoom).toBeGreaterThanOrEqual(MIN_ZOOM - 1e-9);
  });

  it('zooms anchored at the cursor: the world point under it does not move', () => {
    const cam = makeCamera();
    const p = tileToScreen(32, 32, 0);
    cam.jumpTo(p.x, p.y);
    const sx = 300;
    const sy = 200;
    const before = cam.screenToWorld(sx, sy);
    cam.zoomAtScreen(1.8, sx, sy);
    settle(cam);
    const after = cam.screenToWorld(sx, sy);
    expect(cam.zoom).toBeCloseTo(1.8, 3);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  it('dragging moves the world with the pointer (centre moves the other way)', () => {
    const cam = makeCamera();
    const p = tileToScreen(32, 32, 0);
    cam.jumpTo(p.x, p.y);
    cam.panByScreen(100, 40);
    expect(cam.x).toBeCloseTo(p.x - 100, 6);
    expect(cam.y).toBeCloseTo(p.y - 40, 6);
  });

  it('glideTo eases to the target and stops there', () => {
    const cam = makeCamera();
    const from = tileToScreen(10, 10, 0);
    const to = tileToScreen(40, 30, 0);
    cam.jumpTo(from.x, from.y);
    cam.glideTo(to.x, to.y);
    cam.update(0.05);
    expect(cam.isAnimating).toBe(true);
    settle(cam, 2);
    expect(cam.x).toBeCloseTo(to.x, 3);
    expect(cam.y).toBeCloseTo(to.y, 3);
    expect(cam.isAnimating).toBe(false);
  });

  it('viewRect shrinks as zoom grows and is centred on the camera', () => {
    const cam = makeCamera();
    const p = tileToScreen(32, 32, 0);
    cam.jumpTo(p.x, p.y, 1);
    const a = cam.viewRect();
    expect((a.x0 + a.x1) / 2).toBeCloseTo(p.x, 6);
    expect(a.x1 - a.x0).toBeCloseTo(1000, 6);
    cam.jumpTo(p.x, p.y, 2);
    const b = cam.viewRect();
    expect(b.x1 - b.x0).toBeCloseTo(500, 6);
  });

  it('key panning accelerates then glides to a stop', () => {
    const cam = makeCamera();
    const p = tileToScreen(32, 32, 0);
    cam.jumpTo(p.x, p.y);
    cam.setKeyDirection(1, 0);
    for (let i = 0; i < 30; i++) cam.update(1 / 60);
    const moved = cam.x - p.x;
    expect(moved).toBeGreaterThan(50);
    cam.setKeyDirection(0, 0);
    settle(cam, 3);
    expect(cam.isAnimating).toBe(false);
  });
});
