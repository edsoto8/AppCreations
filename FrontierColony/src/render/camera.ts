/**
 * Camera: eased pan / zoom / centerOn, drag inertia, map clamping.
 *
 * The camera looks at a point in *world pixels* (the iso screen space of the world container) with a
 * uniform zoom. User input changes a target; `update(dt)` eases the displayed state towards it, so
 * motion is smooth at any frame rate. The world container is positioned from the displayed state.
 */
import type { Container } from 'pixi.js';
import { screenToTile, tileToScreen } from '../shared/iso';
import { clamp } from './util/noise';

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 1;

export interface ViewRectWorld {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Tween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromZoom: number;
  toZoom: number;
  elapsed: number;
  duration: number;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  /** Displayed state. */
  x = 0;
  y = 0;
  zoom = DEFAULT_ZOOM;

  private targetZoom = DEFAULT_ZOOM;
  /** While set, zoom keeps this world point under this screen point. */
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  private tween: Tween | null = null;
  private vx = 0;
  private vy = 0;
  /** Desired velocity from keys, in screen px per second. */
  private keyX = 0;
  private keyY = 0;
  private viewW = 800;
  private viewH = 600;
  private mapW = 64;
  private mapH = 64;
  /** Set whenever the displayed state changed in the last update. */
  moved = true;

  setViewport(w: number, h: number): void {
    if (w === this.viewW && h === this.viewH) return;
    this.viewW = w;
    this.viewH = h;
    this.moved = true;
  }

  setMap(width: number, height: number): void {
    this.mapW = width;
    this.mapH = height;
  }

  get viewWidth(): number {
    return this.viewW;
  }

  get viewHeight(): number {
    return this.viewH;
  }

  /** Jump (no easing) to a world pixel. */
  jumpTo(x: number, y: number, zoom = this.zoom): void {
    this.x = x;
    this.y = y;
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = this.zoom;
    this.tween = null;
    this.anchor = null;
    this.vx = this.vy = 0;
    this.clampToMap();
    this.moved = true;
  }

  /** Ease to a world pixel (tile-space centre already projected). */
  glideTo(x: number, y: number, zoom?: number): void {
    const toZoom = clamp(zoom ?? this.zoom, MIN_ZOOM, MAX_ZOOM);
    const dist = Math.hypot(x - this.x, y - this.y) * this.zoom;
    this.anchor = null;
    this.vx = this.vy = 0;
    this.tween = {
      fromX: this.x,
      fromY: this.y,
      toX: x,
      toY: y,
      fromZoom: this.zoom,
      toZoom,
      elapsed: 0,
      duration: clamp(0.35 + dist / 2600, 0.4, 1.1),
    };
  }

  /** Drag pan by a screen-space delta (moves the world with the pointer). */
  panByScreen(dx: number, dy: number): void {
    this.tween = null;
    this.anchor = null;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampToMap();
    this.moved = true;
  }

  /** Fling after releasing a drag (screen px per second). */
  fling(vxScreen: number, vyScreen: number): void {
    this.vx = -vxScreen / this.zoom;
    this.vy = -vyScreen / this.zoom;
  }

  stopFling(): void {
    this.vx = this.vy = 0;
  }

  setKeyDirection(dx: number, dy: number): void {
    this.keyX = dx;
    this.keyY = dy;
    if (dx !== 0 || dy !== 0) {
      this.tween = null;
      this.anchor = null;
    }
  }

  /** Multiply zoom (eased), keeping the world point under screen point (sx, sy) fixed. */
  zoomAtScreen(factor: number, sx: number, sy: number): void {
    this.tween = null;
    const next = clamp(this.targetZoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (next === this.targetZoom) return;
    if (!this.anchor || Math.abs(this.anchor.sx - sx) > 1 || Math.abs(this.anchor.sy - sy) > 1) {
      const w = this.screenToWorld(sx, sy);
      this.anchor = { sx, sy, wx: w.x, wy: w.y };
    }
    this.targetZoom = next;
  }

  /** Zoom with no easing (pinch gestures track the fingers exactly). */
  zoomAtScreenImmediate(factor: number, sx: number, sy: number): void {
    this.tween = null;
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.targetZoom = this.zoom;
    this.anchor = null;
    this.x = before.x - (sx - this.viewW / 2) / this.zoom;
    this.y = before.y - (sy - this.viewH / 2) / this.zoom;
    this.clampToMap();
    this.moved = true;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + (sx - this.viewW / 2) / this.zoom, y: this.y + (sy - this.viewH / 2) / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.viewW / 2, y: (wy - this.y) * this.zoom + this.viewH / 2 };
  }

  /** Advance the easing by `dt` seconds. */
  update(dt: number): void {
    const px = this.x;
    const py = this.y;
    const pz = this.zoom;
    dt = Math.min(dt, 0.1);

    if (this.tween) {
      const tw = this.tween;
      tw.elapsed += dt;
      const k = easeInOut(clamp(tw.elapsed / tw.duration, 0, 1));
      this.x = tw.fromX + (tw.toX - tw.fromX) * k;
      this.y = tw.fromY + (tw.toY - tw.fromY) * k;
      this.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * k;
      this.targetZoom = this.zoom;
      if (tw.elapsed >= tw.duration) this.tween = null;
    } else {
      // zoom easing in log space
      if (this.zoom !== this.targetZoom) {
        const k = 1 - Math.exp(-dt / 0.085);
        const lz = Math.log(this.zoom);
        const lt = Math.log(this.targetZoom);
        let nz = Math.exp(lz + (lt - lz) * k);
        if (Math.abs(nz - this.targetZoom) / this.targetZoom < 0.0007) nz = this.targetZoom;
        this.zoom = nz;
        if (this.anchor) {
          this.x = this.anchor.wx - (this.anchor.sx - this.viewW / 2) / this.zoom;
          this.y = this.anchor.wy - (this.anchor.sy - this.viewH / 2) / this.zoom;
        }
        if (nz === this.targetZoom) this.anchor = null;
      }
      // keyboard velocity + fling inertia
      const speed = 820 / this.zoom;
      const tvx = this.keyX * speed;
      const tvy = this.keyY * speed;
      const a = 1 - Math.exp(-dt / (this.keyX !== 0 || this.keyY !== 0 ? 0.09 : 0.22));
      this.vx += (tvx - this.vx) * a;
      this.vy += (tvy - this.vy) * a;
      if (Math.abs(this.vx) < 0.5 && Math.abs(this.vy) < 0.5 && tvx === 0 && tvy === 0) {
        this.vx = this.vy = 0;
      } else {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
      }
    }
    const cx = this.x;
    const cy = this.y;
    this.clampToMap();
    if (this.x !== cx) this.vx = 0;
    if (this.y !== cy) this.vy = 0;
    this.moved = this.moved || px !== this.x || py !== this.y || pz !== this.zoom;
  }

  /** Keep the view centre inside the map diamond. */
  private clampToMap(): void {
    const pad = 1.5;
    const t = screenToTile(this.x, this.y, 0);
    const cx = clamp(t.x, -pad, this.mapW + pad);
    const cy = clamp(t.y, -pad, this.mapH + pad);
    if (cx !== t.x || cy !== t.y) {
      const p = tileToScreen(cx, cy, 0);
      this.x = p.x;
      this.y = p.y;
    }
  }

  /** Position the world container from the displayed state. */
  applyTo(world: Container, resolution: number): void {
    world.scale.set(this.zoom);
    // snap to device pixels so static views stay crisp
    const px = Math.round((this.viewW / 2 - this.x * this.zoom) * resolution) / resolution;
    const py = Math.round((this.viewH / 2 - this.y * this.zoom) * resolution) / resolution;
    world.position.set(px, py);
  }

  /** Visible rectangle in world pixels, expanded by `margin` screen pixels. */
  viewRect(margin = 0): ViewRectWorld {
    const hw = (this.viewW / 2 + margin) / this.zoom;
    const hh = (this.viewH / 2 + margin) / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  get isAnimating(): boolean {
    return this.tween !== null || this.zoom !== this.targetZoom || this.vx !== 0 || this.vy !== 0;
  }
}
