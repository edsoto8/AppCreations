import * as THREE from 'three';
import type { DirtView } from '../../app/types';
import type { Simulation } from '../../sim/Simulation';

/**
 * Dirt as a floor decal: a DataTexture at the simulation grid resolution (5 cm) mapped onto a plane
 * just above the floor/rugs. 'realistic' colours each cell by its dominant dirt type with opacity
 * proportional to density; 'heatmap' shows total remaining dirt on a blue→yellow→red ramp.
 * Optionally tints cells the cleaning footprint has covered this mission.
 */
export class DirtOverlay {
  readonly mesh: THREE.Mesh;
  private readonly tex: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly mat: THREE.MeshStandardMaterial;
  private lastVersion = -1;
  private timer = 0;
  view: DirtView = 'realistic';
  coverage = false;
  private dirty = true;

  constructor(private sim: Simulation) {
    const g = sim.world.grid;
    this.data = new Uint8Array(g.width * g.height * 4);
    this.tex = new THREE.DataTexture(this.data, g.width, g.height, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.needsUpdate = true;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, roughness: 0.55, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.PlaneGeometry(g.worldWidth, g.worldHeight);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(g.originX + g.worldWidth / 2, 0.0135, g.originY + g.worldHeight / 2);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'dirt-overlay';
  }

  setView(view: DirtView, coverage: boolean): void {
    if (view !== this.view || coverage !== this.coverage) this.dirty = true;
    this.view = view;
    this.coverage = coverage;
    this.mesh.visible = view !== 'off' || coverage;
  }

  update(dt: number): void {
    this.timer += dt;
    const v = this.sim.dirt.version;
    if (!this.dirty && (v === this.lastVersion || this.timer < 0.1)) return;
    this.timer = 0;
    this.lastVersion = v;
    this.dirty = false;
    this.rebuild();
  }

  private rebuild(): void {
    const sim = this.sim;
    const g = sim.world.grid;
    const d = sim.dirt;
    const A = g.cellSize * g.cellSize;
    const out = this.data;
    const cleanable = sim.world.cleanable;
    const heat = this.view === 'heatmap';
    const showDirt = this.view !== 'off';
    for (let j = 0; j < g.height; j++) {
      const row = g.height - 1 - j;
      for (let i = 0; i < g.width; i++) {
        const idx = j * g.width + i;
        const o = (row * g.width + i) * 4;
        let r = 0;
        let gg = 0;
        let b = 0;
        let a = 0;
        if (cleanable[idx]) {
          const dust = d.dust[idx] / A;
          const crumbs = d.crumbs[idx] / A;
          const hair = d.hair[idx] / A;
          const liquid = d.liquid[idx] / A;
          const stain = d.stain[idx];
          if (showDirt && heat) {
            const t = Math.min(1, (dust / 6 + crumbs / 25 + hair / 3 + liquid / 120 + stain) * 0.8);
            if (t > 0.01) {
              // blue -> cyan -> yellow -> red
              r = t < 0.5 ? 40 + t * 2 * 215 : 255;
              gg = t < 0.5 ? 120 + t * 2 * 120 : 240 - (t - 0.5) * 2 * 200;
              b = t < 0.5 ? 220 - t * 2 * 180 : 40;
              a = 70 + t * 160;
            }
          } else if (showDirt) {
            const aDust = Math.min(0.5, dust / 5);
            const aCrumb = Math.min(0.85, crumbs / 18);
            const aHair = Math.min(0.7, hair / 2.5);
            const aLiq = Math.min(0.7, liquid / 120);
            const aStain = Math.min(0.85, stain * 0.9);
            // Composite: start from dust, then layer others on top (premultiplied-ish blend).
            a = aDust;
            r = 120;
            gg = 104;
            b = 86;
            const over = (cr: number, cg: number, cb: number, ca: number) => {
              if (ca <= 0) return;
              const na = ca + a * (1 - ca);
              r = (cr * ca + r * a * (1 - ca)) / na;
              gg = (cg * ca + gg * a * (1 - ca)) / na;
              b = (cb * ca + b * a * (1 - ca)) / na;
              a = na;
            };
            over(108, 52, 34, aStain);
            over(70, 110, 160, aLiq);
            over(196, 150, 92, aCrumb);
            over(40, 32, 28, aHair);
            a *= 255;
          }
          if (this.coverage && d.passes[idx] > 0) {
            const k = Math.min(1, d.passes[idx] / 2);
            const ca = 0.22 + 0.18 * k;
            const na = ca * 255 + a * (1 - ca);
            r = (60 * ca * 255 + r * a * (1 - ca)) / Math.max(1, na);
            gg = (224 * ca * 255 + gg * a * (1 - ca)) / Math.max(1, na);
            b = (200 * ca * 255 + b * a * (1 - ca)) / Math.max(1, na);
            a = na;
          }
        }
        out[o] = r;
        out[o + 1] = gg;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/**
 * Visible debris particles (crumbs and hair strands) sampled from the dirt field. Each instance is
 * tied to a grid cell and hides once the robot has removed most of the dirt in that cell.
 */
export class Debris {
  readonly group = new THREE.Group();
  private crumbs: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private crumbCells: Int32Array = new Int32Array(0);
  private crumbRef: Float32Array = new Float32Array(0);
  private hairCells: Int32Array = new Int32Array(0);
  private hairRef: Float32Array = new Float32Array(0);
  private readonly matrices: { crumbs: THREE.Matrix4[]; hair: THREE.Matrix4[] } = { crumbs: [], hair: [] };
  private timer = 0;
  private lastVersion = -1;
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private sim: Simulation,
    private readonly maxCrumbs = 2400,
    private readonly maxHair = 700,
  ) {
    const crumbGeo = new THREE.DodecahedronGeometry(0.0055, 0);
    const crumbMat = new THREE.MeshStandardMaterial({ color: '#c49a62', roughness: 0.9 });
    this.crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, maxCrumbs);
    const hairGeo = new THREE.CylinderGeometry(0.0006, 0.0006, 0.05, 3);
    hairGeo.rotateZ(Math.PI / 2);
    const hairMat = new THREE.MeshStandardMaterial({ color: '#2b211b', roughness: 0.7 });
    this.hair = new THREE.InstancedMesh(hairGeo, hairMat, maxHair);
    this.crumbs.castShadow = false;
    this.group.add(this.crumbs, this.hair);
    this.group.name = 'debris';
    this.resample();
  }

  /** Re-sample particle positions from the current dirt distribution (on reset / spills). */
  resample(): void {
    const sim = this.sim;
    const g = sim.world.grid;
    const A = g.cellSize * g.cellSize;
    const d = sim.dirt;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = (layer: Float32Array, perGram: number, max: number, mesh: THREE.InstancedMesh, kind: 'crumbs' | 'hair') => {
      const cells: number[] = [];
      const refs: number[] = [];
      const mats: THREE.Matrix4[] = [];
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      for (let idx = 0; idx < layer.length && cells.length < max; idx++) {
        const dens = layer[idx] / A;
        if (dens <= 0) continue;
        const expected = layer[idx] * perGram;
        let n = Math.floor(expected);
        if (rnd() < expected - n) n++;
        for (let k = 0; k < n && cells.length < max; k++) {
          const i = idx % g.width;
          const j = (idx - i) / g.width;
          p.set(g.cx(i) + (rnd() - 0.5) * g.cellSize, 0.004 + (sim.world.surface[idx] >= 2 ? 0.01 : 0), g.cy(j) + (rnd() - 0.5) * g.cellSize);
          e.set(rnd() * Math.PI, rnd() * Math.PI * 2, 0);
          q.setFromEuler(kind === 'hair' ? e.set(0, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.3) : e);
          const sc = kind === 'hair' ? 0.6 + rnd() * 0.8 : 0.6 + rnd() * 1.1;
          s.set(sc, sc * (kind === 'hair' ? 1 : 0.7), sc);
          m.compose(p, q, s);
          mats.push(m.clone());
          cells.push(idx);
          refs.push(layer[idx]);
        }
      }
      for (let k = 0; k < max; k++) mesh.setMatrixAt(k, k < mats.length ? mats[k] : this.zero);
      mesh.count = mats.length;
      mesh.instanceMatrix.needsUpdate = true;
      this.matrices[kind] = mats;
      return { cells: Int32Array.from(cells), refs: Float32Array.from(refs) };
    };
    const c = pick(d.crumbs, 160, this.maxCrumbs, this.crumbs, 'crumbs');
    this.crumbCells = c.cells;
    this.crumbRef = c.refs;
    const h = pick(d.hair, 900, this.maxHair, this.hair, 'hair');
    this.hairCells = h.cells;
    this.hairRef = h.refs;
    this.lastVersion = d.version;
  }

  update(dt: number): void {
    this.timer += dt;
    const v = this.sim.dirt.version;
    if (v === this.lastVersion || this.timer < 0.15) return;
    this.timer = 0;
    this.lastVersion = v;
    const apply = (mesh: THREE.InstancedMesh, cells: Int32Array, refs: Float32Array, layer: Float32Array, mats: THREE.Matrix4[]) => {
      let changed = false;
      for (let k = 0; k < cells.length; k++) {
        // Instance k disappears when the cell's remaining dirt drops below a per-instance threshold,
        // so particles vanish progressively as passes accumulate.
        const frac = layer[cells[k]] / Math.max(1e-9, refs[k]);
        const thresh = ((k * 0.618034) % 1) * 0.85 + 0.05;
        const visible = frac > thresh;
        mesh.getMatrixAt(k, tmp);
        const isVisible = tmp.elements[0] !== 0;
        if (visible !== isVisible) {
          mesh.setMatrixAt(k, visible ? mats[k] : this.zero);
          changed = true;
        }
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    };
    apply(this.crumbs, this.crumbCells, this.crumbRef, this.sim.dirt.crumbs, this.matrices.crumbs);
    apply(this.hair, this.hairCells, this.hairRef, this.sim.dirt.hair, this.matrices.hair);
  }

  dispose(): void {
    this.crumbs.geometry.dispose();
    (this.crumbs.material as THREE.Material).dispose();
    this.hair.geometry.dispose();
    (this.hair.material as THREE.Material).dispose();
    this.crumbs.dispose();
    this.hair.dispose();
  }
}

const tmp = new THREE.Matrix4();
