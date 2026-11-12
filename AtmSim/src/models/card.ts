import * as THREE from 'three';
import { BRAND, FONT, makeCanvas, roundRectPath } from './materials';
import { rectShape } from './util';

/** ISO ID-1 size (metres). Long edge along local X, short along local Y, front face +Z. */
export const CARD_W = 0.0856;
export const CARD_H = 0.054;
export const CARD_T = 0.0009;

export interface CardAppearance {
  holder: string;
  masked: string;
  color: number;
}

export const DEFAULT_CARD: CardAppearance = { holder: 'ALEX RIVERA', masked: '9990 •••• •••• 1234', color: 0x1d4f7a };

function css(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shade(c: number, f: number): string {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (c & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

export function drawCardFront(canvas: HTMLCanvasElement, a: CardAppearance): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(a.color, 1.35));
  g.addColorStop(0.55, css(a.color));
  g.addColorStop(1, shade(a.color, 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // abstract waves
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(W * 0.35, H);
    ctx.bezierCurveTo(W * 0.55, H * (0.6 - i * 0.06), W * 0.8, H * (0.9 - i * 0.1), W, H * (0.3 - i * 0.04));
    ctx.stroke();
  }
  // bank name
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.font = `800 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('MERIDIAN', 40, 52);
  ctx.font = `600 18px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText('TRAINING BANK', 42, 82);
  // training badge
  ctx.textAlign = 'right';
  ctx.font = `800 20px ${FONT}`;
  ctx.fillStyle = '#ffd34d';
  ctx.fillText('TRAINING CARD', W - 36, 52);
  // chip
  const chipX = 60;
  const chipY = 128;
  const cg = ctx.createLinearGradient(chipX, chipY, chipX + 76, chipY + 58);
  cg.addColorStop(0, '#f2d27a');
  cg.addColorStop(1, '#b08a2e');
  ctx.fillStyle = cg;
  roundRectPath(ctx, chipX, chipY, 76, 58, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,60,20,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(chipX, chipY + 29);
  ctx.lineTo(chipX + 76, chipY + 29);
  ctx.moveTo(chipX + 38, chipY);
  ctx.lineTo(chipX + 38, chipY + 58);
  ctx.moveTo(chipX + 20, chipY + 14);
  ctx.lineTo(chipX + 56, chipY + 14);
  ctx.moveTo(chipX + 20, chipY + 44);
  ctx.lineTo(chipX + 56, chipY + 44);
  ctx.stroke();
  // contactless symbol
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(160, 157, 10 + i * 9, -0.6, 0.6);
    ctx.stroke();
  }
  // number + holder
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 33px 'DejaVu Sans Mono', 'Courier New', monospace`;
  ctx.fillText(a.masked, 52, 238);
  ctx.font = `600 22px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(a.holder.toUpperCase(), 52, 284);
  ctx.textAlign = 'right';
  ctx.font = `500 16px ${FONT}`;
  ctx.fillText('VALID THRU 12/29', W - 36, 284);
  ctx.font = `700 14px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText('FICTIONAL · NOT A PAYMENT CARD', W - 36, 236);
}

function drawCardBack(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#e9ecef';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#16181a';
  ctx.fillRect(0, 34, W, 62);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(40, 124, W * 0.55, 46);
  ctx.strokeStyle = '#9aa';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(40, 130 + i * 7);
    ctx.lineTo(40 + W * 0.55, 130 + i * 7);
    ctx.stroke();
  }
  ctx.fillStyle = '#333';
  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Training card — for the Meridian ATM simulator only.', 40, 214);
  ctx.fillText('Not a payment card. No real account or card data.', 40, 240);
  ctx.fillStyle = BRAND.navyCss;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillText('MERIDIAN TRAINING BANK', 40, 286);
}

export interface CardObject {
  root: THREE.Group;
  setAppearance(a: CardAppearance): void;
  dispose(): void;
}

/** Build the training card. Its origin is the card centre. */
export function buildCard(): CardObject {
  const root = new THREE.Group();
  root.name = 'training-card';
  const shape = rectShape(0, 0, CARD_W, CARD_H, 0.0032);
  const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: CARD_T, bevelEnabled: false, curveSegments: 6 });
  bodyGeo.translate(0, 0, -CARD_T / 2);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 });
  const body = new THREE.Mesh(bodyGeo, edgeMat);
  root.add(body);

  const faceGeo = new THREE.ShapeGeometry(shape, 6);
  // remap UVs (shape coords in metres) to 0..1
  const uv = faceGeo.attributes.uv as THREE.BufferAttribute;
  const p = faceGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / CARD_W + 0.5, p.getY(i) / CARD_H + 0.5);

  const frontCanvas = makeCanvas(512, 323).canvas;
  drawCardFront(frontCanvas, DEFAULT_CARD);
  const frontTex = new THREE.CanvasTexture(frontCanvas);
  frontTex.colorSpace = THREE.SRGBColorSpace;
  frontTex.anisotropy = 8;
  const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.3, metalness: 0.1 });
  const front = new THREE.Mesh(faceGeo, frontMat);
  front.position.z = CARD_T / 2 + 0.00005;
  root.add(front);

  const backCanvas = makeCanvas(512, 323).canvas;
  drawCardBack(backCanvas);
  const backTex = new THREE.CanvasTexture(backCanvas);
  backTex.colorSpace = THREE.SRGBColorSpace;
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.45 });
  const back = new THREE.Mesh(faceGeo, backMat);
  back.rotation.y = Math.PI;
  back.position.z = -CARD_T / 2 - 0.00005;
  root.add(back);

  root.traverse((o) => {
    o.userData.prop = 'card';
    o.userData.dynamic = true;
  });

  return {
    root,
    setAppearance(a) {
      drawCardFront(frontCanvas, a);
      frontTex.needsUpdate = true;
    },
    dispose() {
      bodyGeo.dispose();
      faceGeo.dispose();
      edgeMat.dispose();
      frontMat.dispose();
      backMat.dispose();
      frontTex.dispose();
      backTex.dispose();
    },
  };
}
