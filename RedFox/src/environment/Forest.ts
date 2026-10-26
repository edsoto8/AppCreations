/**
 * Optional forest backdrop: instanced pines, rocks and grass tufts kept back from the fox and
 * softened by fog. Everything scrolls with the ground while the fox walks or runs.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FIELD = 13; // half-size of the scrolling field (metres)

interface Item {
  mesh: InstancedMesh;
  pos: Vector3[];
  scale: Vector3[];
  rot: number[];
}

export class Forest {
  readonly group = new Group();
  private readonly items: Item[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private rngState = 4242;

  constructor() {
    this.group.name = 'Forest';
    const trees = this.scatter(110, 4.2, 2.1);
    this.addItem(pineGeometry(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), trees, true);
    const rocks = this.scatter(36, 1.6, 0.42);
    this.addItem(rockGeometry(), new MeshStandardMaterial({ color: 0x77736a, roughness: 0.95 }), rocks, true);
    const grass = this.scatter(520, 0.7, 0.9);
    this.addItem(
      grassGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide }),
      grass,
      false,
    );
  }

  private rnd(): number {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return this.rngState / 2147483647;
  }

  /** Random placements outside a corridor of half-width `clear` around the fox's path. */
  private scatter(count: number, clear: number, baseScale: number): Omit<Item, 'mesh'> {
    const pos: Vector3[] = [], scale: Vector3[] = [], rot: number[] = [];
    for (let i = 0; i < count; i++) {
      let x = 0;
      do x = (this.rnd() * 2 - 1) * FIELD;
      while (Math.abs(x) < clear + this.rnd() * clear);
      pos.push(new Vector3(x, 0, (this.rnd() * 2 - 1) * FIELD));
      const s = baseScale * (0.6 + this.rnd() * 0.9);
      scale.push(new Vector3(s, s * (0.85 + this.rnd() * 0.4), s));
      rot.push(this.rnd() * Math.PI * 2);
    }
    return { pos, scale, rot };
  }

  private addItem(geo: BufferGeometry, mat: MeshStandardMaterial, data: Omit<Item, 'mesh'>, shadows: boolean): void {
    const mesh = new InstancedMesh(geo, mat, data.pos.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const item = { mesh, ...data };
    this.items.push(item);
    this.materials.push(mat);
    this.geometries.push(geo);
    this.group.add(mesh);
    this.writeMatrices(item);
  }

  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  private writeMatrices(item: Item): void {
    for (let i = 0; i < item.pos.length; i++) {
      this.q.setFromAxisAngle(this.up, item.rot[i]);
      this.m.compose(item.pos[i], this.q, item.scale[i]);
      item.mesh.setMatrixAt(i, this.m);
    }
    item.mesh.instanceMatrix.needsUpdate = true;
  }

  scroll(distance: number): void {
    if (!this.group.visible) return;
    for (const item of this.items) {
      for (const p of item.pos) {
        p.z -= distance;
        if (p.z < -FIELD) p.z += FIELD * 2;
      }
      this.writeMatrices(item);
    }
  }

  setTint(sky: Color, intensity: number): void {
    // Keep foliage from glowing under very bright hemisphere presets.
    const f = Math.min(1, 1.2 / Math.max(intensity, 0.4));
    for (const m of this.materials) m.color.setScalar(f).lerp(sky, 0.05);
    this.materials[1].color.setHex(0x77736a).multiplyScalar(f);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const it of this.items) it.mesh.dispose();
    this.group.removeFromParent();
  }
}

function paint(geo: BufferGeometry, fn: (y: number, i: number) => Color): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getY(i), i);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function pineGeometry(): BufferGeometry {
  const trunk = paint(new CylinderGeometry(0.045, 0.085, 1.4, 10).translate(0, 0.7, 0), () => new Color(0x3e2c20));
  const layers: BufferGeometry[] = [trunk];
  const dark = new Color(0x15291b), light = new Color(0x2f4d2c);
  // Stacked, slightly drooping tiers with a ragged rim read as conifer boughs at a distance.
  for (let i = 0; i < 6; i++) {
    const r = 0.78 - i * 0.12, h = 0.85 - i * 0.07, y = 0.55 + i * 0.4;
    const cone = new ConeGeometry(r, h, 20, 3, true).translate(0, y + h / 2, 0);
    const p = cone.getAttribute('position');
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), z = p.getZ(v), py = p.getY(v);
      const ang = Math.atan2(z, x);
      const rim = 1 - (py - y) / h;
      const ragged = 1 + 0.12 * Math.sin(ang * 7 + i * 1.3) * rim;
      p.setXYZ(v, x * ragged, py - 0.08 * rim * rim, z * ragged);
    }
    cone.computeVertexNormals();
    layers.push(paint(cone, (py) => dark.clone().lerp(light, Math.min(1, Math.max(0, (py - y) / h)) * 0.7)));
  }
  return mergeGeometries(layers)!;
}

function rockGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.35, 3);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.85 + 0.12 * Math.sin(x * 9.1 + z * 5.3) * Math.cos(y * 7.7 - x * 3.1) + 0.05 * Math.sin(x * 23 + y * 17);
    p.setXYZ(i, x * n * 1.3, Math.max(y * n * 0.55, -0.06), z * n);
  }
  g.computeVertexNormals();
  return g;
}

function grassGeometry(): BufferGeometry {
  const blades: BufferGeometry[] = [];
  const base = new Color(0x2e4a1f), tip = new Color(0x8fa356);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.sin(i * 3.7);
    const h = 0.18 + 0.12 * Math.abs(Math.sin(i * 2.3));
    const lean = 0.05 + 0.04 * Math.cos(i * 1.7);
    const pos = new Float32Array([
      -0.012, 0, 0, 0.012, 0, 0, 0.0, h, lean,
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
    g.computeVertexNormals();
    blades.push(paint(g, (y) => base.clone().lerp(tip, y / h)));
  }
  return mergeGeometries(blades)!;
}
