import * as THREE from 'three';
import { seeded, shade, type FurnitureCtx } from './common';

/** Potted plant: pot base = disc of diameter min(w,d)*legSize (catalog ring), leaf clusters above. */
export function plant(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const m = Math.min(w, d);
  const r0 = (m * c.spec.legSize) / 2;
  const rTop = Math.min(r0 * 1.12, m / 2 - 0.005);
  const potH = Math.min(0.42, h * 0.32);
  b.lathe(
    'paint|#cfc6b8',
    [
      [0, 0],
      [r0, 0],
      [rTop * 0.98, potH - 0.02],
      [rTop, potH],
      [rTop - 0.015, potH],
      [rTop - 0.02, potH - 0.03],
      [0, potH - 0.03],
    ],
    0,
    0,
    0,
    { seg: 28 },
  );
  b.cyl('soil', rTop - 0.02, rTop - 0.02, 0.01, 0, potH - 0.025, 0, { seg: 20 });
  const leaf = `leaf|${c.color}`;
  const stem = `leaf|${shade(c.color, 0.6)}`;
  const r = seeded(w, d, h, 3);
  const n = c.details ? 26 : 14;
  const maxR = Math.min(w, d) / 2;
  const tall = h >= 1.0;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const a = i * golden + r() * 0.4;
    const leafL = (tall ? 0.2 : 0.17) * (0.75 + r() * 0.4);
    const leafW = leafL * (tall ? 0.55 : 0.42);
    const top = h - leafL * 0.35;
    const y = tall ? potH + 0.1 + (top - potH - 0.1) * (0.15 + 0.85 * Math.sqrt(f)) : potH + 0.05 + (top - potH - 0.05) * (0.3 + 0.7 * r());
    const droop = tall ? 0.15 + (1 - f) * 0.55 : 0.3 + r() * 0.6;
    const reach = Math.max(0.02, maxR - (leafL / 2) * Math.cos(droop) - 0.01);
    const rr = reach * (tall ? 0.25 + 0.75 * (1 - f * 0.6) * (0.6 + 0.4 * r()) : 0.5 + 0.5 * r());
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const centre = new THREE.Vector3(dir.x * rr, y, dir.z * rr);
    b.sphere(leaf, 1, centre.x, centre.y, centre.z, { sx: leafW / 2, sy: 0.008, sz: leafL / 2, ry: Math.PI / 2 - a, rx: droop, seg: 12 });
    // Stem from the soil to the leaf base.
    const base = centre.clone().addScaledVector(dir, (-leafL / 2) * Math.cos(droop)).setY(y + (leafL / 2) * Math.sin(droop));
    b.segment(stem, new THREE.Vector3(dir.x * 0.02, potH - 0.02, dir.z * 0.02), base, 0.007, 0.004, 5);
  }
}

/** Floor lamp: weighted round base (catalog ring), slim pole, glowing fabric shade. */
export function floorLamp(c: FurnitureCtx): void {
  const { b, w, d, h } = c;
  const m = Math.min(w, d);
  const baseR = (m * c.spec.legSize) / 2;
  b.cyl('black', baseR * 0.94, baseR, 0.025, 0, 0.0125, 0, { seg: 28 });
  b.cyl('black', 0.012, 0.012, h - 0.3, 0, (h - 0.3) / 2 + 0.02, 0, { seg: 10 });
  const shadeBot = Math.min(m / 2 - 0.005, 0.18);
  b.cyl('shade', shadeBot * 0.68, shadeBot, 0.3, 0, h - 0.15, 0, { open: true, seg: 28 });
  b.sphere('bulb', 0.04, 0, h - 0.2, 0, { seg: 12 });
  b.torus('black', shadeBot * 0.68, 0.004, 0, h, 0, { rx: Math.PI / 2, seg: 24 });
}
