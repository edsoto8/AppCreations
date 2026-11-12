import * as THREE from 'three';
import type { Denomination } from '../core/types';
import { FONT, makeCanvas, mulberry32 } from './materials';

/**
 * Fictional TRAINING banknotes. Colours deliberately unlike real currency; abstract geometric motif,
 * no portraits, no real security features. One shared geometry, one material per denomination.
 */

/** Note size in metres (long edge along local X, short edge along local Y, face normal +Z). */
export const NOTE_W = 0.156;
export const NOTE_H = 0.066;
/** Visual spacing between notes in a bundle/stack (exaggerated paper thickness so bundles read). */
export const NOTE_GAP = 0.0011;

export const NOTE_STYLE: Record<Denomination, { base: string; dark: string; light: string; hex: number; name: string }> = {
  10: { base: '#d8c08c', dark: '#7d6532', light: '#f3e7c6', hex: 0xd8c08c, name: 'sand' },
  20: { base: '#3aa6a0', dark: '#145a57', light: '#bfe9e5', hex: 0x3aa6a0, name: 'teal' },
  50: { base: '#8c6fc9', dark: '#43307a', light: '#ddd2f4', hex: 0x8c6fc9, name: 'violet' },
  100: { base: '#e2735f', dark: '#86331f', light: '#f8d3c9', hex: 0xe2735f, name: 'coral' },
};

function drawNote(d: Denomination, back: boolean): HTMLCanvasElement {
  const W = 512;
  const H = 216;
  const { canvas, ctx } = makeCanvas(W, H);
  const s = NOTE_STYLE[d];
  const rnd = mulberry32(d * 7 + (back ? 3 : 0));
  // paper
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, s.light);
  g.addColorStop(0.45, s.base);
  g.addColorStop(1, s.light);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // abstract geometric motif: nested hexagons + a triangle lattice band
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = s.dark;
  ctx.lineWidth = 1.2;
  const cx = back ? W * 0.3 : W * 0.68;
  const cy = H * 0.5;
  for (let k = 1; k <= 9; k++) {
    const r = k * 9;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 + k * 0.12;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.18;
  for (let x = -20; x < W + 20; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, H * 0.78);
    ctx.lineTo(x + 9, H * 0.9);
    ctx.lineTo(x + 18, H * 0.78);
    ctx.stroke();
  }
  ctx.restore();
  // dotted texture
  ctx.fillStyle = s.dark;
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 260; i++) ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  ctx.globalAlpha = 1;
  // border
  ctx.strokeStyle = s.dark;
  ctx.lineWidth = 6;
  ctx.strokeRect(7, 7, W - 14, H - 14);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  // texts
  ctx.fillStyle = s.dark;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 96px ${FONT}`;
  ctx.fillText(String(d), back ? W * 0.58 : 30, H * 0.47);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('MERIDIAN TRAINING BANK', back ? W * 0.58 : 30, H * 0.17);
  ctx.textAlign = 'center';
  ctx.font = `800 19px ${FONT}`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText('TRAINING NOTE — NOT LEGAL TENDER', W / 2, H * 0.86);
  ctx.textAlign = 'right';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillStyle = s.dark;
  ctx.fillText(`TRN-${d}`, W - 28, H * 0.17);
  // small corner numerals
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText(String(d), W - 28, H * 0.68);
  return canvas;
}

interface NoteResources {
  geometry: THREE.PlaneGeometry;
  materials: Map<Denomination, THREE.MeshStandardMaterial>;
  textures: THREE.Texture[];
}

let shared: NoteResources | null = null;

function resources(): NoteResources {
  if (shared) return shared;
  const geometry = new THREE.PlaneGeometry(NOTE_W, NOTE_H);
  const materials = new Map<Denomination, THREE.MeshStandardMaterial>();
  const textures: THREE.Texture[] = [];
  for (const d of [10, 20, 50, 100] as Denomination[]) {
    const tex = new THREE.CanvasTexture(drawNote(d, false));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    textures.push(tex);
    materials.set(d, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  }
  shared = { geometry, materials, textures };
  return shared;
}

export function noteGeometry(): THREE.PlaneGeometry {
  return resources().geometry;
}

export function noteMaterial(d: Denomination): THREE.MeshStandardMaterial {
  return resources().materials.get(d)!;
}

/** Pool of note meshes so the animator never allocates per note. */
export class NotePool {
  private free: THREE.Mesh[] = [];

  acquire(d: Denomination): THREE.Mesh {
    const m = this.free.pop() ?? new THREE.Mesh(noteGeometry(), noteMaterial(d));
    m.material = noteMaterial(d);
    m.visible = true;
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
    m.userData = { note: true, denom: d };
    m.castShadow = false;
    return m;
  }

  release(m: THREE.Mesh): void {
    m.removeFromParent();
    m.visible = false;
    this.free.push(m);
  }
}

export function disposeNoteResources(): void {
  if (!shared) return;
  shared.geometry.dispose();
  for (const m of shared.materials.values()) m.dispose();
  for (const t of shared.textures) t.dispose();
  shared = null;
}
