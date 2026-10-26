/**
 * Fox eyes: glossy amber eyeballs with vertical slit pupils (procedural canvas texture), lids
 * that blink, and a catch-light that stays put while the eyeball rotates.
 */
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import type { EyePlacement } from './anatomy';

const LID_OPEN_UPPER = -0.72;
const LID_OPEN_LOWER = 0.62;

export class Eye {
  readonly group = new Group();
  private readonly ball: Mesh;
  private readonly upperLid: Mesh;
  private readonly lowerLid: Mesh;
  private readonly lidPivot = new Group();

  constructor(
    placement: EyePlacement,
    side: 'L' | 'R',
    shared: EyeResources,
  ) {
    const r = placement.radius;
    // Orient the group so +Z is the gaze, +Y roughly up.
    const gaze = new Vector3(...placement.gaze);
    const m = new Matrix4().lookAt(gaze, new Vector3(), new Vector3(0, 1, 0));
    this.group.quaternion.setFromRotationMatrix(m);
    this.group.name = `eye_${side}`;

    this.ball = new Mesh(shared.ballGeometry, shared.ballMaterial);
    this.ball.scale.setScalar(r);
    this.group.add(this.ball);

    // Fixed catch-light up and toward the key light.
    const glint = new Mesh(shared.glintGeometry, shared.glintMaterial);
    glint.position.set(0.24, 0.42, 0.87).normalize().multiplyScalar(r * 1.01);
    glint.scale.set(r * 0.13, r * 0.1, r * 0.04);
    this.group.add(glint);

    // Lids: caps slightly larger than the eyeball, tilted for an almond shape (outer corner up).
    this.lidPivot.rotation.z = (side === 'L' ? 1 : -1) * 0.26;
    this.group.add(this.lidPivot);
    this.upperLid = new Mesh(shared.upperLidGeometry, shared.lidMaterial);
    this.lowerLid = new Mesh(shared.lowerLidGeometry, shared.lidMaterial);
    this.upperLid.scale.setScalar(r * 1.045);
    this.lowerLid.scale.setScalar(r * 1.04);
    this.lidPivot.add(this.upperLid, this.lowerLid);
    this.setBlink(0);
  }

  attachTo(parent: Object3D, center: Vector3): void {
    this.group.position.copy(center);
    parent.add(this.group);
  }

  /** 0 = open, 1 = closed. */
  setBlink(amount: number): void {
    const t = MathUtils.clamp(amount, 0, 1);
    this.upperLid.rotation.x = MathUtils.lerp(LID_OPEN_UPPER, 0.32, t);
    this.lowerLid.rotation.x = MathUtils.lerp(LID_OPEN_LOWER, 0.45, t);
  }

  /** Eyeball rotation relative to rest gaze, radians. */
  setLook(yaw: number, pitch: number): void {
    this.ball.rotation.set(-pitch, yaw, 0, 'YXZ');
  }
}

export class EyeResources {
  readonly ballGeometry: BufferGeometry;
  readonly upperLidGeometry: BufferGeometry;
  readonly lowerLidGeometry: BufferGeometry;
  readonly glintGeometry: BufferGeometry;
  readonly ballMaterial: MeshPhysicalMaterial;
  readonly lidMaterial: Material;
  readonly glintMaterial: Material;
  private readonly irisTexture: Texture;

  constructor() {
    // Pole of the sphere points along +Z so the iris maps around it.
    this.ballGeometry = new SphereGeometry(1, 48, 32).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2));
    this.upperLidGeometry = lidGeometry(0, 1.92, true);
    this.lowerLidGeometry = lidGeometry(Math.PI - 1.55, 1.55, false);
    this.glintGeometry = new SphereGeometry(1, 12, 8);
    this.irisTexture = createIrisTexture();
    this.ballMaterial = new MeshPhysicalMaterial({
      map: this.irisTexture,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      ior: 1.38,
      specularIntensity: 0.8,
    });
    this.lidMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    this.glintMaterial = new MeshBasicMaterial({ color: new Color(1.6, 1.6, 1.55), transparent: true, opacity: 0.9, toneMapped: false });
  }

  dispose(): void {
    this.ballGeometry.dispose();
    this.upperLidGeometry.dispose();
    this.lowerLidGeometry.dispose();
    this.glintGeometry.dispose();
    this.irisTexture.dispose();
    this.ballMaterial.dispose();
    this.lidMaterial.dispose();
    this.glintMaterial.dispose();
  }
}

/** Spherical cap whose colour runs from coat colour to a black lid margin at its free edge. */
function lidGeometry(thetaStart: number, thetaLength: number, upper: boolean): BufferGeometry {
  const g = new SphereGeometry(1, 40, 14, 0, Math.PI * 2, thetaStart, thetaLength);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  // Fox lids are dark-rimmed; a hint of coat colour away from the margin.
  const fur = new Color(upper ? 0x5a2a12 : 0x3a2418).convertSRGBToLinear();
  const margin = new Color(0x0b0807).convertSRGBToLinear();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Polar angle from the cap's own pole.
    const theta = Math.acos(MathUtils.clamp(upper ? v.y : -v.y, -1, 1));
    const edge = upper ? thetaStart + thetaLength : Math.PI - thetaStart;
    const t = MathUtils.smoothstep(theta, edge - 0.9, edge - 0.3);
    const c = fur.clone().lerp(margin, t);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/**
 * Iris texture laid out for a sphere whose pole is the pupil: u = angle around the gaze axis,
 * v = angle from the pupil. Each texel is mapped back to the flat iris disc and shaded there.
 */
function createIrisTexture(): CanvasTexture {
  const W = 512, H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const amberInner = new Color(0xf2b432);
  const amberOuter = new Color(0xb8641a);
  const limbus = new Color(0x2a1608);
  const sclera = new Color(0x3a2a1c);
  const pupil = new Color(0x050302);
  const out = new Color();
  for (let y = 0; y < H; y++) {
    // Row 0 is the pole (pupil): SphereGeometry uv.y = 1 at the pole and flipY maps row 0 there.
    const theta = (y / (H - 1)) * Math.PI;
    for (let x = 0; x < W; x++) {
      const phi = (x / (W - 1)) * Math.PI * 2;
      // Disc coordinates in the eye's local frame (see Eye: +Y up, +X lateral).
      const dx = -Math.cos(phi) * theta;
      const dy = -Math.sin(phi) * theta;
      const rr = Math.hypot(dx, dy);
      const irisR = 0.98;
      // Vertical slit pupil.
      const slit = (dx / 0.17) ** 2 + (dy / 0.62) ** 2;
      const streak = 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 37 + Math.sin(Math.atan2(dy, dx) * 9) * 2);
      if (slit < 1) {
        out.copy(pupil);
      } else if (rr < irisR) {
        const t = rr / irisR;
        out.copy(amberInner).lerp(amberOuter, Math.pow(t, 1.6));
        out.multiplyScalar(0.85 + 0.3 * streak * (0.4 + 0.6 * t));
        // Darker ring right around the pupil.
        const nearPupil = MathUtils.smoothstep(slit, 1.8, 1.0);
        out.lerp(pupil, nearPupil * 0.35);
        // Limbal ring.
        out.lerp(limbus, MathUtils.smoothstep(t, 0.8, 1.0));
      } else {
        out.copy(sclera).lerp(limbus, MathUtils.smoothstep(rr, irisR + 0.2, irisR));
      }
      const o = (y * W + x) * 4;
      img.data[o] = Math.round(MathUtils.clamp(out.r, 0, 1) * 255);
      img.data[o + 1] = Math.round(MathUtils.clamp(out.g, 0, 1) * 255);
      img.data[o + 2] = Math.round(MathUtils.clamp(out.b, 0, 1) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

