import * as THREE from 'three';
import type { ComponentId } from '../core/types';
import type { Led } from './types';
import { labelMaterial, type LabelOpts, type MaterialSet, type ShellMaterialSet } from './materials';
import { mesh, type V3 } from './util';

export type MotorGroup = 'picker-A' | 'picker-B' | 'picker-C' | 'transport' | 'stacker' | 'presenter' | 'printer' | 'card' | 'deposit';
export type LedName = 'card' | 'cash' | 'receipt' | 'deposit' | 'contactless' | 'status';
export type FillBin = 'A' | 'B' | 'C' | 'reject' | 'retract' | 'deposit';

/** A spinning element: rotates about its local X axis (geometry built with the axis on X). */
export interface Spinner {
  obj: THREE.Object3D;
  speed: number; // rad/s
}

/** Visual fill indicator for a bin: scale.z (cassettes) or scale.y (bins) of `stack` from its base. */
export interface FillVisual {
  stack: THREE.Object3D;
  axis: 'y' | 'z';
  /** Full-scale length along the axis. */
  max: number;
  /** Optional pusher plate that rides on the stack face. */
  pusher?: THREE.Object3D;
  pusherBase?: number;
  min?: number;
}

export class LedImpl implements Led {
  state: 'off' | 'on' | 'blink' = 'off';
  color: THREE.Color;
  readonly material: THREE.MeshStandardMaterial;
  constructor(
    public mesh: THREE.Mesh,
    color: number,
    private onIntensity = 2.6,
  ) {
    this.color = new THREE.Color(color);
    this.material = mesh.material as THREE.MeshStandardMaterial;
    this.apply(false);
  }
  set(state: 'off' | 'on' | 'blink', color?: number): void {
    this.state = state;
    if (color !== undefined) this.color.set(color);
    this.apply(state === 'on');
  }
  apply(lit: boolean): void {
    this.material.emissive.copy(this.color);
    this.material.emissiveIntensity = lit ? this.onIntensity : 0.06;
    this.material.color.copy(this.color).multiplyScalar(lit ? 0.6 : 0.18);
  }
  /** Called every frame with the blink phase (seconds). */
  tick(t: number): void {
    if (this.state === 'blink') this.apply(Math.floor(t * 2.5) % 2 === 0);
  }
}

export interface BuildCtx {
  m: MaterialSet;
  s: ShellMaterialSet;
  root: THREE.Group;
  parts: Map<ComponentId, THREE.Object3D>;
  shell: Set<THREE.Mesh>;
  /** Materials/textures created ad hoc (labels etc.), disposed with the model. */
  ownedMaterials: THREE.Material[];
  ownedTextures: THREE.Texture[];
  spinners: Record<MotorGroup, Spinner[]>;
  belts: Record<MotorGroup, THREE.Texture[]>;
  leds: Partial<Record<LedName, LedImpl>>;
  fills: Partial<Record<FillBin, FillVisual>>;
  /** Named anchors (filled by the builders, assembled into AtmAnchors in buildAtm). */
  anchors: Map<string, THREE.Object3D>;
}

export function createCtx(m: MaterialSet, s: ShellMaterialSet): BuildCtx {
  const motorGroups: MotorGroup[] = ['picker-A', 'picker-B', 'picker-C', 'transport', 'stacker', 'presenter', 'printer', 'card', 'deposit'];
  const spinners = {} as Record<MotorGroup, Spinner[]>;
  const belts = {} as Record<MotorGroup, THREE.Texture[]>;
  for (const g of motorGroups) {
    spinners[g] = [];
    belts[g] = [];
  }
  return {
    m,
    s,
    root: new THREE.Group(),
    parts: new Map(),
    shell: new Set(),
    ownedMaterials: [],
    ownedTextures: [],
    spinners,
    belts,
    leds: {},
    fills: {},
    anchors: new Map(),
  };
}

/** Create and register a component group. */
export function part(ctx: BuildCtx, id: ComponentId, parent: THREE.Object3D, pos: V3 = [0, 0, 0]): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  g.userData.partId = id;
  g.userData.componentId = id;
  g.position.set(pos[0], pos[1], pos[2]);
  parent.add(g);
  ctx.parts.set(id, g);
  return g;
}

/** Add a mesh to the outer shell set. */
export function shellMesh<T extends THREE.Mesh>(ctx: BuildCtx, m: T, castShadow = false): T {
  ctx.shell.add(m);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

/** A flat printed label (plane) facing +Z in the parent's frame. */
export function label(ctx: BuildCtx, parent: THREE.Object3D, o: LabelOpts, size: [number, number], pos: V3, rot?: V3, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Mesh {
  const mat = labelMaterial(o, extra);
  ctx.ownedMaterials.push(mat);
  if (mat.map) ctx.ownedTextures.push(mat.map);
  const pl = mesh(new THREE.PlaneGeometry(size[0], size[1]), mat, parent, pos, rot);
  return pl;
}

/** An LED mesh with its own material. */
export function ledMesh(ctx: BuildCtx, geo: THREE.BufferGeometry, parent: THREE.Object3D, pos: V3, color: number, name: LedName | null, intensity = 2.6): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0 });
  ctx.ownedMaterials.push(mat);
  const m = mesh(geo, mat, parent, pos);
  m.userData.dynamic = true;
  if (name) {
    m.name = `led-${name}`;
    ctx.leds[name] = new LedImpl(m, color, intensity);
  }
  return m;
}

export function anchor(ctx: BuildCtx, name: string, parent: THREE.Object3D, worldPos: V3): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = `anchor-${name}`;
  parent.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(...worldPos);
  parent.worldToLocal(p);
  o.position.copy(p);
  parent.add(o);
  ctx.anchors.set(name, o);
  return o;
}

/** Spinning roller with its axis along X (geometry must be built along X). */
export function spinner(ctx: BuildCtx, group: MotorGroup, obj: THREE.Object3D, speed = 18): THREE.Object3D {
  obj.userData.dynamic = true;
  ctx.spinners[group].push({ obj, speed });
  return obj;
}
