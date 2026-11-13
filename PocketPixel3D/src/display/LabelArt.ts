import type { CartridgeLabel } from '../games/GameInterface';

/** Canvas-only cartridge label art, shared by the 3D cartridge texture and the library thumbnails. */
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

function canvas(wmm: number, hmm: number, scale: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.round(wmm * scale);
  c.height = Math.round(hmm * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.scale(scale, scale);
  return { c, ctx };
}

const LABEL_SHADE_INDEX: Record<string, keyof CartridgeLabel | 'black'> = { '0': 'background', '1': 'accent', '2': 'text', '3': 'black' };

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
