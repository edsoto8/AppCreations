/**
 * The fox as Three.js objects: skeleton, skinned body, fur shells and eyes.
 */
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type MeshPhysicalMaterial,
} from 'three';
import { BONE_DEFS, BONE_INDEX } from './anatomy';
import { Eye, EyeResources } from './Eyes';
import type { FoxMeshData } from './FoxBuilder';
import { createFurMaterial, createFurUniforms, type FurUniforms } from './FurMaterial';

export class FoxModel {
  readonly object = new Group();
  readonly bones: Record<string, Bone> = {};
  readonly skeleton: Skeleton;
  readonly body: SkinnedMesh;
  readonly furUniforms: FurUniforms = createFurUniforms();
  readonly eyes: { L: Eye; R: Eye };
  readonly vertexCount: number;
  readonly triangleCount: number;

  private readonly geometry: BufferGeometry;
  private readonly skinMaterial: MeshPhysicalMaterial;
  private readonly eyeResources = new EyeResources();
  private shells: SkinnedMesh[] = [];
  private furVisible = true;
  private wireframe = false;

  constructor(data: FoxMeshData, shellCount: number) {
    this.object.name = 'Fox';
    this.geometry = createGeometry(data);
    this.vertexCount = data.positions.length / 3;
    this.triangleCount = data.indices.length / 3;

    // Skeleton in rest pose. Every bone starts with identity rotation (see anatomy.ts).
    const bones = BONE_DEFS.map((def) => {
      const bone = new Bone();
      bone.name = def.name;
      this.bones[def.name] = bone;
      return bone;
    });
    BONE_DEFS.forEach((def, i) => {
      if (!def.parent) {
        bones[i].position.set(...def.pos);
        return;
      }
      const parentDef = BONE_DEFS[BONE_INDEX[def.parent]];
      bones[i].position.set(def.pos[0] - parentDef.pos[0], def.pos[1] - parentDef.pos[1], def.pos[2] - parentDef.pos[2]);
      bones[BONE_INDEX[def.parent]].add(bones[i]);
    });

    this.skinMaterial = createFurMaterial({ uniforms: this.furUniforms });
    this.body = new SkinnedMesh(this.geometry, this.skinMaterial);
    this.body.name = 'FoxBody';
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.frustumCulled = false;
    this.body.add(bones[0]);
    bones[0].updateMatrixWorld(true);
    this.skeleton = new Skeleton(bones);
    this.body.bind(this.skeleton);
    this.object.add(this.body);

    this.eyes = {
      L: new Eye(data.eyes.L, 'L', this.eyeResources),
      R: new Eye(data.eyes.R, 'R', this.eyeResources),
    };
    const head = this.bones.head;
    const headPos = new Vector3(...BONE_DEFS[BONE_INDEX.head].pos);
    for (const side of ['L', 'R'] as const) {
      const c = new Vector3(...data.eyes[side].center).sub(headPos);
      this.eyes[side].attachTo(head, c);
    }

    this.setShellCount(shellCount);
  }

  get shellCount(): number {
    return this.shells.length;
  }

  /** Rebuilds the fur shells. Geometry and skeleton are shared; only materials are per shell. */
  setShellCount(count: number): void {
    for (const s of this.shells) {
      this.object.remove(s);
      (s.material as MeshPhysicalMaterial).dispose();
    }
    this.shells = [];
    for (let i = 1; i <= count; i++) {
      const h = i / count;
      const mat = createFurMaterial({ uniforms: this.furUniforms, shellHeight: h });
      const shell = new SkinnedMesh(this.geometry, mat);
      shell.name = `FurShell${i}`;
      shell.frustumCulled = false;
      shell.receiveShadow = true;
      shell.bind(this.skeleton, this.body.bindMatrix);
      // Inner shells first so outer strands composite over them.
      shell.renderOrder = i;
      this.shells.push(shell);
      this.object.add(shell);
    }
    this.applyVisibility();
  }

  setFurVisible(visible: boolean): void {
    this.furVisible = visible;
    this.applyVisibility();
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
    this.skinMaterial.wireframe = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const showFur = this.furVisible && !this.wireframe;
    for (const s of this.shells) s.visible = showFur;
    this.furUniforms.uFurOn.value = showFur ? 1 : 0;
    for (const e of [this.eyes.L, this.eyes.R]) e.group.visible = !this.wireframe;
  }

  update(time: number): void {
    this.furUniforms.uTime.value = time;
  }

  dispose(): void {
    for (const s of this.shells) (s.material as MeshPhysicalMaterial).dispose();
    this.shells = [];
    this.skinMaterial.dispose();
    this.geometry.dispose();
    this.eyeResources.dispose();
    this.skeleton.dispose();
    this.object.removeFromParent();
  }
}

function createGeometry(d: FoxMeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new BufferAttribute(d.normals, 3));
  g.setAttribute('color', new BufferAttribute(d.colors, 3));
  g.setAttribute('skinIndex', new BufferAttribute(d.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(d.skinWeight, 4));
  g.setAttribute('furData', new BufferAttribute(d.furData, 4));
  g.setAttribute('furDir', new BufferAttribute(d.furDir, 3));
  g.setIndex(new BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}
