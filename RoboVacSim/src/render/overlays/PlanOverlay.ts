import * as THREE from 'three';
import type { Simulation } from '../../sim/Simulation';
import type { HouseLayout, Rect } from '../../sim/world/types';
import { COST_INSCRIBED, COST_LETHAL, COST_UNKNOWN } from '../../sim/mapping/Costmap';

const MAX_PATH = 4000;
const MAX_LANES = 1200;

/**
 * Navigation overlays: planned path, remaining coverage lanes, past trajectory, current target,
 * selected spot; plus zone volumes and the robot's own map/costmap rendered as a floor texture.
 */
export class PlanOverlay {
  readonly group = new THREE.Group();
  private readonly path: THREE.Line;
  private readonly pathPos = new Float32Array(MAX_PATH * 3);
  private readonly trail: THREE.Line;
  private readonly trailPos: Float32Array;
  private readonly lanes: THREE.LineSegments;
  private readonly lanePos = new Float32Array(MAX_LANES * 6);
  private readonly target: THREE.Mesh;
  private readonly spot: THREE.Mesh;
  private timer = 0;
  showPath = true;
  showTrail = true;
  spotPoint: { x: number; y: number } | null = null;

  constructor(private sim: Simulation) {
    const mk = (pos: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      return g;
    };
    this.path = new THREE.Line(mk(this.pathPos), new THREE.LineBasicMaterial({ color: '#46e0c8', transparent: true, opacity: 0.95, depthWrite: false }));
    this.trailPos = new Float32Array((sim.trail.length / 2) * 3);
    this.trail = new THREE.Line(mk(this.trailPos), new THREE.LineBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.55, depthWrite: false }));
    this.lanes = new THREE.LineSegments(mk(this.lanePos), new THREE.LineBasicMaterial({ color: '#6aa9ff', transparent: true, opacity: 0.22, depthWrite: false }));
    for (const l of [this.path, this.trail, this.lanes]) {
      l.frustumCulled = false;
      l.renderOrder = 6;
    }
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#46e0c8', transparent: true, opacity: 0.9, depthWrite: false }));
    this.spot = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.8, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#f2c14e', transparent: true, opacity: 0.85, depthWrite: false }));
    this.target.renderOrder = 7;
    this.group.add(this.lanes, this.trail, this.path, this.target, this.spot);
    this.group.name = 'plan-overlay';
  }

  update(dt: number, time: number): void {
    this.path.visible = this.showPath;
    this.lanes.visible = this.showPath;
    this.trail.visible = this.showTrail;
    this.timer += dt;
    const sim = this.sim;
    const b = sim.body;
    const tp = sim.ctrl.targetPoint;
    this.target.visible = this.showPath && !!tp;
    if (tp) {
      this.target.position.set(tp.x, 0.02, tp.y);
      const s = 1 + 0.15 * Math.sin(time * 5);
      this.target.scale.set(s, 1, s);
    }
    this.spot.visible = !!this.spotPoint;
    if (this.spotPoint) this.spot.position.set(this.spotPoint.x, 0.02, this.spotPoint.y);
    if (this.timer < 0.1) return;
    this.timer = 0;
    const y = 0.025;
    if (this.showPath) {
      const p = sim.nav.remainingPath(b.x, b.y);
      const n = Math.min(p.length, MAX_PATH);
      for (let k = 0; k < n; k++) {
        this.pathPos[k * 3] = p[k].x;
        this.pathPos[k * 3 + 1] = y;
        this.pathPos[k * 3 + 2] = p[k].y;
      }
      this.path.geometry.setDrawRange(0, n);
      (this.path.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const tasks = sim.ctrl.mission?.tasks ?? [];
      let m = 0;
      for (const t of tasks) {
        for (let k = 0; k + 1 < t.points.length && m < MAX_LANES; k++, m++) {
          const a = t.points[k];
          const c = t.points[k + 1];
          this.lanePos.set([a.x, y * 0.8, a.y, c.x, y * 0.8, c.y], m * 6);
        }
        if (m >= MAX_LANES) break;
      }
      this.lanes.geometry.setDrawRange(0, m * 2);
      (this.lanes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.showTrail) {
      let n = 0;
      sim.forEachTrail((x, z) => {
        this.trailPos[n * 3] = x;
        this.trailPos[n * 3 + 1] = y * 0.9;
        this.trailPos[n * 3 + 2] = z;
        n++;
      });
      this.trail.geometry.setDrawRange(0, n);
      (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const o of [this.path, this.trail, this.lanes, this.target, this.spot]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}

/** Translucent zone volumes (no-go red, no-mop blue) + drag preview. Meshes carry pickKind 'zone'. */
export class ZoneOverlay {
  readonly group = new THREE.Group();
  private readonly mats = {
    noGo: new THREE.MeshBasicMaterial({ color: '#ff4d5e', transparent: true, opacity: 0.18, depthWrite: false }),
    noMop: new THREE.MeshBasicMaterial({ color: '#4d8dff', transparent: true, opacity: 0.18, depthWrite: false }),
    edgeNoGo: new THREE.LineBasicMaterial({ color: '#ff4d5e' }),
    edgeNoMop: new THREE.LineBasicMaterial({ color: '#4d8dff' }),
    selected: new THREE.LineBasicMaterial({ color: '#ffffff' }),
  };
  private readonly box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly edges = new THREE.EdgesGeometry(this.box);
  readonly preview: THREE.Mesh;

  constructor() {
    this.group.name = 'zones';
    this.preview = new THREE.Mesh(this.box, this.mats.noGo);
    this.preview.visible = false;
  }

  sync(layout: HouseLayout, selectedId: string | null): void {
    this.group.clear();
    for (const z of layout.zones) {
      const h = 0.16;
      const m = new THREE.Mesh(this.box, z.kind === 'noGo' ? this.mats.noGo : this.mats.noMop);
      m.position.set(z.rect.x + z.rect.w / 2, 0.001, z.rect.y + z.rect.h / 2);
      m.scale.set(z.rect.w, h, z.rect.h);
      m.userData = { pickKind: 'zone', id: z.id };
      m.renderOrder = 3;
      const e = new THREE.LineSegments(this.edges, selectedId === z.id ? this.mats.selected : z.kind === 'noGo' ? this.mats.edgeNoGo : this.mats.edgeNoMop);
      e.userData = m.userData;
      m.add(e);
      this.group.add(m);
    }
    this.group.add(this.preview);
  }

  showPreview(kind: 'noGo' | 'noMop', r: Rect | null): void {
    this.preview.visible = !!r;
    if (!r) return;
    this.preview.material = kind === 'noGo' ? this.mats.noGo : this.mats.noMop;
    this.preview.position.set(r.x + r.w / 2, 0.001, r.y + r.h / 2);
    this.preview.scale.set(Math.max(0.01, r.w), 0.16, Math.max(0.01, r.h));
  }

  dispose(): void {
    this.box.dispose();
    this.edges.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
  }
}

/** The robot's belief (occupancy + inflation) rendered as a floor texture for the LiDAR/costmap views. */
export class MapOverlay {
  readonly mesh: THREE.Mesh;
  private readonly tex: THREE.DataTexture;
  private readonly data: Uint8Array;
  private lastVersion = -1;
  private timer = 0;

  constructor(private sim: Simulation) {
    const g = sim.map.geom;
    this.data = new Uint8Array(g.width * g.height * 4);
    this.tex = new THREE.DataTexture(this.data, g.width, g.height, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(g.worldWidth, g.worldHeight), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(g.originX + g.worldWidth / 2, 0.016, g.originY + g.worldHeight / 2);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.timer += dt;
    const v = this.sim.map.costmapVersion;
    if (v === this.lastVersion || this.timer < 0.25) return;
    this.timer = 0;
    this.lastVersion = v;
    const g = this.sim.map.geom;
    const cost = this.sim.map.costmap.cost;
    const occ = this.sim.map.occ;
    for (let j = 0; j < g.height; j++) {
      const row = g.height - 1 - j;
      for (let i = 0; i < g.width; i++) {
        const idx = j * g.width + i;
        const o = (row * g.width + i) * 4;
        const c = cost[idx];
        let r: number, gg: number, b: number, a: number;
        if (occ.isOccupied(idx) || c === COST_LETHAL) [r, gg, b, a] = [255, 255, 255, 230];
        else if (c === COST_UNKNOWN) [r, gg, b, a] = [8, 10, 14, 150];
        else if (c >= COST_INSCRIBED) [r, gg, b, a] = [255, 77, 109, 110];
        else if (c > 0) [r, gg, b, a] = [255, 150 - c * 0.4, 60, 20 + c * 0.35];
        else [r, gg, b, a] = [70, 224, 200, 38];
        this.data[o] = r;
        this.data[o + 1] = gg;
        this.data[o + 2] = b;
        this.data[o + 3] = a;
      }
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
  }
}
