export type ModelQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Tessellation and detail budget for the procedural models. */
export interface QualitySettings {
  readonly level: ModelQuality;
  /** Radial segments for large round parts (chassis, lathe shells). */
  readonly radial: number;
  /** Radial segments for small cylinders (screws, lenses, capacitors). */
  readonly radialSmall: number;
  /** Curve segments for extruded shapes. */
  readonly curve: number;
  /** Bevel segments for extruded shapes. */
  readonly bevel: number;
  /** Segments per fillet in lathe profiles. */
  readonly fillet: number;
  /** Bristles per side-brush arm. */
  readonly sideBristles: number;
  /** Tufts per helix row on the bristle roller. */
  readonly rollerTufts: number;
  /** Tread lugs per drive tyre. */
  readonly treadLugs: number;
  /** Individually addressable LEDs in the status ring. */
  readonly ledCount: number;
  /** Multiplier for particle pool sizes. */
  readonly particles: number;
  /** Edge size of procedural textures (px). */
  readonly texSize: number;
  /** Extra micro detail (screws, small SMD parts, cable ties...). */
  readonly detail: boolean;
}

const TABLE: Record<ModelQuality, QualitySettings> = {
  low: {
    level: 'low', radial: 40, radialSmall: 10, curve: 8, bevel: 1, fillet: 2,
    sideBristles: 7, rollerTufts: 18, treadLugs: 18, ledCount: 36, particles: 0.35, texSize: 128, detail: false,
  },
  medium: {
    level: 'medium', radial: 64, radialSmall: 14, curve: 12, bevel: 2, fillet: 3,
    sideBristles: 12, rollerTufts: 30, treadLugs: 24, ledCount: 48, particles: 0.6, texSize: 256, detail: true,
  },
  high: {
    level: 'high', radial: 96, radialSmall: 18, curve: 18, bevel: 3, fillet: 4,
    sideBristles: 18, rollerTufts: 44, treadLugs: 30, ledCount: 64, particles: 1, texSize: 512, detail: true,
  },
  ultra: {
    level: 'ultra', radial: 144, radialSmall: 28, curve: 28, bevel: 4, fillet: 6,
    sideBristles: 28, rollerTufts: 64, treadLugs: 36, ledCount: 96, particles: 1.5, texSize: 1024, detail: true,
  },
};

export function resolveQuality(level: ModelQuality | undefined): QualitySettings {
  return TABLE[level ?? 'high'];
}
