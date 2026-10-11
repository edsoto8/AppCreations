/** Small character parts and UI marker textures. Characters are drawn white so sprites can be tinted. */
import { css } from '../util/color';
import { createArt, softBlob, type Art } from './canvas';
import { SHADOW } from './palette';

export const SETTLER_PARTS = {
  legsW: 10,
  legsH: 8,
};

export function makeSettlerLegs(): Art {
  const art = createArt(12, 10, 6, 9);
  const { ctx } = art;
  for (const dx of [-2.2, 2.2]) {
    ctx.fillStyle = css([40, 30, 28], 1);
    ctx.beginPath();
    ctx.roundRect(6 + dx - 1.7, 1.2, 3.4, 7.4, 1.2);
    ctx.fill();
    ctx.fillStyle = css([92, 70, 54], 1);
    ctx.beginPath();
    ctx.roundRect(6 + dx - 1.2, 1.6, 2.4, 5.4, 1);
    ctx.fill();
    ctx.fillStyle = css([50, 38, 32], 1);
    ctx.beginPath();
    ctx.roundRect(6 + dx - 1.6, 6.4, 3.2, 2.2, 1);
    ctx.fill();
  }
  return art;
}

export function makeSettlerTorso(): Art {
  const art = createArt(16, 16, 8, 14);
  const { ctx } = art;
  // dark outline then light body
  ctx.fillStyle = css([36, 28, 30], 1);
  ctx.beginPath();
  ctx.roundRect(2.4, 1.6, 11.2, 12.2, 3.4);
  ctx.fill();
  const g = ctx.createLinearGradient(3, 2, 13, 13);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(0.55, css([232, 232, 236], 1));
  g.addColorStop(1, css([188, 188, 200], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(3.1, 2.3, 9.8, 10.6, 2.8);
  ctx.fill();
  // belt + collar
  ctx.fillStyle = css([90, 66, 50], 0.9);
  ctx.fillRect(3.1, 9, 9.8, 1.5);
  ctx.fillStyle = css([0, 0, 0], 0.12);
  ctx.beginPath();
  ctx.ellipse(8, 2.6, 2.6, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  return art;
}

export function makeSettlerHead(): Art {
  const art = createArt(14, 14, 7, 11);
  const { ctx } = art;
  ctx.fillStyle = css([36, 28, 30], 1);
  ctx.beginPath();
  ctx.arc(7, 6.5, 4.9, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(5.5, 5, 0.5, 7, 6.5, 4.6);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(1, css([214, 204, 200], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(7, 6.5, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([40, 28, 26], 0.9);
  ctx.beginPath();
  ctx.arc(5.5, 6.9, 0.55, 0, Math.PI * 2);
  ctx.arc(8.5, 6.9, 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([220, 100, 90], 0.45);
  ctx.beginPath();
  ctx.ellipse(4.4, 8.3, 0.9, 0.5, 0, 0, Math.PI * 2);
  ctx.ellipse(9.6, 8.3, 0.9, 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  return art;
}

export function makeSettlerHair(): Art {
  const art = createArt(14, 14, 7, 11);
  const { ctx } = art;
  ctx.fillStyle = css([36, 28, 30], 1);
  ctx.beginPath();
  ctx.arc(7, 6, 4.9, Math.PI * 1.02, Math.PI * 1.98);
  ctx.quadraticCurveTo(11.4, 5.4, 10.6, 6.6);
  ctx.quadraticCurveTo(7, 3.2, 3.4, 6.6);
  ctx.quadraticCurveTo(2.6, 5.4, 2.1, 6);
  ctx.fill();
  const g = ctx.createLinearGradient(3, 1, 11, 6);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(1, css([170, 170, 178], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(7, 6, 4.3, Math.PI * 1.04, Math.PI * 1.96);
  ctx.quadraticCurveTo(10.8, 5, 10, 6.2);
  ctx.quadraticCurveTo(7, 3.6, 4, 6.2);
  ctx.quadraticCurveTo(3.2, 5, 2.8, 5.8);
  ctx.fill();
  return art;
}

/** Glowing ring on the ground for the selected settler. */
export function makeSelectionRing(): Art {
  const art = createArt(52, 28, 26, 14);
  const { ctx } = art;
  ctx.save();
  ctx.translate(26, 14);
  ctx.scale(1, 0.5);
  for (const [w, a] of [
    [5, 0.14],
    [3.2, 0.3],
  ] as const) {
    ctx.strokeStyle = css([255, 214, 110], a);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = css([255, 240, 190], 0.95);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  softBlob(ctx, 26, 14, 20, 9, css([255, 214, 110], 1), 0.18);
  return art;
}

export function makeSoftShadow(): Art {
  const art = createArt(40, 20, 20, 10);
  softBlob(art.ctx, 20, 10, 18, 8, css(SHADOW, 1), 0.5);
  return art;
}
