import * as THREE from 'three';
import type { FurnitureItem, HouseLayout, ObstacleItem } from '../../sim/world/types';
import { buildFloors, buildWalls, type BuiltGroup, type WallMode } from './architecture';
import { buildFurniture, buildObstacle, obstacleColor } from './furniture';
import { ModelBuilder, type ModelData } from './geometry';
import { MaterialLibrary, type MatKey } from './materials';
import { QUALITY_SETTINGS, TextureLibrary, type HouseQuality } from './textures';

export type { WallMode } from './architecture';
export type { HouseQuality } from './textures';

type PickKind = 'furniture' | 'obstacle';

interface ItemEntry {
  id: string;
  pickKind: PickKind;
  sig: string;
  root: THREE.Group;
  meshes: THREE.Mesh[];
  /** Wall-mounted parts (mirrors, backsplash): only visible in 'full' wall mode. */
  wallMeshes: THREE.Mesh[];
  instanced: THREE.InstancedMesh[];
  matKeys: MatKey[];
  small: boolean;
  /** Original materials while highlighted. */
  saved: THREE.Material[] | null;
}

const HIGHLIGHT_EMISSIVE = new THREE.Color('#2f7cf6');

/** Small trim/decor materials that never cast shadows (saves shadow-pass draw calls). */
const NO_SHADOW: ReadonlySet<string> = new Set(['shade', 'bulb', 'screen', 'mirror', 'glassDark', 'brass', 'chrome', 'steel', 'kibble']);

/**
 * Three.js view of a HouseLayout: floors, rugs, stairwells, walls (3 display modes), door frames,
 * thresholds, baseboards, furniture and obstacles.
 *
 * - sync() is incremental: transforms-only edits just move item roots; changed items are rebuilt
 *   individually; floors/walls are rebuilt only when their inputs change; a new layout.id rebuilds all.
 * - Furniture models are cached by (kind, size, color, detail) and shared between identical items;
 *   geometries and materials are reference counted and disposed when unused.
 * - Never adds lights (only small emissive lamp shades).
 */
export class HouseView {
  readonly root = new THREE.Group();
  readonly floorMeshes: THREE.Mesh[] = [];

  private readonly textures: TextureLibrary;
  private readonly materials: MaterialLibrary;
  private readonly models = new Map<string, { data: ModelData; refs: number }>();
  private readonly items = new Map<string, ItemEntry>();
  private readonly itemsGroup = new THREE.Group();
  private quality: HouseQuality;
  private wallMode: WallMode = 'full';
  private layout: HouseLayout | null = null;
  private layoutId: string | null = null;
  private floors: BuiltGroup | null = null;
  private walls: BuiltGroup | null = null;
  private floorSig = '';
  private wallSig = '';
  private highlightId: string | null = null;
  private disposed = false;

  constructor(opts: { quality?: HouseQuality } = {}) {
    this.quality = opts.quality ?? 'high';
    this.textures = new TextureLibrary(this.quality);
    this.materials = new MaterialLibrary(this.textures);
    this.root.name = 'house';
    this.itemsGroup.name = 'items';
    this.root.add(this.itemsGroup);
  }

  sync(layout: HouseLayout): void {
    if (this.disposed) return;
    if (layout.id !== this.layoutId) {
      this.clearAll();
      this.layoutId = layout.id;
    }
    this.layout = layout;
    const floorSig = JSON.stringify([layout.rooms, layout.rugs, layout.cliffs, layout.walls]);
    if (floorSig !== this.floorSig) {
      this.floorSig = floorSig;
      this.rebuildFloors();
    }
    const wallSig = JSON.stringify([layout.walls, layout.doors, layout.cliffs, layout.rooms.map((r) => r.rects)]);
    if (wallSig !== this.wallSig) {
      this.wallSig = wallSig;
      this.rebuildWalls();
    }
    const seen = new Set<string>();
    for (const f of layout.furniture) this.syncItem(f, 'furniture', seen);
    for (const o of layout.obstacles) this.syncItem(o, 'obstacle', seen);
    for (const [id, e] of this.items) if (!seen.has(id)) this.removeItem(e);
  }

  setWallMode(mode: WallMode): void {
    if (mode === this.wallMode) return;
    this.wallMode = mode;
    this.rebuildWalls();
    for (const e of this.items.values()) for (const m of e.wallMeshes) m.visible = mode === 'full';
  }

  getWallMode(): WallMode {
    return this.wallMode;
  }

  setQuality(q: HouseQuality): void {
    if (q === this.quality) return;
    const detailsChanged = QUALITY_SETTINGS[q].details !== QUALITY_SETTINGS[this.quality].details;
    this.quality = q;
    this.textures.setQuality(q);
    this.rebuildWalls();
    if (detailsChanged && this.layout) {
      // Detail level is part of the model signature: rebuild all items.
      for (const e of [...this.items.values()]) this.removeItem(e);
      this.sync(this.layout);
    } else {
      for (const e of this.items.values()) this.applyShadowFlags(e);
    }
  }

  getItemObject(id: string): THREE.Object3D | undefined {
    return this.items.get(id)?.root;
  }

  setHighlight(id: string | null): void {
    if (id === this.highlightId) return;
    if (this.highlightId) {
      const prev = this.items.get(this.highlightId);
      if (prev) this.unhighlight(prev);
    }
    this.highlightId = id;
    const e = id ? this.items.get(id) : undefined;
    if (e) this.highlight(e);
  }

  /** Debug/leak-check counters. */
  stats(): { items: number; models: number; materials: number } {
    return { items: this.items.size, models: this.models.size, materials: this.materials.size };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearAll();
    this.materials.dispose();
    this.textures.dispose();
    this.root.removeFromParent();
    this.disposed = true;
  }

  // ------------------------------------------------------------------------------------------

  private get details(): boolean {
    return QUALITY_SETTINGS[this.quality].details;
  }

  private clearAll(): void {
    this.setHighlight(null);
    for (const e of [...this.items.values()]) this.removeItem(e);
    this.floors?.dispose();
    this.floors = null;
    this.walls?.dispose();
    this.walls = null;
    this.floorMeshes.length = 0;
    this.floorSig = '';
    this.wallSig = '';
    this.layoutId = null;
  }

  private rebuildFloors(): void {
    this.floors?.dispose();
    this.floors = null;
    this.floorMeshes.length = 0;
    if (!this.layout) return;
    const f = buildFloors(this.layout, this.materials);
    this.floors = f;
    this.floorMeshes.push(...f.floorMeshes);
    this.root.add(f.group);
  }

  private rebuildWalls(): void {
    this.walls?.dispose();
    this.walls = null;
    if (!this.layout) return;
    this.walls = buildWalls(this.layout, this.wallMode, this.details, this.materials);
    this.root.add(this.walls.group);
  }

  private signature(it: FurnitureItem | ObstacleItem, kind: PickKind): string {
    const color = kind === 'furniture' ? ((it as FurnitureItem).color ?? '') : obstacleColor(it as ObstacleItem);
    return `${kind}:${it.kind}:${it.w.toFixed(4)}:${it.d.toFixed(4)}:${it.h.toFixed(4)}:${color}:${this.details ? 1 : 0}`;
  }

  private syncItem(it: FurnitureItem | ObstacleItem, kind: PickKind, seen: Set<string>): void {
    seen.add(it.id);
    const sig = this.signature(it, kind);
    let e = this.items.get(it.id);
    if (e && (e.sig !== sig || e.pickKind !== kind)) {
      this.removeItem(e);
      e = undefined;
    }
    if (!e) e = this.createItem(it, kind, sig);
    e.root.position.set(it.x, 0, it.y);
    e.root.rotation.set(0, -it.rotation, 0);
  }

  private acquireModel(sig: string, it: FurnitureItem | ObstacleItem, kind: PickKind): ModelData {
    let m = this.models.get(sig);
    if (!m) {
      const b = new ModelBuilder();
      if (kind === 'furniture') buildFurniture(it as FurnitureItem, b, this.details);
      else buildObstacle(it as ObstacleItem, obstacleColor(it as ObstacleItem), b);
      m = { data: b.build(), refs: 0 };
      this.models.set(sig, m);
    }
    m.refs++;
    return m.data;
  }

  private releaseModel(sig: string): void {
    const m = this.models.get(sig);
    if (!m) return;
    if (--m.refs <= 0) {
      m.data.dispose();
      this.models.delete(sig);
    }
  }

  private createItem(it: FurnitureItem | ObstacleItem, kind: PickKind, sig: string): ItemEntry {
    const data = this.acquireModel(sig, it, kind);
    const root = new THREE.Group();
    root.name = `${kind}:${it.id}`;
    const userData = { pickKind: kind, id: it.id };
    root.userData = { ...userData };
    const e: ItemEntry = { id: it.id, pickKind: kind, sig, root, meshes: [], wallMeshes: [], instanced: [], matKeys: [], small: data.small, saved: null };
    for (const p of data.parts) {
      const mesh = new THREE.Mesh(p.geometry, this.materials.acquire(p.mat));
      e.matKeys.push(p.mat);
      mesh.userData = { ...userData };
      mesh.receiveShadow = true;
      if (p.wallMounted) {
        mesh.visible = this.wallMode === 'full';
        e.wallMeshes.push(mesh);
      }
      root.add(mesh);
      e.meshes.push(mesh);
    }
    for (const p of data.instanced) {
      const im = new THREE.InstancedMesh(p.geometry, this.materials.acquire(p.mat), p.matrices.length);
      e.matKeys.push(p.mat);
      p.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      p.colors.forEach((c, i) => im.setColorAt(i, c));
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.userData = { ...userData };
      im.receiveShadow = true;
      root.add(im);
      e.instanced.push(im);
    }
    this.applyShadowFlags(e);
    this.items.set(it.id, e);
    this.itemsGroup.add(root);
    if (this.highlightId === it.id) this.highlight(e);
    return e;
  }

  private applyShadowFlags(e: ItemEntry): void {
    const cast = !e.small || QUALITY_SETTINGS[this.quality].smallShadows;
    e.meshes.forEach((m, i) => {
      m.castShadow = cast && !NO_SHADOW.has(e.matKeys[i]);
    });
    for (const m of e.instanced) m.castShadow = cast && this.quality === 'ultra';
  }

  private removeItem(e: ItemEntry): void {
    if (e.saved) this.unhighlight(e);
    e.root.removeFromParent();
    for (const im of e.instanced) im.dispose();
    e.matKeys.forEach((k) => this.materials.release(k));
    this.releaseModel(e.sig);
    this.items.delete(e.id);
  }

  private highlight(e: ItemEntry): void {
    if (e.saved) return;
    const all: Array<THREE.Mesh | THREE.InstancedMesh> = [...e.meshes, ...e.instanced];
    e.saved = all.map((m) => m.material as THREE.Material);
    for (const m of all) {
      const clone = (m.material as THREE.Material).clone();
      if (clone instanceof THREE.MeshStandardMaterial) {
        clone.emissive.copy(HIGHLIGHT_EMISSIVE);
        clone.emissiveIntensity = 0.45;
      }
      m.material = clone;
    }
  }

  private unhighlight(e: ItemEntry): void {
    if (!e.saved) return;
    const all: Array<THREE.Mesh | THREE.InstancedMesh> = [...e.meshes, ...e.instanced];
    all.forEach((m, i) => {
      (m.material as THREE.Material).dispose();
      m.material = e.saved![i];
    });
    e.saved = null;
  }
}
