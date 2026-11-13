import * as THREE from 'three';
import type { CartridgeLabel } from '../games/GameInterface';
import {
  BUTTON_A,
  BUTTON_B,
  HALF_H,
  HALF_W,
  LCD_WINDOW,
  LED,
  LENS,
  PILL,
  SELECT,
  START,
} from './Layout';

/** Pixels per millimetre for printed graphics. */
const PX = 12;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const PRINT_NAVY = '#27306a';
const PRINT_BURGUNDY = '#7d1640';

function canvas(wmm: number, hmm: number, scale = PX): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.round(wmm * scale);
  c.height = Math.round(hmm * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  return { c, ctx };
}

function texture(c: HTMLCanvasElement, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Converts body coordinates (mm, y up, origin centre) to front-print canvas coordinates. */
const fx = (x: number): number => x + HALF_W;
const fy = (y: number): number => HALF_H - y;

/** Graphics printed on the front shell: switch legend, brand, button letters, Select/Start. */
export function makeFrontPrintTexture(anisotropy: number): THREE.CanvasTexture {
  const { c, ctx } = canvas(HALF_W * 2, HALF_H * 2);
  ctx.textBaseline = 'middle';

  // Moulded top line with rounded ends, printed as a thin shadow + highlight pair.
  const lineY = fy(67.5);
  ctx.lineWidth = 0.35;
  ctx.strokeStyle = 'rgba(70,66,60,0.55)';
  ctx.beginPath();
  ctx.moveTo(fx(-41.5), fy(71.5));
  ctx.quadraticCurveTo(fx(-41.5), lineY, fx(-37.5), lineY);
  ctx.lineTo(fx(37.5), lineY);
  ctx.quadraticCurveTo(fx(41.5), lineY, fx(41.5), fy(71.5));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.moveTo(fx(-37.5), lineY + 0.4);
  ctx.lineTo(fx(37.5), lineY + 0.4);
  ctx.stroke();

  // Power legend.
  ctx.fillStyle = 'rgba(60,58,66,0.85)';
  ctx.font = `bold 2.1px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('◄ OFF • ON ►', fx(-37), fy(70.6));

  // Brand under the lens (original wordmark).
  ctx.save();
  ctx.translate(fx(-37.5), fy(-0.8));
  ctx.transform(1, 0, -0.22, 1, 0, 0);
  ctx.fillStyle = PRINT_NAVY;
  ctx.font = `bold 5.2px ${SANS}`;
  ctx.fillText('POCKET', 0, 0);
  const w = ctx.measureText('POCKET ').width;
  ctx.font = `900 6.4px ${SANS}`;
  ctx.fillText('PIXEL', w, -0.4);
  const w2 = ctx.measureText('PIXEL').width;
  ctx.font = `bold 1.6px ${SANS}`;
  ctx.fillText('MODEL PP-89', w + w2 + 1.5, 1.6);
  ctx.restore();

  // Button letters.
  ctx.fillStyle = PRINT_BURGUNDY;
  ctx.font = `bold italic 3.4px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('B', fx(BUTTON_B.x + 0.6), fy(BUTTON_B.y - BUTTON_B.radius - 3.4));
  ctx.fillText('A', fx(BUTTON_A.x + 0.6), fy(BUTTON_A.y - BUTTON_A.radius - 3.4));

  // Select / Start legends, tilted with the pills.
  ctx.fillStyle = PRINT_NAVY;
  ctx.font = `bold 2.2px ${SANS}`;
  for (const [label, pos] of [
    ['SELECT', SELECT],
    ['START', START],
  ] as const) {
    ctx.save();
    ctx.translate(fx(pos.x + 1.8), fy(pos.y - 4.6));
    ctx.rotate(-PILL.angle);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  // Speaker legend.
  ctx.save();
  ctx.translate(fx(14.5), fy(-68.5));
  ctx.rotate(-0.52);
  ctx.font = `bold 1.7px ${SANS}`;
  ctx.fillStyle = 'rgba(60,58,66,0.75)';
  ctx.fillText('♪ STEREO', 0, 0);
  ctx.restore();

  return texture(c, anisotropy);
}

/** Print on the dark lens: stripes, display caption and the LED legend. Lens-local mm coordinates. */
export function makeLensTexture(anisotropy: number): THREE.CanvasTexture {
  const w = LENS.width;
  const h = LENS.height;
  const { c, ctx } = canvas(w, h, 14);
  const lx = (x: number): number => x - LENS.cx + w / 2;
  const ly = (y: number): number => LENS.cy + h / 2 - y;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#4c4f5c');
  grad.addColorStop(1, '#3f424e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Stripes + caption across the top margin.
  const top = LCD_WINDOW.cy + LCD_WINDOW.height / 2;
  const stripeY = ly(top + 4.2);
  ctx.font = `italic bold 2.15px ${SANS}`;
  ctx.textBaseline = 'middle';
  const caption = 'DOT MATRIX WITH CHIPTUNE SOUND';
  const capW = ctx.measureText(caption).width;
  const capX = w / 2 - capW / 2 + 1;
  ctx.fillStyle = '#7b2e5a';
  ctx.fillRect(3, stripeY - 1.05, capX - 4.5, 0.55);
  ctx.fillRect(capX + capW + 1.5, stripeY - 1.05, w - capX - capW - 4.5, 0.55);
  ctx.fillStyle = '#2f3f8a';
  ctx.fillRect(3, stripeY + 0.5, capX - 4.5, 0.55);
  ctx.fillRect(capX + capW + 1.5, stripeY + 0.5, w - capX - capW - 4.5, 0.55);
  ctx.fillStyle = '#d9dbe2';
  ctx.fillText(caption, capX, stripeY);

  // LCD window frame (thin bright border like a printed mask edge).
  const x0 = lx(LCD_WINDOW.cx - LCD_WINDOW.width / 2);
  const y0 = ly(LCD_WINDOW.cy + LCD_WINDOW.height / 2);
  ctx.strokeStyle = 'rgba(20,22,28,0.9)';
  ctx.lineWidth = 0.9;
  ctx.strokeRect(x0 - 0.4, y0 - 0.4, LCD_WINDOW.width + 0.8, LCD_WINDOW.height + 0.8);

  // LED legend.
  ctx.fillStyle = '#c9ccd4';
  ctx.font = `bold 1.55px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText('POWER', lx(LED.x), ly(LED.y - 3.4));
  ctx.beginPath();
  ctx.fillStyle = '#1d1e24';
  ctx.arc(lx(LED.x), ly(LED.y), 1.75, 0, Math.PI * 2);
  ctx.fill();
  return texture(c, anisotropy);
}

/** Model sticker on the back. */
export function makeBackStickerTexture(anisotropy: number, wmm: number, hmm: number): THREE.CanvasTexture {
  const { c, ctx } = canvas(wmm, hmm, 16);
  ctx.fillStyle = '#d8d4c8';
  ctx.fillRect(0, 0, wmm, hmm);
  ctx.strokeStyle = '#7d786c';
  ctx.lineWidth = 0.25;
  ctx.strokeRect(0.6, 0.6, wmm - 1.2, hmm - 1.2);
  ctx.fillStyle = '#2b2a2a';
  ctx.textBaseline = 'middle';
  ctx.font = `900 italic 3px ${SANS}`;
  ctx.fillText('POCKET PIXEL', 2, 2.8);
  ctx.font = `bold 1.5px ${SANS}`;
  ctx.fillText('MODEL NO. PP-89   DC 6V  0.7W', 2, 5.6);
  ctx.font = `1.3px ${SANS}`;
  ctx.fillText('ORIGINAL DESIGN  •  4 × AA BATTERIES  •  NOT A TOY FOR UNDER 3S', 2, 7.7);
  ctx.fillText('SERIAL  PP 2026 0001 89', 2, 9.5);
  // Barcode.
  let x = wmm - 16;
  let seed = 7;
  while (x < wmm - 2) {
    seed = (seed * 48271) % 2147483647;
    const bw = 0.15 + (seed % 4) * 0.12;
    ctx.fillRect(x, 3.6, bw, 5.4);
    x += bw + 0.2 + (seed % 3) * 0.1;
  }
  return texture(c, anisotropy);
}

/** Small label for the side faces ("CONTRAST", "VOL" ...). Returns texture + aspect. */
export function makeSideLabelTexture(text: string, anisotropy: number, color = 'rgba(60,58,66,0.85)'): { tex: THREE.CanvasTexture; wmm: number; hmm: number } {
  const hmm = 2.4;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `bold 1.7px ${SANS}`;
  const wmm = Math.max(4, probe.measureText(text).width + 0.8);
  const { c, ctx } = canvas(wmm, hmm, 24);
  ctx.fillStyle = color;
  ctx.font = `bold 1.7px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, wmm / 2, hmm / 2 + 0.05);
  return { tex: texture(c, anisotropy), wmm, hmm };
}

const LABEL_SHADE_INDEX: Record<string, keyof CartridgeLabel | 'black'> = { '0': 'background', '1': 'accent', '2': 'text', '3': 'black' };

/** Cartridge sticker drawn from the game's label definition. */
export function makeCartridgeLabelTexture(title: string, label: CartridgeLabel, anisotropy: number, wmm: number, hmm: number): THREE.CanvasTexture {
  return texture(drawCartridgeLabel(title, label, wmm, hmm, 16), anisotropy);
}

/** Draws the cartridge sticker onto a canvas (also used for the library thumbnails). */
export function drawCartridgeLabel(title: string, label: CartridgeLabel, wmm: number, hmm: number, scale: number): HTMLCanvasElement {
  const { c, ctx } = canvas(wmm, hmm, scale);
  // Base.
  ctx.fillStyle = label.background;
  ctx.fillRect(0, 0, wmm, hmm);
  // Top band with system badge.
  ctx.fillStyle = '#1d1d22';
  ctx.fillRect(0, 0, wmm, 6);
  ctx.fillStyle = '#f2efe6';
  ctx.font = `900 italic 2.6px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('POCKET PIXEL', 2, 3.1);
  ctx.font = `bold 1.5px ${SANS}`;
  ctx.textAlign = 'right';
  ctx.fillText('GAME CARTRIDGE', wmm - 2, 3.2);
  ctx.textAlign = 'left';

  // Accent diagonal stripe.
  ctx.fillStyle = label.accent;
  ctx.beginPath();
  ctx.moveTo(0, hmm * 0.62);
  ctx.lineTo(wmm, hmm * 0.38);
  ctx.lineTo(wmm, hmm * 0.52);
  ctx.lineTo(0, hmm * 0.76);
  ctx.closePath();
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Pixel art, centred in the artwork window.
  const rows = label.art;
  const artH = rows.length;
  const artW = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const area = { x: 3, y: 8, w: wmm - 6, h: hmm - 22 };
  const cell = Math.min(area.w / Math.max(1, artW), area.h / Math.max(1, artH));
  const ox = area.x + (area.w - artW * cell) / 2;
  const oy = area.y + (area.h - artH * cell) / 2;
  const colours: Record<string, string> = {
    background: label.background,
    accent: label.accent,
    text: label.text,
    black: '#121214',
  };
  for (let r = 0; r < artH; r++) {
    const row = rows[r] ?? '';
    for (let col = 0; col < row.length; col++) {
      const key = LABEL_SHADE_INDEX[row[col] ?? '.'];
      if (!key) continue;
      ctx.fillStyle = colours[key] ?? '#000';
      ctx.fillRect(ox + col * cell, oy + r * cell, cell + 0.02, cell + 0.02);
    }
  }

  // Title plate.
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, hmm - 13, wmm, 13);
  ctx.fillStyle = label.text;
  ctx.font = `900 italic 5px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(title.toUpperCase(), wmm / 2, hmm - 8.4);
  ctx.fillStyle = label.accent;
  ctx.font = `bold 2px ${SANS}`;
  ctx.fillText(label.tagline.toUpperCase(), wmm / 2, hmm - 3.6);
  return c;
}
