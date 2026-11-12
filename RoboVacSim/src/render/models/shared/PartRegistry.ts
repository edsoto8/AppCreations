import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { InspectablePart } from '../types';

interface Variants {
  xray?: Material;
  hl?: Material;
  hlXray?: Material;
}

interface MeshRecord {
  mesh: Mesh;
  base: Material;
  partId: string;
  xray: boolean;
}

const HL_EMISSIVE = new Color(0.1, 0.42, 0.75);
const HL_BASIC = new Color(0.35, 0.8, 1);
const XRAY_OPACITY = 0.15;

function tint(m: Material, base: Material): void {
  if (m instanceof MeshStandardMaterial && base instanceof MeshStandardMaterial) {
    m.emissive.copy(base.emissive).multiplyScalar(base.emissiveIntensity).add(HL_EMISSIVE);
    m.emissiveIntensity = 1;
  } else if (m instanceof MeshBasicMaterial && base instanceof MeshBasicMaterial) {
    m.color.copy(base.color).lerp(HL_BASIC, 0.55);
  }
}

/**
 * Owns the inspectable parts of a model and the per-instance material variants used for x-ray and
 * highlight. Base materials are never mutated by x-ray/highlight: meshes are switched to cloned
 * variants and switched back, so turning a mode off restores the exact original look.
 */
export class PartRegistry {
  readonly parts: InspectablePart[] = [];
  private readonly records: MeshRecord[] = [];
  private readonly variants = new Map<Material, Variants>();
  private readonly dynamic: Material[] = [];
  private xrayOn = false;
  private highlighted: string | null = null;

  addPart(id: string, name: string, description: string, object: Object3D): InspectablePart {
    object.userData.partId = id;
    object.traverse((o) => {
      o.userData.partId = id;
      if (o instanceof Mesh) {
        const m = o.material as Material | Material[];
        if (Array.isArray(m)) throw new Error(`Part ${id}: multi-material meshes are not supported`);
        this.records.push({ mesh: o, base: m, partId: id, xray: o.userData.xray === true });
      }
    });
    const part: InspectablePart = { id, name, description, object };
    this.parts.push(part);
    return part;
  }

  /** Registers a material whose colour/emissive is animated each frame so its variants follow it. */
  markDynamic(m: Material): void {
    if (!this.dynamic.includes(m)) this.dynamic.push(m);
  }

  get meshCount(): number {
    return this.records.length;
  }

  setXray(on: boolean): void {
    if (this.xrayOn === on) return;
    this.xrayOn = on;
    this.apply();
  }

  highlight(id: string | null): void {
    const next = id && this.parts.some((p) => p.id === id) ? id : null;
    if (this.highlighted === next) return;
    this.highlighted = next;
    this.apply();
  }

  /** Copies animated values from dynamic base materials into any active variants (allocation-free). */
  syncDynamic(): void {
    for (const base of this.dynamic) {
      const v = this.variants.get(base);
      if (!v) continue;
      if (v.xray) this.copyDynamic(base, v.xray, false, true);
      if (v.hl) this.copyDynamic(base, v.hl, true, false);
      if (v.hlXray) this.copyDynamic(base, v.hlXray, true, true);
    }
  }

  dispose(): void {
    for (const v of this.variants.values()) {
      v.xray?.dispose();
      v.hl?.dispose();
      v.hlXray?.dispose();
    }
    this.variants.clear();
  }

  private copyDynamic(base: Material, v: Material, hl: boolean, xray: boolean): void {
    if (base instanceof MeshStandardMaterial && v instanceof MeshStandardMaterial) {
      v.color.copy(base.color);
      if (hl) tint(v, base);
      else {
        v.emissive.copy(base.emissive);
        v.emissiveIntensity = base.emissiveIntensity;
      }
    } else if (base instanceof MeshBasicMaterial && v instanceof MeshBasicMaterial) {
      v.color.copy(base.color);
      if (hl) tint(v, base);
    }
    v.opacity = xray ? base.opacity * XRAY_OPACITY : base.opacity;
  }

  private variantsOf(base: Material): Variants {
    let v = this.variants.get(base);
    if (!v) {
      v = {};
      this.variants.set(base, v);
    }
    return v;
  }

  private xrayVariant(base: Material): Material {
    const v = this.variantsOf(base);
    if (!v.xray) {
      const m = base.clone();
      m.transparent = true;
      m.opacity = (base.transparent ? base.opacity : 1) * XRAY_OPACITY;
      m.depthWrite = false;
      m.side = DoubleSide;
      if (m instanceof MeshPhysicalMaterial) m.transmission = 0;
      m.name = `${base.name}:xray`;
      v.xray = m;
    }
    return v.xray;
  }

  private hlVariant(base: Material, xray: boolean): Material {
    const v = this.variantsOf(base);
    if (xray) {
      if (!v.hlXray) {
        const m = this.xrayVariant(base).clone();
        tint(m, base);
        m.name = `${base.name}:hl-xray`;
        v.hlXray = m;
      }
      return v.hlXray;
    }
    if (!v.hl) {
      const m = base.clone();
      tint(m, base);
      m.name = `${base.name}:hl`;
      v.hl = m;
    }
    return v.hl;
  }

  private apply(): void {
    for (const r of this.records) {
      const x = this.xrayOn && r.xray;
      const h = this.highlighted === r.partId;
      r.mesh.material = h ? this.hlVariant(r.base, x) : x ? this.xrayVariant(r.base) : r.base;
    }
  }
}
