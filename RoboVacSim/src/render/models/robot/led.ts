import { Color, Group, InstancedMesh, Matrix4, type MeshStandardMaterial } from 'three';
import type { LedMode } from '../types';
import type { BuildContext } from '../shared/context';
import { arcBand, lathe } from '../shared/geometry';
import { PHI_FWD, Y } from './layout';

const C_WHITE = new Color(1, 1, 1);
const C_CYAN = new Color(0.08, 0.82, 1);
const C_TEAL = new Color(0.04, 0.95, 0.72);
const C_BLUE = new Color(0.12, 0.32, 1);
const C_AMBER = new Color(1, 0.52, 0.06);
const C_PURPLE = new Color(0.62, 0.18, 1);
const C_ORANGE = new Color(1, 0.36, 0.03);
const C_RED = new Color(1, 0.04, 0.04);

function frac(v: number): number {
  return v - Math.floor(v);
}

/** Addressable LED status ring (instanced segments under a frosted diffuser). */
export class LedRing {
  readonly root: Group;
  private readonly leds: InstancedMesh;
  private readonly diffuser: MeshStandardMaterial;
  private readonly count: number;
  private readonly tmp = new Color();
  private readonly sum = new Color();

  constructor(ctx: BuildContext) {
    const { q, mats } = ctx;
    this.root = new Group();
    this.root.name = 'ledRing';
    this.count = q.ledCount;
    const seg = (Math.PI * 2) / this.count;

    const floor = ctx.builder();
    floor.add(lathe([[0.1567, Y.ledFloor], [0.1487, Y.ledFloor]], q.radial, 1), mats.blackMatte);
    floor.build(this.root, { name: 'led-channel' });

    const segGeo = ctx.track.track(arcBand(0.1497, 0.156, Y.ledFloor + 0.0001, Y.ledFloor + 0.0014, -seg * 0.47, seg * 0.94, 3));
    this.leds = new InstancedMesh(segGeo, mats.led, this.count);
    this.leds.name = 'led-segments';
    const m = new Matrix4();
    for (let i = 0; i < this.count; i++) {
      m.makeRotationY(PHI_FWD - (i / this.count) * Math.PI * 2);
      this.leds.setMatrixAt(i, m);
      this.leds.setColorAt(i, C_WHITE);
    }
    this.root.add(this.leds);

    this.diffuser = mats.diffuser;
    const dif = ctx.builder();
    dif.add(lathe([[0.1566, Y.ledFloor + 0.0016], [0.1566, Y.ledFloor + 0.0024, 0], [0.1489, Y.ledFloor + 0.0024, 0], [0.1489, Y.ledFloor + 0.0016]], q.radial, 1), this.diffuser);
    dif.build(this.root, { name: 'led-diffuser', renderOrder: 3 });
  }

  get diffuserMaterial(): MeshStandardMaterial {
    return this.diffuser;
  }

  /** Writes per-LED colours for the mode; allocation-free. */
  update(mode: LedMode, battery: number, t: number): void {
    const n = this.count;
    const c = this.tmp;
    this.sum.setRGB(0, 0, 0);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      switch (mode) {
        case 'off':
          c.setRGB(0, 0, 0);
          break;
        case 'idle':
          c.copy(C_WHITE).multiplyScalar(0.2 + 0.32 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.5)));
          break;
        case 'mapping': {
          const d = frac(t / 1.3 - u);
          c.copy(C_CYAN).multiplyScalar(Math.max(0.06, Math.pow(1 - d, 7)));
          break;
        }
        case 'cleaning':
          c.copy(C_TEAL).multiplyScalar(0.82);
          break;
        case 'returning':
          c.copy(C_BLUE).multiplyScalar(frac(u * 4 - t * 1.1) < 0.32 ? 1 : 0.08);
          break;
        case 'charging': {
          const fromRear = Math.abs(u - 0.5) * 2;
          const lvl = 1 - Math.min(Math.max(battery, 0), 1);
          const edge = Math.abs(fromRear - lvl) < 1.5 / n;
          const lit = fromRear >= lvl;
          const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4));
          c.copy(C_AMBER).multiplyScalar(edge ? pulse : lit ? 0.72 : 0.035);
          break;
        }
        case 'maintenance':
          c.copy(C_PURPLE).multiplyScalar(0.45 + 0.35 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 2.4)));
          break;
        case 'manual':
          c.copy(C_WHITE).multiplyScalar(0.72);
          break;
        case 'paused':
          c.copy(C_AMBER).multiplyScalar(0.2);
          break;
        case 'recovering':
          c.copy(C_ORANGE).multiplyScalar(frac(t * 2) < 0.5 ? 0.95 : 0.06);
          break;
        case 'error':
          c.copy(C_RED).multiplyScalar(frac(t * 1.5) < 0.5 ? 1 : 0.05);
          break;
      }
      this.leds.setColorAt(i, c);
      this.sum.r += c.r;
      this.sum.g += c.g;
      this.sum.b += c.b;
    }
    if (this.leds.instanceColor) this.leds.instanceColor.needsUpdate = true;
    this.diffuser.emissive.copy(this.sum).multiplyScalar(0.95 / n);
  }
}
