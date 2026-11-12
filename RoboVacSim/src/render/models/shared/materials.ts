import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import type { Disposables } from './Disposables';
import type { TextureLibrary } from './textures';

/**
 * Per-model PBR material set. Every model instance owns its own materials (never shared between
 * instances), so animation, x-ray and highlight changes cannot leak into another model.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, Material>();

  constructor(
    private readonly tex: TextureLibrary,
    private readonly track: Disposables,
  ) {}

  private memo<T extends Material>(key: string, make: () => T): T {
    const hit = this.cache.get(key);
    if (hit) return hit as T;
    const m = make();
    m.name = key;
    this.cache.set(key, m);
    this.track.track(m);
    return m;
  }

  // ---- shells & plastics -------------------------------------------------------------------------

  /** Pearl-white clear-coated shell plastic. */
  get pearl(): MeshPhysicalMaterial {
    return this.memo('pearl', () => new MeshPhysicalMaterial({
      color: 0xe7e8ea, roughness: 0.42, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.16,
      roughnessMap: this.tex.get('speckle'), sheen: 0.15, sheenColor: new Color(0xffffff), sheenRoughness: 0.6,
    }));
  }

  /** Deep graphite piano finish with metallic flake under clear coat. */
  get gloss(): MeshPhysicalMaterial {
    return this.memo('gloss', () => new MeshPhysicalMaterial({
      color: 0x1a1d22, roughness: 0.3, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.05,
    }));
  }

  /** Satin dark-grey structural plastic. */
  get graphite(): MeshStandardMaterial {
    return this.memo('graphite', () => new MeshStandardMaterial({
      color: 0x2b2f35, roughness: 0.62, metalness: 0.05, roughnessMap: this.tex.get('speckle'),
    }));
  }

  /** Darker underside plastic. */
  get charcoal(): MeshStandardMaterial {
    return this.memo('charcoal', () => new MeshStandardMaterial({
      color: 0x1b1e22, roughness: 0.72, metalness: 0.02, roughnessMap: this.tex.get('speckle'),
    }));
  }

  /** Light grey satin plastic (filters frames, connectors). */
  get lightPlastic(): MeshStandardMaterial {
    return this.memo('lightPlastic', () => new MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.55, metalness: 0 }));
  }

  get blackMatte(): MeshStandardMaterial {
    return this.memo('blackMatte', () => new MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.92, metalness: 0 }));
  }

  get connector(): MeshStandardMaterial {
    return this.memo('connector', () => new MeshStandardMaterial({ color: 0xe6e1d4, roughness: 0.6 }));
  }

  // ---- metals -------------------------------------------------------------------------------------

  get brushedAlu(): MeshStandardMaterial {
    return this.memo('brushedAlu', () => new MeshStandardMaterial({
      color: 0xc9cdd2, metalness: 1, roughness: 0.36, roughnessMap: this.tex.get('brushed'),
    }));
  }

  /** Dark anodized titanium. */
  get titanium(): MeshStandardMaterial {
    return this.memo('titanium', () => new MeshStandardMaterial({
      color: 0x50565e, metalness: 1, roughness: 0.4, roughnessMap: this.tex.get('brushed'),
    }));
  }

  /** Champagne anodized accent. */
  get champagne(): MeshStandardMaterial {
    return this.memo('champagne', () => new MeshStandardMaterial({
      color: 0xcdb791, metalness: 1, roughness: 0.3, roughnessMap: this.tex.get('brushed'),
    }));
  }

  get steel(): MeshStandardMaterial {
    return this.memo('steel', () => new MeshStandardMaterial({ color: 0x9da3a9, metalness: 1, roughness: 0.3 }));
  }

  get chrome(): MeshStandardMaterial {
    return this.memo('chrome', () => new MeshStandardMaterial({ color: 0xe2e5e8, metalness: 1, roughness: 0.12 }));
  }

  get gold(): MeshStandardMaterial {
    return this.memo('gold', () => new MeshStandardMaterial({ color: 0xe3b866, metalness: 1, roughness: 0.22 }));
  }

  get copper(): MeshStandardMaterial {
    return this.memo('copper', () => new MeshStandardMaterial({ color: 0xc27a4a, metalness: 1, roughness: 0.34 }));
  }

  /** Vertex-coloured metal for instanced screw heads. */
  get screw(): MeshStandardMaterial {
    return this.memo('screw', () => new MeshStandardMaterial({ color: 0xb4b9bf, metalness: 1, roughness: 0.33, vertexColors: true }));
  }

  get nickel(): MeshStandardMaterial {
    return this.memo('nickel', () => new MeshStandardMaterial({ color: 0xb7babe, metalness: 1, roughness: 0.32 }));
  }

  // ---- rubber & fibres ----------------------------------------------------------------------------

  get rubber(): MeshStandardMaterial {
    return this.memo('rubber', () => new MeshStandardMaterial({ color: 0x18191b, roughness: 0.86, metalness: 0 }));
  }

  get rubberDouble(): MeshStandardMaterial {
    return this.memo('rubberDouble', () => new MeshStandardMaterial({ color: 0x1d2024, roughness: 0.8, side: DoubleSide }));
  }

  get rubberGrey(): MeshStandardMaterial {
    return this.memo('rubberGrey', () => new MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.82 }));
  }

  get bristle(): MeshStandardMaterial {
    return this.memo('bristle', () => new MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.55 }));
  }

  get bristleAccent(): MeshStandardMaterial {
    return this.memo('bristleAccent', () => new MeshStandardMaterial({ color: 0x17a89c, roughness: 0.5 }));
  }

  get microfiber(): MeshStandardMaterial {
    return this.memo('microfiber', () => new MeshStandardMaterial({ map: this.tex.get('microfiber'), roughness: 1, metalness: 0 }));
  }

  get fabricBag(): MeshStandardMaterial {
    return this.memo('fabricBag', () => new MeshStandardMaterial({
      map: this.tex.get('fabric'), roughness: 0.95, transparent: true, opacity: 0.78, side: DoubleSide, depthWrite: false,
    }));
  }

  get hepa(): MeshStandardMaterial {
    return this.memo('hepa', () => new MeshStandardMaterial({ map: this.tex.get('paper'), roughness: 0.95, side: DoubleSide }));
  }

  get dust(): MeshStandardMaterial {
    return this.memo('dust', () => new MeshStandardMaterial({ map: this.tex.get('dust'), roughness: 1 }));
  }

  // ---- glass & translucent polymers --------------------------------------------------------------

  /** Opaque black glass (sensor fascias, display bezel). */
  get darkGlass(): MeshPhysicalMaterial {
    return this.memo('darkGlass', () => new MeshPhysicalMaterial({
      color: 0x05070a, roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02,
    }));
  }

  /** Smoked glass you can partially see through (LiDAR band, camera window). */
  get smokedGlass(): MeshPhysicalMaterial {
    return this.memo('smokedGlass', () => new MeshPhysicalMaterial({
      color: 0x10141a, roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02,
      transparent: true, opacity: 0.55, depthWrite: false,
    }));
  }

  /** Coated optical lens with thin-film iridescence. */
  get lens(): MeshPhysicalMaterial {
    return this.memo('lens', () => new MeshPhysicalMaterial({
      color: 0x0d141c, roughness: 0.04, metalness: 0.35, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.7,
      iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 520,
    }));
  }

  /** Clear blue-grey polycarbonate (clean-water tanks). */
  get clearPoly(): MeshPhysicalMaterial {
    return this.memo('clearPoly', () => new MeshPhysicalMaterial({
      color: 0x9ec3d6, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      transparent: true, opacity: 0.46, depthWrite: false,
    }));
  }

  /** Smoked polycarbonate (dust bin, ducts). */
  get smokePoly(): MeshPhysicalMaterial {
    return this.memo('smokePoly', () => new MeshPhysicalMaterial({
      color: 0x39414b, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.42, depthWrite: false, side: DoubleSide,
    }));
  }

  /** Amber-tinted polycarbonate (dirty-water tank). */
  get amberPoly(): MeshPhysicalMaterial {
    return this.memo('amberPoly', () => new MeshPhysicalMaterial({
      color: 0x8d7a62, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.36, depthWrite: false,
    }));
  }

  get waterClean(): MeshPhysicalMaterial {
    return this.memo('waterClean', () => new MeshPhysicalMaterial({
      color: 0x3fb4e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.58, depthWrite: false,
      emissive: new Color(0x0a3c54), emissiveIntensity: 0.6, clearcoat: 1,
    }));
  }

  get waterDirty(): MeshStandardMaterial {
    return this.memo('waterDirty', () => new MeshStandardMaterial({
      color: 0x5a4c38, roughness: 0.22, transparent: true, opacity: 0.84, depthWrite: false,
    }));
  }

  get hoseClean(): MeshPhysicalMaterial {
    return this.memo('hoseClean', () => new MeshPhysicalMaterial({
      color: 0x9fd6ee, roughness: 0.25, transparent: true, opacity: 0.6, clearcoat: 0.6, depthWrite: false,
    }));
  }

  get hoseDirty(): MeshPhysicalMaterial {
    return this.memo('hoseDirty', () => new MeshPhysicalMaterial({
      color: 0xb48c5c, roughness: 0.25, transparent: true, opacity: 0.65, clearcoat: 0.6, depthWrite: false,
    }));
  }

  // ---- electronics --------------------------------------------------------------------------------

  get pcb(): MeshStandardMaterial {
    return this.memo('pcb', () => new MeshStandardMaterial({ map: this.tex.get('pcb'), roughness: 0.5, metalness: 0.1 }));
  }

  get chip(): MeshStandardMaterial {
    return this.memo('chip', () => new MeshStandardMaterial({ color: 0x141619, roughness: 0.42, metalness: 0.1 }));
  }

  get batteryWrap(): MeshPhysicalMaterial {
    return this.memo('batteryWrap', () => new MeshPhysicalMaterial({
      color: 0x2c5fc4, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2,
    }));
  }

  get wireRed(): MeshStandardMaterial {
    return this.memo('wireRed', () => new MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }));
  }

  get wireBlack(): MeshStandardMaterial {
    return this.memo('wireBlack', () => new MeshStandardMaterial({ color: 0x202226, roughness: 0.5 }));
  }

  // ---- emissive ---------------------------------------------------------------------------------------

  /** Unlit material for instanced LEDs (per-instance colour). */
  get led(): MeshBasicMaterial {
    return this.memo('led', () => new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  }

  /** Frosted light-guide diffuser (emissive driven per frame). */
  get diffuser(): MeshStandardMaterial {
    return this.memo('diffuser', () => new MeshStandardMaterial({
      color: 0xdfe6ea, roughness: 0.35, transparent: true, opacity: 0.8, emissive: new Color(0x000000), depthWrite: false,
    }));
  }

  /** Warm exhaust glow behind vent slats (emissive driven per frame). */
  get ventGlow(): MeshStandardMaterial {
    return this.memo('ventGlow', () => new MeshStandardMaterial({
      color: 0x0d0b0a, roughness: 0.9, emissive: new Color(0xff9a52), emissiveIntensity: 0,
    }));
  }

  get laser(): MeshStandardMaterial {
    return this.memo('laser', () => new MeshStandardMaterial({
      color: 0x200008, emissive: new Color(0xff2448), emissiveIntensity: 2.4, roughness: 0.2,
    }));
  }

  get irGlow(): MeshStandardMaterial {
    return this.memo('irGlow', () => new MeshStandardMaterial({
      color: 0x14060a, emissive: new Color(0xb0203c), emissiveIntensity: 1.1, roughness: 0.2,
    }));
  }

  get iconGlow(): MeshStandardMaterial {
    return this.memo('iconGlow', () => new MeshStandardMaterial({
      color: 0x202326, emissive: new Color(0xd8f4ff), emissiveIntensity: 0.55, roughness: 0.4,
    }));
  }

  /** Light strip (emissive colour / intensity animated per frame). */
  get lightStrip(): MeshStandardMaterial {
    return this.memo('lightStrip', () => new MeshStandardMaterial({
      color: 0x050505, emissive: new Color(0xffffff), emissiveIntensity: 1, emissiveMap: this.tex.get('strip'), roughness: 0.3,
    }));
  }

  get contactGlow(): MeshStandardMaterial {
    return this.memo('contactGlow', () => new MeshStandardMaterial({
      color: 0x1a1408, emissive: new Color(0xffb347), emissiveIntensity: 0, roughness: 0.3,
    }));
  }

  /** Warm drying-air glow (emissive driven per frame). */
  get warmGlow(): MeshStandardMaterial {
    return this.memo('warmGlow', () => new MeshStandardMaterial({
      color: 0x120c08, emissive: new Color(0xff8a3c), emissiveIntensity: 0, roughness: 0.6,
    }));
  }

  /** Red/white section-cut hatch for cutaway caps. */
  get hatch(): MeshStandardMaterial {
    return this.memo('hatch', () => new MeshStandardMaterial({
      map: this.tex.get('hatch'), roughness: 0.7, side: DoubleSide, emissive: new Color(0x2a0805),
    }));
  }

  /** Anti-slip dock floor. */
  get dockFloor(): MeshStandardMaterial {
    return this.memo('dockFloor', () => new MeshStandardMaterial({
      color: 0x24282d, roughness: 0.75, metalness: 0.05, bumpMap: this.tex.get('antislip'), bumpScale: 0.6,
      roughnessMap: this.tex.get('antislip'),
    }));
  }

  /** Additive blending sprite material base settings (cloned per particle stream). */
  spriteParams(): { map: ReturnType<TextureLibrary['get']>; blending: typeof AdditiveBlending } {
    return { map: this.tex.get('sprite'), blending: AdditiveBlending };
  }
}
