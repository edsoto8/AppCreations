import { BufferAttribute, Mesh, type BufferGeometry, type Material, type Matrix4, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Disposables } from './Disposables';

export interface BuildOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Mesh becomes see-through in x-ray mode. */
  xray?: boolean;
  /** Debug name prefix. */
  name?: string;
  renderOrder?: number;
}

const KEEP = new Set(['position', 'normal', 'uv']);

function normalize(g: BufferGeometry): BufferGeometry {
  g.clearGroups();
  for (const name of Object.keys(g.attributes)) {
    if (!KEEP.has(name)) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  }
  return g;
}

/** Merges geometries (any indexed/non-indexed mix) into one; disposes the inputs. */
export function mergeAll(list: BufferGeometry[]): BufferGeometry {
  if (list.length === 1) return normalize(list[0]);
  const anyNonIndexed = list.some((g) => g.index === null);
  const prepared = list.map((g) => {
    normalize(g);
    if (anyNonIndexed && g.index !== null) {
      const ni = g.toNonIndexed();
      g.dispose();
      return ni;
    }
    return g;
  });
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  if (!merged) throw new Error('PartBuilder: geometry merge failed');
  return merged;
}

/**
 * Collects many small geometries per material and merges them into one mesh per material, which
 * keeps draw calls low while allowing rich detail.
 */
export class PartBuilder {
  private readonly buckets = new Map<Material, BufferGeometry[]>();

  constructor(private readonly track: Disposables) {}

  add(geo: BufferGeometry, material: Material, matrix?: Matrix4): this {
    if (matrix) geo.applyMatrix4(matrix);
    const list = this.buckets.get(material);
    if (list) list.push(geo);
    else this.buckets.set(material, [geo]);
    return this;
  }

  /** Adds copies of a geometry for each matrix (the template is disposed). */
  addMany(geo: BufferGeometry, material: Material, matrices: readonly Matrix4[]): this {
    for (const m of matrices) this.add(geo.clone(), material, m);
    geo.dispose();
    return this;
  }

  get empty(): boolean {
    return this.buckets.size === 0;
  }

  build(parent: Object3D, opts: BuildOptions = {}): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [material, list] of this.buckets) {
      const geo = this.track.track(mergeAll(list));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, material);
      mesh.castShadow = opts.castShadow ?? false;
      mesh.receiveShadow = opts.receiveShadow ?? false;
      if (opts.xray) mesh.userData.xray = true;
      if (opts.name) mesh.name = `${opts.name}:${material.name}`;
      if (opts.renderOrder !== undefined) mesh.renderOrder = opts.renderOrder;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}
