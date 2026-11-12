import * as THREE from 'three';
import { OBSTACLE_CATALOG } from '../../../sim/world/furnitureCatalog';
import type { ObstacleItem } from '../../../sim/world/types';
import type { ModelBuilder } from '../geometry';

const TOY_COLORS = ['#e05a47', '#f2b134', '#3a86c8', '#4caf6a', '#9c5bd1'];
const SOCK_COLORS = ['#4a6fa5', '#d9d4ca', '#3a3a3a', '#b34a4a'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Display color of an obstacle (toys / socks vary by id; others use the catalog color). */
export function obstacleColor(o: ObstacleItem): string {
  if (o.kind === 'toy') return TOY_COLORS[hash(o.id) % TOY_COLORS.length];
  if (o.kind === 'sock') return SOCK_COLORS[hash(o.id) % SOCK_COLORS.length];
  return OBSTACLE_CATALOG[o.kind].color;
}

/** Build an obstacle in its local frame (x across w, z across d, y up). Footprint = w x d. */
export function buildObstacle(o: ObstacleItem, color: string, b: ModelBuilder): void {
  const { w, d, h } = o;
  b.small = true;
  switch (o.kind) {
    case 'box': {
      b.rbox(`cardboard|${color}`, w, h, d, 0.006, 0, h / 2, 0);
      b.box('paint|#d9c9a6', 0.05, 0.002, d + 0.002, 0, h + 0.0005, 0);
      for (const s of [-1, 1]) b.box('paint|#d9c9a6', 0.05, 0.08, 0.002, 0, h - 0.04, s * (d / 2 + 0.0005));
      break;
    }
    case 'cylinder': {
      const r = Math.min(w, d) / 2;
      b.cyl(`metal|${color}`, r - 0.005, r - 0.02, h - 0.04, 0, (h - 0.04) / 2, 0, { seg: 28 });
      b.cyl('black', r, r - 0.004, 0.04, 0, h - 0.02, 0, { seg: 28 });
      b.torus('black', r - 0.004, 0.006, 0, h - 0.04, 0, { rx: Math.PI / 2, seg: 28 });
      b.box('black', 0.08, 0.015, 0.04, 0, 0.012, r - 0.03);
      break;
    }
    case 'shoe': {
      // Sneaker, length along x (toe at +x).
      b.rbox('paint|#f4f4f2', w, 0.028, d, 0.012, 0, 0.014, 0);
      b.sphere(`fabric|${color === '#e8e8e8' ? '#5b6b7c' : color}`, 1, -w * 0.05, 0.028, 0, { sx: w * 0.46, sy: h - 0.028, sz: d * 0.46, seg: 16 });
      b.box('paint|#f4f4f2', w * 0.28, 0.006, d * 0.3, w * 0.08, h - 0.012, 0, { rz: -0.35 });
      break;
    }
    case 'toy': {
      b.rbox(`plastic|${color}`, w, h * 0.82, d, 0.012, 0, (h * 0.82) / 2, 0);
      const sr = Math.min(w, d) * 0.12;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(`plastic|${color}`, sr, sr, h * 0.18, (sx * w) / 4, h * 0.91, (sz * d) / 4, { seg: 14 });
      break;
    }
    case 'cable': {
      const r = Math.min(h / 2, 0.012);
      for (let k = 0; k < 2; k++) {
        const pts: THREE.Vector3[] = [];
        const N = 9;
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          const x = -w / 2 + r + t * (w - 2 * r - 0.04);
          const z = Math.sin(t * Math.PI * (2 + k) + k * 1.3) * (d / 2 - r - 0.002);
          pts.push(new THREE.Vector3(x, r + k * r * 0.4, z));
        }
        b.tube('rubber', pts, r * (k ? 0.8 : 1));
      }
      b.rbox('black', 0.04, Math.min(h, 0.025), Math.min(d, 0.035), 0.004, w / 2 - 0.02, Math.min(h, 0.025) / 2, 0);
      break;
    }
    case 'sock': {
      const fab = `fabric|${color}`;
      b.rbox(fab, w * 0.62, h * 0.9, d * 0.9, h * 0.44, -w * 0.19, h * 0.45, 0);
      b.rbox(fab, w * 0.45, h * 0.9, d * 0.8, h * 0.44, w * 0.27, h * 0.45, -d * 0.04, { ry: 0.25 });
      b.box('paint|#f2f0ea', 0.03, h * 0.92, d * 0.86, -w / 2 + 0.025, h * 0.46, 0);
      break;
    }
    case 'petBowl': {
      const R = Math.min(w, d) / 2;
      b.lathe(
        `plastic|${color}`,
        [
          [0, 0],
          [R * 0.92, 0],
          [R, 0.008],
          [R * 0.94, h],
          [R * 0.84, h],
          [R * 0.72, 0.016],
          [0, 0.016],
        ],
        0,
        0,
        0,
        { seg: 28 },
      );
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const rr = R * 0.45 * Math.sqrt(i / 9);
        b.sphere('kibble', 0.012, Math.cos(a) * rr, 0.026 + (i % 3) * 0.004, Math.sin(a) * rr, { seg: 6 });
      }
      break;
    }
  }
}
