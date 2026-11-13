import * as THREE from 'three';

/** Corner radii, clockwise from top-left. */
export interface Corners {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

/** Adds a rounded rectangle outline (counter-clockwise) to a path. */
function traceRoundedRect(
  path: THREE.Path,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: Corners,
  reverse = false,
): void {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const pts: [number, number][] = [];
  const arc = (ax: number, ay: number, rad: number, a0: number, a1: number): void => {
    const steps = Math.max(2, Math.ceil(rad * 1.5));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([ax + Math.cos(a) * rad, ay + Math.sin(a) * rad]);
    }
  };
  // Counter-clockwise starting at bottom-left.
  arc(x0 + r.bl, y0 + r.bl, r.bl, Math.PI, Math.PI * 1.5);
  arc(x1 - r.br, y0 + r.br, r.br, Math.PI * 1.5, Math.PI * 2);
  arc(x1 - r.tr, y1 - r.tr, r.tr, 0, Math.PI * 0.5);
  arc(x0 + r.tl, y1 - r.tl, r.tl, Math.PI * 0.5, Math.PI);
  if (reverse) pts.reverse();
  dedupeInto(path, pts);
}

function dedupeInto(path: THREE.Path, pts: [number, number][]): void {
  let lx = Number.NaN;
  let ly = Number.NaN;
  let first = true;
  for (const [x, y] of pts) {
    if (Math.abs(x - lx) < 1e-4 && Math.abs(y - ly) < 1e-4) continue;
    if (first) path.moveTo(x, y);
    else path.lineTo(x, y);
    first = false;
    lx = x;
    ly = y;
  }
  path.closePath();
}

export function corners(all: number, overrides: Partial<Corners> = {}): Corners {
  return { tl: all, tr: all, br: all, bl: all, ...overrides };
}

export function roundedRectShape(cx: number, cy: number, w: number, h: number, r: Corners): THREE.Shape {
  const s = new THREE.Shape();
  traceRoundedRect(s, cx, cy, w, h, r);
  return s;
}

export function roundedRectHole(cx: number, cy: number, w: number, h: number, r: Corners): THREE.Path {
  const p = new THREE.Path();
  traceRoundedRect(p, cx, cy, w, h, r, true);
  return p;
}

/** A stadium/pill outline centred at (cx, cy), rotated by `angle` radians. */
export function capsulePoints(cx: number, cy: number, length: number, width: number, angle: number): [number, number][] {
  const r = width / 2;
  const half = length / 2 - r;
  const pts: [number, number][] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    pts.push([half + Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / steps;
    pts.push([-half + Math.cos(a) * r, Math.sin(a) * r]);
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

export function capsuleShape(cx: number, cy: number, length: number, width: number, angle: number): THREE.Shape {
  const s = new THREE.Shape();
  dedupeInto(s, capsulePoints(cx, cy, length, width, angle));
  return s;
}

export function capsuleHole(cx: number, cy: number, length: number, width: number, angle: number): THREE.Path {
  const p = new THREE.Path();
  dedupeInto(p, capsulePoints(cx, cy, length, width, angle).reverse());
  return p;
}

export function circleHole(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/** A plus/cross outline with lightly rounded outer corners. */
export function crossPoints(cx: number, cy: number, span: number, arm: number, round = 0.8): [number, number][] {
  const a = arm / 2;
  const s = span / 2;
  // Corner list counter-clockwise; outer corners get rounded, inner corners stay sharp.
  const raw: [number, number, boolean][] = [
    [a, -s, true], [a, -a, false], [s, -a, true], [s, a, true], [a, a, false], [a, s, true],
    [-a, s, true], [-a, a, false], [-s, a, true], [-s, -a, true], [-a, -a, false], [-a, -s, true],
  ];
  const pts: [number, number][] = [];
  for (let i = 0; i < raw.length; i++) {
    const [x, y, rounded] = raw[i]!;
    if (!rounded || round <= 0) {
      pts.push([cx + x, cy + y]);
      continue;
    }
    const prev = raw[(i + raw.length - 1) % raw.length]!;
    const next = raw[(i + 1) % raw.length]!;
    const d1 = norm(prev[0] - x, prev[1] - y);
    const d2 = norm(next[0] - x, next[1] - y);
    const p1: [number, number] = [x + d1[0] * round, y + d1[1] * round];
    const p2: [number, number] = [x + d2[0] * round, y + d2[1] * round];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      // Quadratic Bezier with the sharp corner as control point.
      const qx = (1 - t) * (1 - t) * p1[0] + 2 * (1 - t) * t * x + t * t * p2[0];
      const qy = (1 - t) * (1 - t) * p1[1] + 2 * (1 - t) * t * y + t * t * p2[1];
      pts.push([cx + qx, cy + qy]);
    }
  }
  return pts;
}

function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

export function crossShape(cx: number, cy: number, span: number, arm: number, round?: number): THREE.Shape {
  const s = new THREE.Shape();
  dedupeInto(s, crossPoints(cx, cy, span, arm, round));
  return s;
}

export function crossHole(cx: number, cy: number, span: number, arm: number, round?: number): THREE.Path {
  const p = new THREE.Path();
  dedupeInto(p, crossPoints(cx, cy, span, arm, round).reverse());
  return p;
}

export function shapeFromPoints(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  dedupeInto(s, pts);
  return s;
}

export function holeFromPoints(pts: [number, number][]): THREE.Path {
  const p = new THREE.Path();
  dedupeInto(p, [...pts].reverse());
  return p;
}

/** Extrude helper that keeps call sites short. Geometry spans z = [-bevel, depth + bevel]. */
export function extrude(
  shape: THREE.Shape | THREE.Shape[],
  depth: number,
  bevel = 0,
  bevelSegments = 3,
  curveSegments = 12,
): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments,
    curveSegments,
  });
}

/**
 * A thumb wheel: cylinder (axis = z) with a knurled rim. Built from CylinderGeometry with rim
 * vertices pushed in and out.
 */
export function knurledWheel(radius: number, thickness: number, ridges = 36): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, thickness, ridges * 2, 1, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < radius * 0.98) continue;
    const a = Math.atan2(z, x);
    const k = Math.round((a / (Math.PI * 2)) * ridges * 2);
    const scale = k % 2 === 0 ? 1 : 0.93;
    pos.setX(i, Math.cos(a) * radius * scale);
    pos.setZ(i, Math.sin(a) * radius * scale);
  }
  g.computeVertexNormals();
  g.rotateX(Math.PI / 2);
  return g;
}
