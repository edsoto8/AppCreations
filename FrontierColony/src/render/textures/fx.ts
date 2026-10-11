/** Particle and floating-text sprites (white or neutral so they can be tinted). */
import { css } from '../util/color';
import { createArt, type Art } from './canvas';
import type { ResourceType } from '../../sim';

export function makeSoftDot(): Art {
  const art = createArt(16, 16, 8, 8);
  const { ctx } = art;
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  return art;
}

/** Billowy dust / smoke puff. */
export function makePuff(): Art {
  const art = createArt(32, 32, 16, 16);
  const { ctx } = art;
  for (const [x, y, r, a] of [
    [16, 16, 11, 0.7],
    [11, 18, 7.5, 0.55],
    [21, 17, 8, 0.55],
    [15, 11, 7, 0.5],
  ] as const) {
    const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.65, `rgba(255,255,255,${a * 0.6})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}

export function makeChip(): Art {
  const art = createArt(8, 6, 4, 3);
  const { ctx } = art;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(0.6, 3);
  ctx.lineTo(3, 0.6);
  ctx.lineTo(7.2, 1.8);
  ctx.lineTo(6.4, 4.6);
  ctx.lineTo(2, 5.4);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(2, 3.4, 4.6, 1.6);
  return art;
}

export function makeSpark(): Art {
  const art = createArt(14, 14, 7, 7);
  const { ctx } = art;
  const g = ctx.createRadialGradient(7, 7, 0, 7, 7, 6);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(7, 7, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(7, 0.2);
  ctx.quadraticCurveTo(7.8, 6.2, 13.8, 7);
  ctx.quadraticCurveTo(7.8, 7.8, 7, 13.8);
  ctx.quadraticCurveTo(6.2, 7.8, 0.2, 7);
  ctx.quadraticCurveTo(6.2, 6.2, 7, 0.2);
  ctx.fill();
  return art;
}

export function makeLeaf(): Art {
  const art = createArt(10, 8, 5, 4);
  const { ctx } = art;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.moveTo(0.6, 4);
  ctx.quadraticCurveTo(4, -0.8, 9.4, 3);
  ctx.quadraticCurveTo(5, 8.6, 0.6, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(1, 4);
  ctx.lineTo(8.6, 3);
  ctx.stroke();
  return art;
}

/** Tiny resource icons shown beside "+N" floating text. */
export function makeResourceIcon(r: ResourceType): Art {
  const art = createArt(14, 14, 7, 7);
  const { ctx } = art;
  ctx.lineJoin = 'round';
  switch (r) {
    case 'wood':
      for (const [y, c] of [
        [4, [168, 124, 80]],
        [8, [150, 108, 68]],
      ] as const) {
        ctx.fillStyle = css([50, 34, 26], 1);
        ctx.beginPath();
        ctx.roundRect(0.8, y - 2.4, 12, 4.8, 2.4);
        ctx.fill();
        ctx.fillStyle = css(c, 1);
        ctx.beginPath();
        ctx.roundRect(1.4, y - 1.8, 10.8, 3.6, 1.8);
        ctx.fill();
        ctx.fillStyle = css([230, 192, 136], 1);
        ctx.beginPath();
        ctx.ellipse(11.2, y, 0.9, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'stone':
      ctx.fillStyle = css([40, 40, 48], 1);
      ctx.beginPath();
      ctx.moveTo(1, 10.6);
      ctx.lineTo(2.4, 4.4);
      ctx.lineTo(7, 1.6);
      ctx.lineTo(12, 4.2);
      ctx.lineTo(13, 10.4);
      ctx.lineTo(7, 12.8);
      ctx.fill();
      ctx.fillStyle = css([164, 164, 170], 1);
      ctx.beginPath();
      ctx.moveTo(2.2, 10);
      ctx.lineTo(3.4, 5);
      ctx.lineTo(7, 2.8);
      ctx.lineTo(11, 5);
      ctx.lineTo(11.8, 9.8);
      ctx.lineTo(7, 11.6);
      ctx.fill();
      ctx.fillStyle = css([218, 218, 222], 1);
      ctx.beginPath();
      ctx.moveTo(3.4, 5);
      ctx.lineTo(7, 2.8);
      ctx.lineTo(11, 5);
      ctx.lineTo(7, 6.6);
      ctx.fill();
      break;
    case 'food':
      ctx.fillStyle = css([60, 40, 22], 1);
      ctx.beginPath();
      ctx.arc(7, 8, 5.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css([236, 188, 76], 1);
      ctx.beginPath();
      ctx.arc(7, 8, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css([252, 226, 130], 1);
      ctx.beginPath();
      ctx.arc(5.6, 6.4, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css([96, 150, 60], 1);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(7, 3.6);
      ctx.lineTo(8.4, 1);
      ctx.stroke();
      break;
    case 'water':
      ctx.fillStyle = css([24, 54, 96], 1);
      ctx.beginPath();
      ctx.moveTo(7, 0.6);
      ctx.quadraticCurveTo(13.4, 8, 11.6, 10.6);
      ctx.quadraticCurveTo(7, 14.2, 2.4, 10.6);
      ctx.quadraticCurveTo(0.6, 8, 7, 0.6);
      ctx.fill();
      ctx.fillStyle = css([88, 168, 232], 1);
      ctx.beginPath();
      ctx.moveTo(7, 2.2);
      ctx.quadraticCurveTo(12, 8, 10.6, 10);
      ctx.quadraticCurveTo(7, 12.8, 3.4, 10);
      ctx.quadraticCurveTo(2, 8, 7, 2.2);
      ctx.fill();
      ctx.fillStyle = css([210, 238, 255], 1);
      ctx.beginPath();
      ctx.ellipse(5.2, 8.4, 1, 1.8, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tools':
      ctx.strokeStyle = css([50, 36, 30], 1);
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(3, 12);
      ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.strokeStyle = css([176, 128, 80], 1);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(3, 12);
      ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.fillStyle = css([40, 36, 40], 1);
      ctx.fillRect(6.6, 1, 6.6, 4.6);
      ctx.fillStyle = css([190, 196, 206], 1);
      ctx.fillRect(7.3, 1.7, 5.2, 3.2);
      break;
  }
  return art;
}
