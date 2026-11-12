import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Euler,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Profile point: [r, y] or [r, y, corner]. corner > 0 = fillet radius, 0/omitted = crisp edge,
 * -1 = smooth pass-through (no fillet, no crease).
 */
export type ProfilePoint = readonly [number, number] | readonly [number, number, number];

/** Builds a lathe/shape profile with filleted or crisp corners. */
export function profile(pts: readonly ProfilePoint[], filletSegs: number): Vector2[] {
  const out: Vector2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const x = p[0];
    const y = p[1];
    const c = p.length > 2 ? (p[2] ?? 0) : 0;
    if (i === 0 || i === n - 1 || c < 0) {
      out.push(new Vector2(x, y));
      continue;
    }
    if (c === 0) {
      out.push(new Vector2(x, y), new Vector2(x, y));
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i + 1];
    const l1 = Math.hypot(a[0] - x, a[1] - y);
    const l2 = Math.hypot(b[0] - x, b[1] - y);
    const d = Math.min(c, l1 * 0.5, l2 * 0.5);
    const ax = x + ((a[0] - x) / l1) * d;
    const ay = y + ((a[1] - y) / l1) * d;
    const bx = x + ((b[0] - x) / l2) * d;
    const by = y + ((b[1] - y) / l2) * d;
    for (let s = 0; s <= filletSegs; s++) {
      const t = s / filletSegs;
      const u = 1 - t;
      out.push(new Vector2(u * u * ax + 2 * u * t * x + t * t * bx, u * u * ay + 2 * u * t * y + t * t * by));
    }
  }
  return out;
}

export function lathe(
  pts: readonly ProfilePoint[],
  segments: number,
  filletSegs: number,
  phiStart = 0,
  phiLength = Math.PI * 2,
): LatheGeometry {
  return new LatheGeometry(profile(pts, filletSegs), segments, phiStart, phiLength);
}

/** Matrix from position, Euler rotation (default order XYZ: rz applied first, rx last) and scale. */
export function mat(
  px: number,
  py: number,
  pz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  s: number | readonly [number, number, number] = 1,
  order: 'XYZ' | 'YXZ' | 'ZYX' | 'YZX' = 'XYZ',
): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(rx, ry, rz, order));
  const sc = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(s[0], s[1], s[2]);
  return new Matrix4().compose(new Vector3(px, py, pz), q, sc);
}

/** Rounded rectangle path in shape coordinates. */
export function roundedRectPath<T extends Path>(p: T, x0: number, y0: number, x1: number, y1: number, r: number): T {
  const rr = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  p.moveTo(x0 + rr, y0);
  p.lineTo(x1 - rr, y0);
  p.quadraticCurveTo(x1, y0, x1, y0 + rr);
  p.lineTo(x1, y1 - rr);
  p.quadraticCurveTo(x1, y1, x1 - rr, y1);
  p.lineTo(x0 + rr, y1);
  p.quadraticCurveTo(x0, y1, x0, y1 - rr);
  p.lineTo(x0, y0 + rr);
  p.quadraticCurveTo(x0, y0, x0 + rr, y0);
  return p;
}

/**
 * Shapes in the model's XZ floor plane. Shapes are drawn in (x, -z) so that after extrudeY() the
 * geometry lands at the intended world (x, z).
 */
export function roundedRectXZ(x0: number, x1: number, z0: number, z1: number, r: number): Shape {
  return roundedRectPath(new Shape(), x0, -z1, x1, -z0, r);
}

export function roundedRectHoleXZ(x0: number, x1: number, z0: number, z1: number, r: number): Path {
  return roundedRectPath(new Path(), x0, -z1, x1, -z0, r);
}

export function circleXZ(cx: number, cz: number, r: number): Shape {
  const s = new Shape();
  s.absarc(cx, -cz, r, 0, Math.PI * 2, false);
  return s;
}

export function circleHoleXZ(cx: number, cz: number, r: number): Path {
  const p = new Path();
  p.absarc(cx, -cz, r, 0, Math.PI * 2, true);
  return p;
}

export function polyXZ(pts: readonly (readonly [number, number])[]): Shape {
  const s = new Shape();
  pts.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  return s;
}

export interface ExtrudeOpts {
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
}

/** Extrudes a shape vertically from y0 to y1 (bevel stays inside the outline). */
export function extrudeY(shape: Shape | Shape[], y0: number, y1: number, o: ExtrudeOpts = {}): ExtrudeGeometry {
  const b = Math.min(o.bevel ?? 0, (y1 - y0) * 0.45);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, y1 - y0 - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.bevelSegments ?? 2,
    curveSegments: o.curveSegments ?? 12,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + b, 0);
  return g;
}

/** Extrudes a shape drawn in XY along +Z from z0 to z1 (bevel stays inside the outline). */
export function extrudeZ(shape: Shape | Shape[], z0: number, z1: number, o: ExtrudeOpts = {}): ExtrudeGeometry {
  const b = Math.min(o.bevel ?? 0, (z1 - z0) * 0.45);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-5, z1 - z0 - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.bevelSegments ?? 2,
    curveSegments: o.curveSegments ?? 12,
  });
  g.translate(0, 0, z0 + b);
  return g;
}

/** Rounded rectangle in XY (for panels extruded along Z). */
export function roundedRectXY(x0: number, x1: number, y0: number, y1: number, r: number): Shape {
  return roundedRectPath(new Shape(), x0, y0, x1, y1, r);
}

/** Lathe band with a rectangular cross-section (r0..r1, y0..y1) over an arc. */
export function arcBand(
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  phiStart: number,
  phiLength: number,
  segments: number,
): LatheGeometry {
  const pts: ProfilePoint[] = [[r0, y0], [r1, y0, 0], [r1, y1, 0], [r0, y1, 0], [r0, y0]];
  return lathe(pts, segments, 1, phiStart, phiLength);
}

/** Helical ribbon (rubber flap / bristle strip) around the Y axis. */
export function helixRibbon(
  rIn: number,
  rOut: number,
  length: number,
  turns: number,
  phase: number,
  segments: number,
  sweep = 0.35,
): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = -length / 2 + t * length;
    const a = phase + t * turns * Math.PI * 2;
    pos.push(Math.cos(a) * rIn, y, Math.sin(a) * rIn);
    pos.push(Math.cos(a - sweep) * rOut, y, Math.sin(a - sweep) * rOut);
    uv.push(t, 0, t, 1);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Superellipsoid (rounded box / pillow) centred at the origin with half-sizes sx, sy, sz. */
export function superEllipsoid(sx: number, sy: number, sz: number, e: number, wSeg: number, hSeg: number): BufferGeometry {
  const g = new SphereGeometry(1, wSeg, hSeg);
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    p.setXYZ(
      i,
      Math.sign(x) * Math.pow(Math.abs(x), e) * sx,
      Math.sign(y) * Math.pow(Math.abs(y), e) * sy,
      Math.sign(z) * Math.pow(Math.abs(z), e) * sz,
    );
  }
  g.computeVertexNormals();
  return g;
}

/** Pleated (zig-zag) filter sheet in XZ: width along X, length along Z, folds peaking at +depth. */
export function pleatSheet(width: number, length: number, pleats: number, depth: number): BufferGeometry {
  const seg = pleats * 2;
  const g = new PlaneGeometry(width, length, seg, 1);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(((p.getX(i) + width / 2) / width) * seg);
    p.setY(i, k % 2 === 1 ? depth : 0);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return flat;
}

/** Smooth tube through control points. */
export function tube(points: readonly Vector3[], radius: number, tubular: number, radial: number): TubeGeometry {
  const curve = new CatmullRomCurve3(points.slice(), false, 'catmullrom', 0.3);
  return new TubeGeometry(curve, tubular, radius, radial, false);
}

/** Samples a smooth path into a flat xyz lookup table (for allocation-free particle motion). */
export function samplePath(points: readonly Vector3[], samples: number): Float32Array {
  const curve = new CatmullRomCurve3(points.slice(), false, 'catmullrom', 0.3);
  const out = new Float32Array(samples * 3);
  const v = new Vector3();
  for (let i = 0; i < samples; i++) {
    curve.getPointAt(i / (samples - 1), v);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Interpolates a sampled path LUT at t in [0,1] into out. */
export function lutPoint(lut: Float32Array, t: number, out: Vector3): Vector3 {
  const n = lut.length / 3;
  const f = Math.min(Math.max(t, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(f), n - 2);
  const k = f - i;
  const a = i * 3;
  const b = a + 3;
  return out.set(
    lut[a] + (lut[b] - lut[a]) * k,
    lut[a + 1] + (lut[b + 1] - lut[a + 1]) * k,
    lut[a + 2] + (lut[b + 2] - lut[a + 2]) * k,
  );
}

/** Helix wire (coil spring) along +Y from 0 to height. */
export function coilSpring(radius: number, wire: number, height: number, turns: number, segs: number, radial: number): TubeGeometry {
  const pts: Vector3[] = [];
  const n = Math.max(8, Math.round(turns * 16));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a) * radius, t * height, Math.sin(a) * radius));
  }
  const curve = new CatmullRomCurve3(pts);
  return new TubeGeometry(curve, segs, wire, radial, false);
}

/**
 * Pan/torx screw head (vertex-coloured: metal head + dark recess) with the head facing +Y, sitting
 * on y = 0. Use with a vertexColors material, ideally through an InstancedMesh.
 */
export function screwHeadGeometry(r: number, h: number, radial: number): BufferGeometry {
  const head = new LatheGeometry(profile([[r, 0], [r, h * 0.45, -1], [r * 0.78, h * 0.92, -1], [0, h]], 1), radial).toNonIndexed();
  const star = new Shape();
  const n = 6;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r * 0.42 : r * 0.24;
    if (i === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const recess = new ExtrudeGeometry(star, { depth: h * 0.12, bevelEnabled: false });
  recess.rotateX(-Math.PI / 2);
  recess.translate(0, h * 0.93, 0);
  const paint = (g: BufferGeometry, v: number): void => {
    const c = new Float32Array(g.attributes.position.count * 3).fill(v);
    g.setAttribute('color', new BufferAttribute(c, 3));
  };
  paint(head, 0.85);
  paint(recess, 0.06);
  const merged = mergeGeometries([head, recess], false);
  head.dispose();
  recess.dispose();
  if (!merged) throw new Error('screwHeadGeometry: merge failed');
  return merged;
}
