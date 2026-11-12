import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ComponentId } from '../core/types';

export type V3 = [number, number, number];

// ───────────────────────────── geometry factories ─────────────────────────────

export function rbox(w: number, h: number, d: number, r = 0.004, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

/** Cylinder whose axis runs along X. */
export function cylX(r: number, len: number, seg = 20, rTop = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, len, seg);
  g.rotateZ(-Math.PI / 2);
  return g;
}
export function cylY(r: number, len: number, seg = 20, rTop = r): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, r, len, seg);
}
/** Cylinder whose axis runs along Z (caps face ±Z). */
export function cylZ(r: number, len: number, seg = 20, rTop = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Extrude a side profile given as [z, y] points along X (width), centred on x = 0 (or at xCenter).
 */
export function extrudeProfileX(pts: Array<[number, number]>, width: number, bevel = 0.002): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2 - bevel, 0, 0);
  return g;
}

/** Extrude a front shape given in the XY plane (holes allowed) along +Z by depth, front face at z = depth. */
export function extrudeXY(shape: THREE.Shape, depth: number, bevel = 0): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 10,
  });
  if (bevel > 0) g.translate(0, 0, bevel);
  return g;
}

export function rectShape(cx: number, cy: number, w: number, h: number, r = 0): THREE.Shape {
  const s = new THREE.Shape();
  rectPath(s, cx, cy, w, h, r);
  return s;
}

export function rectPath(p: THREE.Path, cx: number, cy: number, w: number, h: number, r = 0): THREE.Path {
  const x = cx - w / 2;
  const y = cy - h / 2;
  if (r <= 0) {
    p.moveTo(x, y);
    p.lineTo(x + w, y);
    p.lineTo(x + w, y + h);
    p.lineTo(x, y + h);
    p.lineTo(x, y);
    return p;
  }
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

export function holeRect(cx: number, cy: number, w: number, h: number, r = 0): THREE.Path {
  // Holes must wind opposite to the outer shape.
  const p = new THREE.Path();
  const x = cx - w / 2;
  const y = cy - h / 2;
  if (r <= 0) {
    p.moveTo(x, y);
    p.lineTo(x, y + h);
    p.lineTo(x + w, y + h);
    p.lineTo(x + w, y);
    p.lineTo(x, y);
    return p;
  }
  p.moveTo(x + r, y);
  p.quadraticCurveTo(x, y, x, y + r);
  p.lineTo(x, y + h - r);
  p.quadraticCurveTo(x, y + h, x + r, y + h);
  p.lineTo(x + w - r, y + h);
  p.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  p.lineTo(x + w, y + r);
  p.quadraticCurveTo(x + w, y, x + w - r, y);
  p.lineTo(x + r, y);
  return p;
}

export function holeCircle(cx: number, cy: number, r: number): THREE.Path {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

/**
 * Flat ribbon (belt / paper strip) following a polyline. `across` is the width direction
 * (constant), the ribbon normal is tangent × across. V runs along the length in metres * vScale.
 */
export function ribbonGeometry(points: THREE.Vector3[], halfWidth: number, across = new THREE.Vector3(1, 0, 0), vScale = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) len += points[i].distanceTo(points[i - 1]);
    const a = points[i].clone().addScaledVector(across, -halfWidth);
    const b = points[i].clone().addScaledVector(across, halfWidth);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, len * vScale, 1, len * vScale);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ───────────────────────────── mesh helpers ─────────────────────────────

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], parent?: THREE.Object3D, pos?: V3, rot?: V3): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent?.add(m);
  return m;
}

export function group(parent?: THREE.Object3D, pos?: V3, name?: string): THREE.Group {
  const g = new THREE.Group();
  if (pos) g.position.set(pos[0], pos[1], pos[2]);
  if (name) g.name = name;
  parent?.add(g);
  return g;
}

/** Mark a mesh as dynamic (excluded from static merging). */
export function dyn<T extends THREE.Object3D>(o: T): T {
  o.userData.dynamic = true;
  return o;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Many identical small fasteners as one InstancedMesh. `normal` = direction the head faces.
 */
export function fasteners(parent: THREE.Object3D, positions: V3[], normal: V3, mat: THREE.Material, r = 0.003, componentId?: ComponentId): THREE.InstancedMesh {
  const prof = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r, r * 0.25),
    new THREE.Vector2(r * 0.8, r * 0.55),
    new THREE.Vector2(r * 0.4, r * 0.7),
    new THREE.Vector2(0, r * 0.72),
  ];
  const geo = new THREE.LatheGeometry(prof, 10);
  const im = new THREE.InstancedMesh(geo, mat, positions.length);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...normal).normalize());
  const m = new THREE.Matrix4();
  const s = new THREE.Vector3(1, 1, 1);
  positions.forEach((p, i) => {
    m.compose(new THREE.Vector3(p[0], p[1], p[2]), q, s);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.userData.dynamic = true;
  if (componentId) im.userData.componentId = componentId;
  parent.add(im);
  return im;
}

/** Instanced boxes (vent slots, louvres, fins). */
export function instancedBoxes(parent: THREE.Object3D, size: V3, positions: V3[], mat: THREE.Material, rot?: V3): THREE.InstancedMesh {
  const geo = box(size[0], size[1], size[2]);
  const im = new THREE.InstancedMesh(geo, mat, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
  const s = new THREE.Vector3(1, 1, 1);
  positions.forEach((p, i) => {
    m.compose(new THREE.Vector3(...p), q, s);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.userData.dynamic = true;
  parent.add(im);
  return im;
}

/** Instanced spheres/bumps (braille dots, rivets). */
export function instancedDots(parent: THREE.Object3D, r: number, positions: V3[], mat: THREE.Material): THREE.InstancedMesh {
  const geo = new THREE.SphereGeometry(r, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.rotateX(Math.PI / 2); // dome faces +Z
  const im = new THREE.InstancedMesh(geo, mat, positions.length);
  const m = new THREE.Matrix4();
  positions.forEach((p, i) => {
    m.makeTranslation(p[0], p[1], p[2]);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.userData.dynamic = true;
  parent.add(im);
  return im;
}

// ───────────────────────────── static merge ─────────────────────────────

/**
 * Merge static sibling meshes that share a material into single meshes (fewer draw calls).
 * Keeps userData.componentId, shadow flags and shell membership.
 */
export function mergeStatic(root: THREE.Object3D, shell: Set<THREE.Mesh>): void {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
      if (m.userData.dynamic || m.children.length > 0 || Array.isArray(m.material) || m.name) continue;
      if (m.userData.key || m.userData.prop) continue;
      const key = [m.material.uuid, m.userData.componentId ?? '', shell.has(m) ? 's' : '', m.castShadow ? 'c' : '', m.receiveShadow ? 'r' : '', m.renderOrder].join('|');
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(m);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of list) {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.clearGroups();
        g.applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        }
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        geos.push(g);
        g = g as THREE.BufferGeometry;
      }
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const first = list[0];
      const nm = new THREE.Mesh(merged, first.material);
      nm.userData.componentId = first.userData.componentId;
      nm.castShadow = first.castShadow;
      nm.receiveShadow = first.receiveShadow;
      nm.renderOrder = first.renderOrder;
      const wasShell = shell.has(first);
      for (const m of list) {
        parent.remove(m);
        m.geometry.dispose();
        shell.delete(m);
      }
      parent.add(nm);
      if (wasShell) shell.add(nm);
    }
  }
}

/** Dispose everything reachable from an object (geometries, materials, textures). */
export function disposeDeep(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
  });
  const texs = new Set<THREE.Texture>();
  for (const mat of mats) {
    for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texs.add(v);
    mat.dispose();
  }
  for (const t of texs) t.dispose();
  for (const g of geos) g.dispose();
}
