import type { AppApi } from '../../app/types';
import type { Simulation } from '../../sim/Simulation';
import { ROBOT } from '../../sim/robot/robotSpec';
import type { Rect, Vec2 } from '../../sim/world/types';

export interface MapLayers {
  occupancy: boolean;
  costmap: boolean;
  cleaned: boolean;
  dirt: boolean;
  lidar: boolean;
  path: boolean;
  lanes: boolean;
  trail: boolean;
  rooms: boolean;
  zones: boolean;
  cliffs: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  occupancy: true,
  costmap: false,
  cleaned: true,
  dirt: false,
  lidar: true,
  path: true,
  lanes: true,
  trail: true,
  rooms: true,
  zones: true,
  cliffs: true,
};

export const LAYER_LABELS: Array<{ key: keyof MapLayers; label: string; swatch: string }> = [
  { key: 'occupancy', label: 'Occupancy map', swatch: '#e2ecf2' },
  { key: 'costmap', label: 'Inflated costmap', swatch: '#9b7bff' },
  { key: 'cleaned', label: 'Cleaned area', swatch: '#46e0c8' },
  { key: 'dirt', label: 'Dirt heatmap', swatch: '#ff8a3d' },
  { key: 'lidar', label: 'LiDAR scan', swatch: '#5ad1ff' },
  { key: 'path', label: 'Planned path', swatch: '#46e0c8' },
  { key: 'lanes', label: 'Remaining lanes', swatch: '#2d8f80' },
  { key: 'trail', label: 'Past trajectory', swatch: '#f5b544' },
  { key: 'rooms', label: 'Rooms & labels', swatch: '#8fa3b5' },
  { key: 'zones', label: 'No-go / no-mop zones', swatch: '#ff5d5d' },
  { key: 'cliffs', label: 'Cliffs & low obstacles', swatch: '#ff5d5d' },
];

/** UI state the renderer reads every frame (from the stores, via a getter). */
export interface MapUiSnapshot {
  selectedRooms: readonly string[];
  roomsMode: boolean;
  spot: Vec2 | null;
  tool: string;
}

const SPOT_SIZE = 1.6;
const RASTER_INTERVAL_MS = 250;

/**
 * Draws the robot's map onto a canvas in its own requestAnimationFrame loop. Raster layers (occupancy,
 * costmap, cleaned, dirt, cliffs) are composed at grid resolution into an offscreen canvas only when
 * their source versions change (≤ 4 Hz) and scaled with drawImage; vector layers are drawn per frame.
 * Reads `api.sim` each frame (it is replaced on reset) and never mutates it.
 */
export class MapRenderer {
  layers: MapLayers = { ...DEFAULT_LAYERS };
  zoom = 1;
  /** Pan offset of the view center from the house center (m). */
  pan = { x: 0, y: 0 };
  hover: Vec2 | null = null;
  dragRect: Rect | null = null;

  private readonly ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  private readonly raster: HTMLCanvasElement;
  private readonly rctx: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  private lastBuild = 0;
  private builtKey = '';
  private builtSim: Simulation | null = null;
  private dirtRef = { solids: 0, sim: null as Simulation | null };
  private hatch: { noGo: CanvasPattern | null; noMop: CanvasPattern | null } = { noGo: null, noMop: null };
  private t0 = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getApi: () => AppApi | null,
    private readonly getUi: () => MapUiSnapshot,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unsupported');
    this.ctx = ctx;
    this.raster = document.createElement('canvas');
    const rctx = this.raster.getContext('2d');
    if (!rctx) throw new Error('2D canvas unsupported');
    this.rctx = rctx;
    this.hatch.noGo = this.makeHatch('rgba(255,93,93,0.85)');
    this.hatch.noMop = this.makeHatch('rgba(90,169,255,0.85)');
  }

  private makeHatch(color: string): CanvasPattern | null {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const x = c.getContext('2d');
    if (!x) return null;
    x.strokeStyle = color;
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(-2, 10);
    x.lineTo(10, -2);
    x.moveTo(-2, 2);
    x.lineTo(2, -2);
    x.moveTo(6, 10);
    x.lineTo(10, 6);
    x.stroke();
    return this.ctx.createPattern(c, 'repeat');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number, dpr: number): void {
    this.cssW = Math.max(1, Math.round(w));
    this.cssH = Math.max(1, Math.round(h));
    this.dpr = Math.min(3, Math.max(1, dpr));
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  /** Force the raster to rebuild on the next frame (layer toggles). */
  invalidate(): void {
    this.builtKey = '';
    this.lastBuild = 0;
  }

  fit(): void {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
  }

  zoomBy(factor: number, at?: { px: number; py: number }): void {
    const before = at ? this.toWorld(at.px, at.py) : null;
    this.zoom = Math.min(10, Math.max(1, this.zoom * factor));
    if (this.zoom === 1) this.pan = { x: 0, y: 0 };
    else if (before && at) {
      this.updateTransform();
      const after = this.toWorld(at.px, at.py);
      if (before && after) {
        this.pan.x += before.x - after.x;
        this.pan.y += before.y - after.y;
      }
    }
  }

  panBy(dpx: number, dpy: number): void {
    this.pan.x -= dpx / this.scale;
    this.pan.y -= dpy / this.scale;
  }

  /** CSS-pixel → world (m). Null before the first layout. */
  toWorld(px: number, py: number): Vec2 | null {
    if (!this.getApi()) return null;
    this.updateTransform();
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  /** Index into sim.layout.rooms at a world point (-1 if none). */
  roomAt(p: Vec2): number {
    const api = this.getApi();
    if (!api) return -1;
    return api.sim.world.roomAt(p.x, p.y);
  }

  private updateTransform(): void {
    const api = this.getApi();
    if (!api) return;
    const b = api.sim.layout.bounds;
    const pad = 16;
    const fit = Math.min((this.cssW - 2 * pad) / b.w, (this.cssH - 2 * pad) / b.h);
    this.scale = Math.max(1e-3, fit * this.zoom);
    const cx = b.x + b.w / 2 + this.pan.x;
    const cy = b.y + b.h / 2 + this.pan.y;
    this.ox = this.cssW / 2 - cx * this.scale;
    this.oy = this.cssH / 2 - cy * this.scale;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden || this.cssW < 4 || this.cssH < 4 || !this.canvas.isConnected) return;
    const api = this.getApi();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!api) return;
    const sim = api.sim;
    this.updateTransform();
    this.maybeRebuildRaster(sim, now);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw(sim, now);
  };

  // ------------------------------------------------------------------ raster

  private maybeRebuildRaster(sim: Simulation, now: number): void {
    const m = sim.map;
    const L = this.layers;
    const key = [
      m.occ.version,
      L.costmap ? m.costmapVersion : 0,
      m.layersVersion,
      L.cleaned || L.dirt ? sim.dirt.version : 0,
      L.occupancy,
      L.costmap,
      L.cleaned,
      L.dirt,
      L.cliffs,
    ].join('|');
    const simChanged = sim !== this.builtSim;
    if (!simChanged && key === this.builtKey) return;
    if (!simChanged && this.builtKey !== '' && now - this.lastBuild < RASTER_INTERVAL_MS) return;
    this.buildRaster(sim);
    this.builtKey = key;
    this.builtSim = sim;
    this.lastBuild = now;
  }

  private buildRaster(sim: Simulation): void {
    const g = sim.map.geom;
    if (this.raster.width !== g.width || this.raster.height !== g.height || !this.image) {
      this.raster.width = g.width;
      this.raster.height = g.height;
      this.image = this.rctx.createImageData(g.width, g.height);
    }
    const px = this.image.data;
    const L = this.layers;
    const occ = sim.map.occ;
    const lo = occ.logOdds;
    const { occThreshold, freeThreshold } = occ.params;
    const cost = sim.map.costmap.cost;
    const low = sim.map.lowObstacles;
    const cliffs = sim.map.cliffs;
    const dirt = sim.dirt;
    const passes = dirt.passes;
    const inHouse = sim.world.surface;

    if (L.dirt && this.dirtRef.sim !== sim) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < g.size; i++) {
        const v = dirt.dust[i] + dirt.crumbs[i] + dirt.hair[i];
        if (v > 0) {
          sum += v;
          n++;
        }
      }
      this.dirtRef = { solids: n ? (sum / n) * 3 : 1, sim };
    }
    const refS = this.dirtRef.solids || 1;

    for (let i = 0, p = 0; i < g.size; i++, p += 4) {
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      // "over" compositing in straight alpha
      const over = (cr: number, cg: number, cb: number, ca: number) => {
        const na = ca + a * (1 - ca);
        if (na <= 0) return;
        r = (cr * ca + r * a * (1 - ca)) / na;
        gg = (cg * ca + gg * a * (1 - ca)) / na;
        b = (cb * ca + b * a * (1 - ca)) / na;
        a = na;
      };
      const l = lo[i];
      const occupied = l > occThreshold;
      const free = l < freeThreshold;
      if (L.occupancy) {
        if (occupied) over(226, 236, 242, 1);
        else if (free) over(44, 60, 77, 1);
      }
      if (L.costmap && !occupied) {
        const c = cost[i];
        if (c >= 1 && c <= 252) over(155, 120, 255, 0.07 + 0.38 * (c / 252));
        else if (c === 253) over(155, 120, 255, 0.55);
        else if (c === 255) over(255, 90, 140, 0.55);
      }
      if (L.cleaned && passes[i] > 0 && !occupied) over(70, 224, 200, passes[i] > 1 ? 0.5 : 0.32);
      if (L.dirt && inHouse[i] !== 255) {
        const solids = dirt.dust[i] + dirt.crumbs[i] + dirt.hair[i];
        const t = Math.min(1, Math.max(Math.sqrt(solids / refS), dirt.liquid[i] / 0.4, dirt.stain[i] / 0.6));
        if (t > 0.03) {
          // inferno-like ramp: violet → magenta → orange → yellow
          const c = ramp(t);
          over(c[0], c[1], c[2], 0.2 + 0.65 * t);
        }
      }
      if (L.cliffs) {
        if (cliffs[i]) over(255, 84, 84, 1);
        else if (low[i]) over(255, 160, 70, 0.95);
      }
      px[p] = r;
      px[p + 1] = gg;
      px[p + 2] = b;
      px[p + 3] = a * 255;
    }
    this.rctx.putImageData(this.image, 0, 0);
  }

  // ------------------------------------------------------------------ vector layers

  private sx(x: number): number {
    return this.ox + x * this.scale;
  }

  private sy(y: number): number {
    return this.oy + y * this.scale;
  }

  private draw(sim: Simulation, now: number): void {
    const ctx = this.ctx;
    const L = this.layers;
    const ui = this.getUi();
    const s = this.scale;
    const layout = sim.layout;
    const g = sim.map.geom;
    const t = (now - this.t0) / 1000;

    // House footprint (ground-truth room plan, faint) for orientation.
    if (L.rooms) {
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      for (const room of layout.rooms) for (const q of room.rects) ctx.fillRect(this.sx(q.x), this.sy(q.y), q.w * s, q.h * s);
    }

    // Raster.
    ctx.imageSmoothingEnabled = g.cellSize * s < 4;
    ctx.drawImage(this.raster, 0, 0, g.width, g.height, this.sx(g.originX), this.sy(g.originY), g.width * g.cellSize * s, g.height * g.cellSize * s);

    // Rooms: selection fill + outlines.
    const selected = new Set(ui.selectedRooms);
    const hoverRoom = this.hover ? sim.world.roomAt(this.hover.x, this.hover.y) : -1;
    if (L.rooms || ui.roomsMode) {
      layout.rooms.forEach((room, ri) => {
        const sel = selected.has(room.id);
        const hov = ui.roomsMode && ri === hoverRoom;
        if (!sel && !hov && !L.rooms) return;
        for (const q of room.rects) {
          const x = this.sx(q.x);
          const y = this.sy(q.y);
          if (sel) {
            ctx.fillStyle = 'rgba(70,224,200,0.14)';
            ctx.fillRect(x, y, q.w * s, q.h * s);
          }
          if (hov) {
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y, q.w * s, q.h * s);
          }
        }
        ctx.strokeStyle = sel ? 'rgba(70,224,200,0.9)' : hov ? 'rgba(255,255,255,0.45)' : 'rgba(160,180,200,0.16)';
        ctx.lineWidth = sel ? 1.6 : 1;
        ctx.setLineDash(sel ? [] : [3, 3]);
        for (const q of room.rects) ctx.strokeRect(this.sx(q.x) + 0.5, this.sy(q.y) + 0.5, q.w * s - 1, q.h * s - 1);
        ctx.setLineDash([]);
      });
    }

    // Zones.
    if (L.zones) {
      for (const z of layout.zones) {
        const x = this.sx(z.rect.x);
        const y = this.sy(z.rect.y);
        const w = z.rect.w * s;
        const h = z.rect.h * s;
        const noGo = z.kind === 'noGo';
        ctx.fillStyle = noGo ? 'rgba(255,93,93,0.12)' : 'rgba(90,169,255,0.12)';
        ctx.fillRect(x, y, w, h);
        const pat = noGo ? this.hatch.noGo : this.hatch.noMop;
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fillRect(x, y, w, h);
        }
        ctx.strokeStyle = noGo ? '#ff5d5d' : '#5aa9ff';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
    }

    // Spot target area.
    if (ui.spot) {
      const half = SPOT_SIZE / 2;
      ctx.strokeStyle = 'rgba(245,181,68,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(this.sx(ui.spot.x - half), this.sy(ui.spot.y - half), SPOT_SIZE * s, SPOT_SIZE * s);
      ctx.setLineDash([]);
      this.cross(this.sx(ui.spot.x), this.sy(ui.spot.y), 5, 'rgba(245,181,68,1)');
    }

    // Remaining coverage lanes.
    const ctrl = sim.ctrl;
    if (L.lanes && ctrl.mission) {
      ctx.strokeStyle = 'rgba(70,224,200,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const tasks = ctrl.mission.tasks;
      const n = Math.min(tasks.length, 600);
      for (let k = 0; k < n; k++) {
        const pts = tasks[k].points;
        if (pts.length < 2) continue;
        ctx.moveTo(this.sx(pts[0].x), this.sy(pts[0].y));
        for (let q = 1; q < pts.length; q++) ctx.lineTo(this.sx(pts[q].x), this.sy(pts[q].y));
      }
      ctx.stroke();
      const cur = ctrl.currentTask;
      if (cur && cur.points.length > 1) {
        ctx.strokeStyle = 'rgba(70,224,200,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.sx(cur.points[0].x), this.sy(cur.points[0].y));
        for (let q = 1; q < cur.points.length; q++) ctx.lineTo(this.sx(cur.points[q].x), this.sy(cur.points[q].y));
        ctx.stroke();
      }
    }

    // Past trajectory.
    if (L.trail && sim.trailCount > 1) {
      ctx.strokeStyle = 'rgba(245,181,68,0.55)';
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let first = true;
      sim.forEachTrail((x, y) => {
        if (first) {
          ctx.moveTo(this.sx(x), this.sy(y));
          first = false;
        } else ctx.lineTo(this.sx(x), this.sy(y));
      });
      ctx.lineTo(this.sx(sim.body.x), this.sy(sim.body.y));
      ctx.stroke();
    }

    const b = sim.body;
    const lox = b.x + Math.cos(b.theta) * ROBOT.lidarOffsetX;
    const loy = b.y + Math.sin(b.theta) * ROBOT.lidarOffsetX;

    // LiDAR: current scan rays + recent point cloud.
    if (L.lidar && sim.lidar.spinning) {
      const ranges = sim.lidar.scanRanges;
      const angles = sim.lidar.scanAngles;
      ctx.strokeStyle = 'rgba(90,209,255,0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < ranges.length; i += 2) {
        const r = ranges[i];
        if (!(r > 0)) continue;
        const a = b.theta + angles[i];
        ctx.moveTo(this.sx(lox), this.sy(loy));
        ctx.lineTo(this.sx(lox + Math.cos(a) * r), this.sy(loy + Math.sin(a) * r));
      }
      ctx.stroke();
    }
    if (L.lidar) {
      const cloud = sim.lidar.cloud;
      const cnt = sim.lidar.cloudCount;
      ctx.fillStyle = 'rgba(90,209,255,0.75)';
      const d = Math.max(1.2, Math.min(2.4, s * 0.03));
      for (let i = 0; i < cnt; i++) ctx.fillRect(this.sx(cloud[i * 2]) - d / 2, this.sy(cloud[i * 2 + 1]) - d / 2, d, d);
    }

    // Planned path.
    if (L.path) {
      const path = sim.nav.remainingPath(b.x, b.y);
      if (path.length > 1) {
        ctx.strokeStyle = 'rgba(70,224,200,0.35)';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.sx(path[0].x), this.sy(path[0].y));
        for (let k = 1; k < path.length; k++) ctx.lineTo(this.sx(path[k].x), this.sy(path[k].y));
        ctx.stroke();
        ctx.strokeStyle = '#7cf2df';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -t * 18;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }

    // Navigation target.
    const tp = ctrl.targetPoint;
    if (tp) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      const x = this.sx(tp.x);
      const y = this.sy(tp.y);
      ctx.strokeStyle = `rgba(124,242,223,${0.4 + 0.5 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      this.cross(x, y, 3, '#7cf2df');
    }

    // Dock.
    const dk = layout.dock;
    this.drawDock(dk.x, dk.y, dk.theta);

    // Room labels.
    if (L.rooms && s > 9) {
      const fs = s > 40 ? 11 : s > 22 ? 10 : 9;
      ctx.font = `600 ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const placed: Array<[number, number, number, number]> = [];
      // Larger rooms first so they win label collisions.
      const order = [...layout.rooms].sort((a, b) => roomArea(b) - roomArea(a));
      for (const room of order) {
        let area = 0;
        let cx = 0;
        let cy = 0;
        for (const q of room.rects) {
          const a = q.w * q.h;
          area += a;
          cx += (q.x + q.w / 2) * a;
          cy += (q.y + q.h / 2) * a;
        }
        cx /= area;
        cy /= area;
        const x = this.sx(cx);
        const y = this.sy(cy);
        const label = room.name.toUpperCase();
        const w = ctx.measureText(label).width + 10;
        const h = fs + 6;
        const box: [number, number, number, number] = [x - w / 2 - 2, y - h / 2 - 1, x + w / 2 + 2, y + h / 2 + 1];
        if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        const sel = selected.has(room.id);
        ctx.fillStyle = sel ? 'rgba(10,40,36,0.88)' : 'rgba(8,11,15,0.72)';
        roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = sel ? '#7cf2df' : 'rgba(220,230,240,0.82)';
        ctx.fillText(label, x, y + 0.5);
      }
    }

    // Robot.
    this.drawRobot(b.x, b.y, b.theta, sim.ctrl.mode === 'error');

    // Zone being drawn.
    if (this.dragRect) {
      const r = this.dragRect;
      const noGo = ui.tool === 'noGo';
      ctx.fillStyle = noGo ? 'rgba(255,93,93,0.18)' : 'rgba(90,169,255,0.18)';
      ctx.fillRect(this.sx(r.x), this.sy(r.y), r.w * s, r.h * s);
      ctx.strokeStyle = noGo ? '#ff5d5d' : '#5aa9ff';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(this.sx(r.x), this.sy(r.y), r.w * s, r.h * s);
      ctx.setLineDash([]);
    }

    // Hover crosshair.
    if (this.hover && ui.tool !== 'none') {
      const x = this.sx(this.hover.x);
      const y = this.sy(this.hover.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.cssH);
      ctx.moveTo(0, y);
      ctx.lineTo(this.cssW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private cross(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  }

  private drawDock(x: number, y: number, theta: number): void {
    const ctx = this.ctx;
    const s = this.scale;
    // The dock tower sits in front of the docked robot (the robot faces the tower).
    const off = ROBOT.radius + 0.1;
    const cx = this.sx(x + Math.cos(theta) * off);
    const cy = this.sy(y + Math.sin(theta) * off);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(theta);
    const w = Math.max(6, 0.2 * s);
    const h = Math.max(12, 0.42 * s);
    ctx.fillStyle = '#1a2330';
    ctx.strokeStyle = 'rgba(167,139,250,0.9)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, -w / 2, -h / 2, w, h, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(167,139,250,0.9)';
    ctx.fillRect(-w / 2 - 1.5, -2, 2, 4);
    ctx.restore();
  }

  private drawRobot(x: number, y: number, theta: number, error: boolean): void {
    const ctx = this.ctx;
    const r = Math.max(5, ROBOT.radius * this.scale);
    const px = this.sx(x);
    const py = this.sy(y);
    const accent = error ? '#ff5d5d' : '#46e0c8';
    const glow = ctx.createRadialGradient(px, py, r * 0.6, px, py, r * 2.4);
    glow.addColorStop(0, error ? 'rgba(255,93,93,0.35)' : 'rgba(70,224,200,0.35)');
    glow.addColorStop(1, 'rgba(70,224,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0e141b';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // LiDAR turret + heading.
    const hx = Math.cos(theta);
    const hy = Math.sin(theta);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(px + hx * r * 0.2, py + hy * r * 0.2, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px + hx * r * 0.45, py + hy * r * 0.45);
    ctx.lineTo(px + hx * (r + 4), py + hy * (r + 4));
    ctx.stroke();
  }
}

function roomArea(r: { rects: Rect[] }): number {
  let a = 0;
  for (const q of r.rects) a += q.w * q.h;
  return a;
}

function ramp(t: number): [number, number, number] {
  // 4-stop ramp: deep violet, magenta, orange, pale yellow.
  const stops: Array<[number, number, number, number]> = [
    [0, 72, 30, 140],
    [0.4, 196, 50, 120],
    [0.75, 255, 138, 61],
    [1, 255, 236, 150],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [p1, r1, g1, b1] = stops[i];
    const [p0, r0, g0, b0] = stops[i - 1];
    if (t <= p1) {
      const k = (t - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  return [255, 236, 150];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
