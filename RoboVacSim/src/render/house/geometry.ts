import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MatKey } from './materials';

// ------------------------------------------------------------------------------------------------
// BoxBatch: axis-aligned boxes/quads with UVs in world meters, merged into one geometry.
// Used for architecture (floors, walls, baseboards, casings, stairs).
// ------------------------------------------------------------------------------------------------

export const FACE = { PX: 1, NX: 2, PY: 4, NY: 8, PZ: 16, NZ: 32, ALL: 63, SIDES: 1 | 2 | 16 | 32 } as const;

export class BoxBatch {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  /** Quad from origin o with edge vectors u, v (normal = u x v). uvFn maps a world point to UV. */
  quad(o: THREE.Vector3Like, u: THREE.Vector3Like, v: THREE.Vector3Like, uvFn: (x: number, y: number, z: number) => [number, number]): void {
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().copy(u), new THREE.Vector3().copy(v)).normalize();
    const base = this.pos.length / 3;
    const pts = [
      [o.x, o.y, o.z],
      [o.x + u.x, o.y + u.y, o.z + u.z],
      [o.x + u.x + v.x, o.y + u.y + v.y, o.z + u.z + v.z],
      [o.x + v.x, o.y + v.y, o.z + v.z],
    ];
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(...uvFn(p[0], p[1], p[2]));
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box [x0,x1] x [y0,y1] x [z0,z1] with the selected faces. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: number = FACE.ALL): void {
    if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6 || z1 - z0 <= 1e-6) return;
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    const uvX = (_x: number, y: number, z: number): [number, number] => [z, y];
    const uvY = (x: number, _y: number, z: number): [number, number] => [x, -z];
    const uvZ = (x: number, y: number): [number, number] => [x, y];
    if (faces & FACE.PX) this.quad({ x: x1, y: y0, z: z1 }, { x: 0, y: 0, z: -d }, { x: 0, y: h, z: 0 }, uvX);
    if (faces & FACE.NX) this.quad({ x: x0, y: y0, z: z0 }, { x: 0, y: 0, z: d }, { x: 0, y: h, z: 0 }, uvX);
    if (faces & FACE.PY) this.quad({ x: x0, y: y1, z: z1 }, { x: w, y: 0, z: 0 }, { x: 0, y: 0, z: -d }, uvY);
    if (faces & FACE.NY) this.quad({ x: x0, y: y0, z: z0 }, { x: w, y: 0, z: 0 }, { x: 0, y: 0, z: d }, uvY);
    if (faces & FACE.PZ) this.quad({ x: x0, y: y0, z: z1 }, { x: w, y: 0, z: 0 }, { x: 0, y: h, z: 0 }, uvZ);
    if (faces & FACE.NZ) this.quad({ x: x1, y: y0, z: z0 }, { x: -w, y: 0, z: 0 }, { x: 0, y: h, z: 0 }, uvZ);
  }

  /** Horizontal upward-facing rectangle at height y (x0..x1, z0..z1). UV = (x, -z) meters. */
  floorRect(x0: number, z0: number, x1: number, z1: number, y = 0): void {
    if (x1 - x0 <= 1e-6 || z1 - z0 <= 1e-6) return;
    this.quad({ x: x0, y, z: z1 }, { x: x1 - x0, y: 0, z: 0 }, { x: 0, y: 0, z: -(z1 - z0) }, (x, _y, z) => [x, -z]);
  }

  build(): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------------------------------------
// ModelBuilder: collects primitive parts per material and merges them (one draw call per material).
// Local frame: x across the item width (w), y up, z across its depth (d); front faces +z.
// ------------------------------------------------------------------------------------------------

export interface ModelPart {
  mat: MatKey;
  geometry: THREE.BufferGeometry;
  /** Hung on a wall above cutaway height (mirrors, backsplash): hidden unless walls are full. */
  wallMounted: boolean;
}

/** `paint|#hex`, `plastic|#hex` and `gloss|#hex` parts are merged into one vertex-colored material each. */
const VC_RE = /^(paint|plastic|gloss)\|(#[0-9a-fA-F]{6})$/;

export interface InstancedPart {
  mat: MatKey;
  geometry: THREE.BufferGeometry;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

export interface ModelData {
  parts: ModelPart[];
  instanced: InstancedPart[];
  /** Small items skip shadow casting at lower qualities. */
  small: boolean;
  dispose(): void;
}

export interface XformOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function xform(x: number, y: number, z: number, o: XformOpts = {}): THREE.Matrix4 {
  _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  return _m.compose(_p, _q, _s);
}

/** Normalize a geometry for merging: non-indexed, position/normal/uv only. */
function normalize(g: THREE.BufferGeometry, color?: THREE.Color): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (color) {
    const n = out.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(arr, i * 3);
    out.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out.clearGroups();
  return out;
}

export class ModelBuilder {
  private readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private readonly instanced: InstancedPart[] = [];
  private wall = false;
  small = false;

  /** Parts added inside fn are wall-mounted (see ModelPart.wallMounted). */
  wallMounted(fn: () => void): void {
    this.wall = true;
    try {
      fn();
    } finally {
      this.wall = false;
    }
  }

  add(mat: MatKey, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    if (m) geo.applyMatrix4(m);
    const vc = VC_RE.exec(mat);
    const key = (vc ? `${vc[1]}VC` : mat) + (this.wall ? '@wall' : '');
    const list = this.parts.get(key) ?? [];
    list.push(normalize(geo, vc ? new THREE.Color(vc[2]) : undefined));
    this.parts.set(key, list);
  }

  /** Box centered at (x, y, z). */
  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, o?: XformOpts): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.add(mat, new THREE.BoxGeometry(w, h, d), xform(x, y, z, o));
  }

  /** Axis-aligned box from min to max corner. */
  boxMM(mat: MatKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.box(mat, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  /** Rounded box centered at (x, y, z). */
  rbox(mat: MatKey, w: number, h: number, d: number, r: number, x: number, y: number, z: number, o?: XformOpts): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const rad = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    if (rad <= 0.002) return this.box(mat, w, h, d, x, y, z, o);
    this.add(mat, new RoundedBoxGeometry(w, h, d, 2, rad), xform(x, y, z, o));
  }

  /** Cylinder (axis along local y before rotation) centered at (x, y, z). */
  cyl(mat: MatKey, rTop: number, rBot: number, h: number, x: number, y: number, z: number, o: XformOpts & { seg?: number; open?: boolean } = {}): void {
    this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, o.seg ?? 20, 1, o.open ?? false), xform(x, y, z, o));
  }

  sphere(mat: MatKey, r: number, x: number, y: number, z: number, o: XformOpts & { seg?: number } = {}): void {
    const seg = o.seg ?? 16;
    this.add(mat, new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.6))), xform(x, y, z, o));
  }

  torus(mat: MatKey, R: number, r: number, x: number, y: number, z: number, o: XformOpts & { arc?: number; seg?: number } = {}): void {
    this.add(mat, new THREE.TorusGeometry(R, r, 8, o.seg ?? 28, o.arc ?? Math.PI * 2), xform(x, y, z, o));
  }

  lathe(mat: MatKey, profile: Array<[number, number]>, x: number, y: number, z: number, o: XformOpts & { seg?: number } = {}): void {
    const pts = profile.map(([r, h]) => new THREE.Vector2(r, h));
    this.add(mat, new THREE.LatheGeometry(pts, o.seg ?? 24), xform(x, y, z, o));
  }

  /** Cylinder between two points (radius r0 at a, r1 at b). */
  segment(mat: MatKey, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 6): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-5) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    this.add(mat, new THREE.CylinderGeometry(r1, r0, len, seg, 1, false), m);
  }

  tube(mat: MatKey, points: THREE.Vector3[], radius: number, closed = false): void {
    const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
    this.add(mat, new THREE.TubeGeometry(curve, Math.max(16, points.length * 10), radius, 6, closed));
  }

  /** Instanced copies of a unit geometry (e.g. books). Geometry ownership passes to the model. */
  instances(mat: MatKey, geometry: THREE.BufferGeometry, matrices: THREE.Matrix4[], colors: THREE.Color[]): void {
    if (matrices.length) this.instanced.push({ mat, geometry, matrices, colors });
    else geometry.dispose();
  }

  build(): ModelData {
    const parts: ModelPart[] = [];
    for (const [key, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`merge failed for material ${key}`);
      if (list.length > 1) list.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const wallMounted = key.endsWith('@wall');
      parts.push({ mat: wallMounted ? key.slice(0, -5) : key, geometry: merged, wallMounted });
    }
    const instanced = this.instanced;
    return {
      parts,
      instanced,
      small: this.small,
      dispose() {
        parts.forEach((p) => p.geometry.dispose());
        instanced.forEach((p) => p.geometry.dispose());
      },
    };
  }
}

export { xform };
