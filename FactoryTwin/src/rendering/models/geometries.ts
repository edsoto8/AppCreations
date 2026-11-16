import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  LatheGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PALETTE } from './materials';

/**
 * Shared geometries and the `Parts` builder used to merge static sub-parts into one
 * vertex-coloured BufferGeometry (one draw call per merged assembly).
 *
 * All handling-unit geometries (products, carton, tote, pallet, material lot) have their
 * origin at the BOTTOM CENTRE, long side along +x.
 */

export type V3 = readonly [number, number, number];

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const KEEP = new Set(['position', 'normal', 'uv']);

/** Normalises a geometry for merging: non-indexed, position/normal/uv only, transformed, coloured. */
export function bake(
  g: BufferGeometry,
  color: ColorRepresentation,
  p: V3 = [0, 0, 0],
  r: V3 = [0, 0, 0],
  s: V3 = [1, 1, 1],
): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g.clone();
  g.dispose();
  for (const name of Object.keys(geo.attributes)) if (!KEEP.has(name)) geo.deleteAttribute(name);
  geo.morphAttributes = {};
  geo.clearGroups();
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
  geo.applyMatrix4(_m);
  _c.set(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  return geo;
}

/** Builder that collects primitives and merges them into one vertex-coloured geometry. */
export class Parts {
  private list: BufferGeometry[] = [];

  get count(): number {
    return this.list.length;
  }

  add(g: BufferGeometry, color: ColorRepresentation, p?: V3, r?: V3, s?: V3): this {
    this.list.push(bake(g, color, p, r, s));
    return this;
  }

  /** Box centred at p. radius > 0 gives bevelled edges. */
  box(w: number, h: number, d: number, color: ColorRepresentation, p: V3, r?: V3, radius = 0.015): this {
    const rad = Math.min(radius, Math.min(w, h, d) / 2 - 1e-4);
    const g = rad >= 0.008 ? new RoundedBoxGeometry(w, h, d, rad >= 0.05 ? 2 : 1, rad) : new BoxGeometry(w, h, d);
    return this.add(g, color, p, r);
  }

  /** Box spanning two corners (axis-aligned, no rotation). */
  boxSpan(a: V3, b: V3, color: ColorRepresentation, radius = 0.01): this {
    return this.box(
      Math.abs(b[0] - a[0]),
      Math.abs(b[1] - a[1]),
      Math.abs(b[2] - a[2]),
      color,
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      undefined,
      radius,
    );
  }

  /** Cylinder along local y, centred at p. */
  cyl(rTop: number, rBot: number, h: number, color: ColorRepresentation, p: V3, r?: V3, seg = 18): this {
    return this.add(new CylinderGeometry(rTop, rBot, h, seg), color, p, r);
  }

  /** Cylinder along x. */
  cylX(rad: number, len: number, color: ColorRepresentation, p: V3, seg = 18): this {
    return this.cyl(rad, rad, len, color, p, [0, 0, -Math.PI / 2], seg);
  }

  /** Cylinder along z. */
  cylZ(rad: number, len: number, color: ColorRepresentation, p: V3, seg = 18): this {
    return this.cyl(rad, rad, len, color, p, [Math.PI / 2, 0, 0], seg);
  }

  sphere(rad: number, color: ColorRepresentation, p: V3, s?: V3, seg = 16): this {
    return this.add(new SphereGeometry(rad, seg, Math.max(8, Math.round(seg * 0.6))), color, p, undefined, s);
  }

  /** Capsule along local y (total length = len + 2 rad), centred at p. */
  capsule(rad: number, len: number, color: ColorRepresentation, p: V3, r?: V3, s?: V3): this {
    return this.add(new CapsuleGeometry(rad, len, 4, 12), color, p, r, s);
  }

  torus(rad: number, tube: number, color: ColorRepresentation, p: V3, r?: V3): this {
    return this.add(new TorusGeometry(rad, tube, 8, 28), color, p, r);
  }

  /** Thin bar between two points (square section). */
  bar(a: V3, b: V3, t: number, color: ColorRepresentation): this {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const g = new BoxGeometry(t, len, t);
    const dir = new Vector3(dx, dy, dz).normalize();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    const e = new Euler().setFromQuaternion(q);
    return this.add(g, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [e.x, e.y, e.z]);
  }

  /** Vertical plane facing +z. UVs 0..1, or tiled every `tile` metres when tile > 0 (wire mesh). */
  panel(w: number, h: number, p: V3, rotY = 0, tile = 0): this {
    const g = new PlaneGeometry(w, h);
    const uv = g.attributes.uv as BufferAttribute;
    if (tile > 0) for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    return this.add(g, '#ffffff', p, [0, rotY, 0]);
  }

  /** Adds an already vertex-coloured geometry (e.g. from another Parts.build()), transformed. */
  addPrebuilt(g: BufferGeometry, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]): this {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    geo.applyMatrix4(_m);
    this.list.push(geo);
    return this;
  }

  merge(other: Parts): this {
    this.list.push(...other.list);
    other.list = [];
    return this;
  }

  build(): BufferGeometry {
    if (this.list.length === 0) return new BufferGeometry();
    const merged = mergeGeometries(this.list, false);
    for (const g of this.list) g.dispose();
    this.list = [];
    if (!merged) throw new Error('mergeGeometries failed');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Lazily evaluated singleton (geometry built on first use, then shared). */
export function lazy<T>(fn: () => T): () => T {
  let v: T | undefined;
  return () => {
    if (v === undefined) v = fn();
    return v;
  };
}

// ---------------------------------------------------------------------------------------------
// Handling units (InstancedMesh-friendly; origin at bottom centre)
// ---------------------------------------------------------------------------------------------

export const PRODUCT_A_SIZE = { diameter: 0.18, height: 0.06 } as const;
export const PRODUCT_B_SIZE = { diameter: 0.14, height: 0.22 } as const;
/** Shipping carton (x, y, z). Six fit one layer of a 1.2 x 1.0 pallet (3 along x, 2 along z). */
export const CARTON_SIZE = { x: 0.36, y: 0.24, z: 0.44 } as const;
export const TOTE_SIZE = { x: 0.4, y: 0.2, z: 0.3 } as const;
export const PALLET_SIZE = { x: 1.2, y: 0.144, z: 1.0 } as const;
export const MATERIAL_LOT_HEIGHT = 1.1;

/** Smart-home hub: rounded white puck with a dark sensor ring and status LED. */
export const productAGeometry: BufferGeometry = (() => {
  const r = PRODUCT_A_SIZE.diameter / 2;
  const h = PRODUCT_A_SIZE.height;
  const pts: Vector2[] = [new Vector2(0, 0), new Vector2(r - 0.01, 0), new Vector2(r, 0.008)];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new Vector2(r - 0.022 + Math.cos(a) * 0.022, h - 0.022 + Math.sin(a) * 0.022));
  }
  pts.push(new Vector2(0, h));
  return new Parts()
    .add(new LatheGeometry(pts, 28), '#f4f5f6')
    .torus(r * 0.55, 0.006, '#3a4048', [0, h + 0.001, 0], [Math.PI / 2, 0, 0])
    .cyl(0.012, 0.012, 0.004, '#38bdf8', [0, h + 0.002, 0], undefined, 12)
    .cyl(r - 0.004, r - 0.004, 0.008, '#9aa1a8', [0, 0.004, 0], undefined, 24)
    .build();
})();

/** Wireless speaker: fabric-covered cylinder with grille rings and light-grey caps. */
export const productBGeometry: BufferGeometry = (() => {
  const r = PRODUCT_B_SIZE.diameter / 2;
  const h = PRODUCT_B_SIZE.height;
  const p = new Parts()
    .cyl(r, r, h - 0.03, '#3b3f46', [0, 0.015 + (h - 0.03) / 2, 0], undefined, 24)
    .cyl(r - 0.002, r, 0.015, '#c9ced3', [0, 0.0075, 0], undefined, 24)
    .cyl(r - 0.006, r, 0.015, '#c9ced3', [0, h - 0.0075, 0], undefined, 24)
    .cyl(r * 0.55, r * 0.55, 0.004, '#1e2125', [0, h + 0.001, 0], undefined, 20);
  for (const y of [0.06, 0.11, 0.16]) p.torus(r + 0.001, 0.0035, '#7c838b', [0, y, 0], [Math.PI / 2, 0, 0]);
  return p.build();
})();

/** Kraft shipping carton with tape strip and shipping label. */
export const cartonGeometry: BufferGeometry = (() => {
  const { x, y, z } = CARTON_SIZE;
  return new Parts()
    .box(x, y, z, PALETTE.kraft, [0, y / 2, 0], undefined, 0.006)
    .box(x + 0.002, 0.002, 0.06, '#c9a26c', [0, y + 0.001, 0], undefined, 0)
    .box(0.06, y - 0.06, 0.002, '#c9a26c', [-x / 2 - 0.001 + 0.001, y / 2, z / 2 + 0.001], [0, Math.PI / 2, 0], 0)
    .box(0.14, 0.09, 0.002, '#f4f4f0', [0.06, y * 0.55, z / 2 + 0.001], undefined, 0)
    .box(0.1, 0.012, 0.002, '#222222', [0.06, y * 0.5, z / 2 + 0.0025], undefined, 0)
    .build();
})();

/** Open-top plastic tote. White/grey geometry: tint with the material colour (`toteMat`). */
export const kitToteGeometry: BufferGeometry = (() => {
  const { x, y, z } = TOTE_SIZE;
  const t = 0.012;
  const p = new Parts()
    .box(x - 0.02, t, z - 0.02, '#ffffff', [0, t / 2, 0], undefined, 0.004)
    .box(x, y, t, '#ffffff', [0, y / 2, z / 2 - t / 2], undefined, 0.004)
    .box(x, y, t, '#ffffff', [0, y / 2, -z / 2 + t / 2], undefined, 0.004)
    .box(t, y, z, '#ffffff', [x / 2 - t / 2, y / 2, 0], undefined, 0.004)
    .box(t, y, z, '#ffffff', [-x / 2 + t / 2, y / 2, 0], undefined, 0.004)
    .box(x + 0.012, 0.014, z + 0.012, '#e6e6e6', [0, y - 0.007, 0], undefined, 0.004)
    // handle slots
    .box(0.004, 0.035, 0.11, '#222222', [x / 2 + 0.005, y - 0.045, 0], undefined, 0)
    .box(0.004, 0.035, 0.11, '#222222', [-x / 2 - 0.005, y - 0.045, 0], undefined, 0)
    // contents: PCB + parts (tinted by the tote colour, reads as darker shapes)
    .box(0.16, 0.012, 0.11, '#5a5a5a', [-0.07, 0.03, 0.03], undefined, 0.002)
    .box(0.12, 0.07, 0.1, '#8a8a8a', [0.08, 0.05, -0.04], undefined, 0.01);
  return p.build();
})();

/** Wooden pallet 1.2 x 1.0 x 0.144 m (boards, blocks, stringers). */
export const palletGeometry: BufferGeometry = (() => {
  const { x: L, z: W } = PALLET_SIZE;
  const tones = ['#c79c64', '#bd9259', '#d1a873', '#b88d55'];
  const p = new Parts();
  const bt = 0.022;
  // bottom boards along x
  [-W / 2 + 0.05, 0, W / 2 - 0.05].forEach((zz, i) => p.box(L, bt, 0.1, tones[i % 4], [0, bt / 2, zz], undefined, 0.003));
  // blocks
  for (const xx of [-L / 2 + 0.07, 0, L / 2 - 0.07])
    for (const zz of [-W / 2 + 0.05, 0, W / 2 - 0.05]) p.box(0.14, 0.078, 0.1, '#a87f4b', [xx, bt + 0.039, zz], undefined, 0.004);
  // stringers along z
  [-L / 2 + 0.07, 0, L / 2 - 0.07].forEach((xx, i) =>
    p.box(0.14, bt, W, tones[(i + 1) % 4], [xx, bt + 0.078 + bt / 2, 0], undefined, 0.003),
  );
  // top deck boards along x
  const n = 7;
  for (let i = 0; i < n; i++) {
    const zz = -W / 2 + 0.06 + (i * (W - 0.12)) / (n - 1);
    p.box(L, bt, 0.115, tones[i % 4], [0, 2 * bt + 0.078 + bt / 2, zz], undefined, 0.003);
  }
  return p.build();
})();

/**
 * Local offsets (bottom centre of each carton, relative to the pallet's bottom centre) for a
 * stack of `units` cartons: 6 per layer (3 along x, 2 along z), 4 layers for 24.
 */
export function cartonStackOffsets(units: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const px = CARTON_SIZE.x + 0.02;
  const pz = CARTON_SIZE.z + 0.02;
  for (let k = 0; k < units; k++) {
    const layer = Math.floor(k / 6);
    const i = k % 6;
    const cx = (i % 3) - 1;
    const cz = Math.floor(i / 3) - 0.5;
    out.push([cx * px, PALLET_SIZE.y + layer * (CARTON_SIZE.y + 0.002), cz * pz]);
  }
  return out;
}

/** A full 24-carton pallet load (cartons only, no pallet), merged; for trucks and racks. */
export const fullCartonLoadGeometry = lazy(() => {
  const merged: BufferGeometry[] = [];
  for (const o of cartonStackOffsets(24)) {
    const g = cartonGeometry.clone();
    g.translate(o[0], o[1], o[2]);
    merged.push(g);
  }
  const g = mergeGeometries(merged, false);
  for (const m of merged) m.dispose();
  if (!g) throw new Error('merge failed');
  g.computeBoundingSphere();
  return g;
});

/** Shrink-wrapped raw-material lot INCLUDING its pallet (origin bottom centre, ~1.1 m tall). */
export const materialLotGeometry: BufferGeometry = (() => {
  const p = new Parts();
  // pallet (simplified: deck + blocks)
  p.box(1.2, 0.03, 1.0, '#c49a62', [0, 0.129, 0], undefined, 0.004);
  for (const xx of [-0.53, 0, 0.53]) for (const zz of [-0.45, 0, 0.45]) p.box(0.14, 0.1, 0.1, '#a87f4b', [xx, 0.06, zz], undefined, 0.004);
  for (const zz of [-0.45, 0, 0.45]) p.box(1.2, 0.02, 0.1, '#bd9259', [0, 0.01, zz], undefined, 0.003);
  // wrapped boxes: slightly bulged, translucent-looking blue-white
  const h = MATERIAL_LOT_HEIGHT - 0.144;
  p.box(1.16, h, 0.98, '#d9e4ec', [0, 0.144 + h / 2, 0], undefined, 0.05);
  // visible box seams under the wrap
  for (const yy of [0.45, 0.78]) p.box(1.165, 0.012, 0.985, '#aebfcc', [0, yy, 0], undefined, 0);
  p.box(0.012, h - 0.04, 0.985, '#aebfcc', [0, 0.144 + h / 2, 0], undefined, 0);
  // label
  p.box(0.22, 0.16, 0.004, '#ffffff', [0.3, 0.75, 0.493], undefined, 0);
  p.box(0.16, 0.02, 0.004, '#222222', [0.3, 0.72, 0.496], undefined, 0);
  return p.build();
})();

/** Unit cylinder (radius 1, height 1, axis y) for instanced rollers. */
export const unitCylinderGeometry: BufferGeometry = new CylinderGeometry(1, 1, 1, 14);
/** Unit box for instanced bars/beams. */
export const unitBoxGeometry: BufferGeometry = new BoxGeometry(1, 1, 1);
