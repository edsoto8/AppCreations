import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Vector3,
  type ColorRepresentation,
  type Texture,
} from 'three';
import type { Disposables } from './Disposables';

/**
 * Maps a particle's normalized life phase (0..1) and three stable random seeds (0..1) to a position.
 * Must not allocate: write the result into `out`.
 */
export type ParticlePath = (phase: number, a: number, b: number, c: number, out: Vector3) => void;

export interface ParticleStreamOptions {
  count: number;
  color: ColorRepresentation;
  /** World-space point size (m). */
  size: number;
  opacity: number;
  /** Full traversals of the path per second. */
  speed: number;
  /** Relative per-particle speed variation (0..1). */
  speedJitter?: number;
  sprite: Texture;
  /** Response time (s) for fading in/out when the intensity changes. */
  fade?: number;
}

/**
 * Fixed-size additive particle stream. All buffers are preallocated; update() only rewrites them.
 * Brightness follows sin(pi * phase) so particles fade in at the start and out at the end of a path.
 */
export class ParticleStream {
  readonly points: Points;
  private readonly material: PointsMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly phase: Float32Array;
  private readonly speedMul: Float32Array;
  private readonly seeds: Float32Array;
  private readonly tmp = new Vector3();
  private readonly baseColor: Color;
  private level = 0;

  constructor(
    private readonly opts: ParticleStreamOptions,
    private readonly path: ParticlePath,
    track: Disposables,
  ) {
    const n = Math.max(1, Math.round(opts.count));
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.phase = new Float32Array(n);
    this.speedMul = new Float32Array(n);
    this.seeds = new Float32Array(n * 3);
    const jitter = opts.speedJitter ?? 0.3;
    for (let i = 0; i < n; i++) {
      this.phase[i] = Math.random();
      this.speedMul[i] = 1 - jitter / 2 + Math.random() * jitter;
      this.seeds[i * 3] = Math.random();
      this.seeds[i * 3 + 1] = Math.random();
      this.seeds[i * 3 + 2] = Math.random();
    }
    const geo = track.track(new BufferGeometry());
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.baseColor = new Color(opts.color);
    this.material = track.track(
      new PointsMaterial({
        size: opts.size,
        map: opts.sprite,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 5;
  }

  /** Advances the stream. `intensity` 0..1 (0 fades the stream out and eventually hides it). */
  update(dt: number, intensity: number): void {
    const target = Math.min(Math.max(intensity, 0), 1);
    const k = Math.min(1, dt / (this.opts.fade ?? 0.35));
    this.level += (target - this.level) * k;
    if (this.level < 0.004 && target === 0) {
      this.level = 0;
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    this.material.opacity = this.opts.opacity * this.level;
    const n = this.phase.length;
    const step = dt * this.opts.speed;
    const c = this.baseColor;
    for (let i = 0; i < n; i++) {
      let ph = this.phase[i] + step * this.speedMul[i];
      if (ph >= 1) {
        ph -= Math.floor(ph);
        const s = i * 3;
        this.seeds[s] = Math.random();
        this.seeds[s + 1] = Math.random();
        this.seeds[s + 2] = Math.random();
      }
      this.phase[i] = ph;
      const s = i * 3;
      this.path(ph, this.seeds[s], this.seeds[s + 1], this.seeds[s + 2], this.tmp);
      this.positions[s] = this.tmp.x;
      this.positions[s + 1] = this.tmp.y;
      this.positions[s + 2] = this.tmp.z;
      const f = Math.sin(Math.PI * ph);
      this.colors[s] = c.r * f;
      this.colors[s + 1] = c.g * f;
      this.colors[s + 2] = c.b * f;
    }
    const geo = this.points.geometry;
    (geo.attributes.position as BufferAttribute).needsUpdate = true;
    (geo.attributes.color as BufferAttribute).needsUpdate = true;
  }
}
