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

/** Thin raindrop streak (vertical, fades at both ends). */
export function makeStreak(): Art {
  const art = createArt(4, 28, 2, 14);
  const { ctx } = art;
  const g = ctx.createLinearGradient(0, 0, 0, 28);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0.15)');
  ctx.fillStyle = g;
  ctx.fillRect(1.2, 0, 1.6, 28);
  return art;
}

/** Ground splash ring. */
export function makeRing(): Art {
  const art = createArt(24, 12, 12, 6);
  const { ctx } = art;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(12, 6, 8, 3.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.ellipse(12, 6, 4.4, 1.8, 0, 0, Math.PI * 2);
  ctx.stroke();
  return art;
}

/** Soft cloud shadow blob (dark, feathered). */
export function makeCloud(): Art {
  const art = createArt(256, 128, 128, 64);
  const { ctx } = art;
  for (const [x, y, rx, ry, a] of [
    [128, 64, 110, 46, 0.55],
    [80, 70, 64, 34, 0.5],
    [182, 60, 66, 36, 0.5],
    [124, 46, 70, 30, 0.45],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return art;
}

/** Teardrop flame (yellow core, orange body). */
export function makeFlame(): Art {
  const art = createArt(16, 22, 8, 20);
  const { ctx } = art;
  const body = (w: number, h: number, c0: string, c1: string): void => {
    const g = ctx.createLinearGradient(0, 20 - h, 0, 20);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(8, 20 - h);
    ctx.bezierCurveTo(8 + w * 0.2, 20 - h * 0.55, 8 + w, 20 - h * 0.45, 8 + w * 0.8, 20 - h * 0.18);
    ctx.quadraticCurveTo(8, 21, 8 - w * 0.8, 20 - h * 0.18);
    ctx.bezierCurveTo(8 - w, 20 - h * 0.45, 8 - w * 0.2, 20 - h * 0.55, 8, 20 - h);
    ctx.fill();
  };
  body(7, 19, 'rgba(255,140,40,0)', 'rgba(255,110,30,0.95)');
  body(5, 14, 'rgba(255,196,70,0.4)', 'rgba(255,170,50,1)');
  body(2.8, 8, 'rgba(255,248,190,0.6)', 'rgba(255,244,170,1)');
  return art;
}

/** Warm radial glow for night lights (white; tinted by the sprite). */
export function makeGlow(): Art {
  const art = createArt(96, 96, 48, 48);
  const { ctx } = art;
  const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 96, 96);
  return art;
}

/** Campfire base: stone ring and crossed logs (flames are separate animated sprites). */
export function makeCampfire(): Art {
  const art = createArt(44, 30, 22, 18);
  const { ctx } = art;
  ctx.fillStyle = css([20, 24, 40], 0.25);
  ctx.beginPath();
  ctx.ellipse(24, 20, 17, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // stones around
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = 22 + Math.cos(a) * 13;
    const y = 18 + Math.sin(a) * 5.4;
    ctx.fillStyle = css([46, 44, 50], 1);
    ctx.beginPath();
    ctx.ellipse(x, y, 3.8, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(i % 2 ? [160, 156, 150] : [136, 132, 130], 1);
    ctx.beginPath();
    ctx.ellipse(x - 0.3, y - 0.5, 3, 2.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // embers bed
  ctx.fillStyle = css([40, 24, 20], 1);
  ctx.beginPath();
  ctx.ellipse(22, 18, 9, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([226, 96, 36], 0.8);
  ctx.beginPath();
  ctx.ellipse(22, 18.4, 6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // logs
  for (const [dx, rot] of [
    [-1, 0.5],
    [1, -0.5],
  ] as const) {
    ctx.save();
    ctx.translate(22 + dx * 2, 17.5);
    ctx.rotate(rot);
    ctx.fillStyle = css([44, 30, 24], 1);
    ctx.beginPath();
    ctx.roundRect(-9.5, -2.4, 19, 4.8, 2.4);
    ctx.fill();
    ctx.fillStyle = css([128, 90, 60], 1);
    ctx.beginPath();
    ctx.roundRect(-9, -1.8, 18, 3.4, 1.7);
    ctx.fill();
    ctx.restore();
  }
  return art;
}

/** Torch on a post. Flame is a separate sprite. */
export function makeTorchPost(): Art {
  const art = createArt(10, 34, 5, 32);
  const { ctx } = art;
  ctx.fillStyle = css([20, 24, 40], 0.25);
  ctx.beginPath();
  ctx.ellipse(6, 32, 4, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css([46, 32, 26], 1);
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(5, 32);
  ctx.lineTo(5, 8);
  ctx.stroke();
  ctx.strokeStyle = css([156, 112, 72], 1);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = css([60, 44, 36], 1);
  ctx.beginPath();
  ctx.roundRect(2.4, 4, 5.2, 6, 1.4);
  ctx.fill();
  return art;
}

/** Sick-settler badge: green face with a thermometer-ish cross. */
export function makeSickBadge(): Art {
  const art = createArt(14, 14, 7, 7);
  const { ctx } = art;
  ctx.fillStyle = css([30, 40, 30], 0.95);
  ctx.beginPath();
  ctx.arc(7, 7, 6.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([132, 196, 96], 1);
  ctx.beginPath();
  ctx.arc(7, 7, 5.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([30, 56, 30], 1);
  ctx.beginPath();
  ctx.arc(5, 6, 0.8, 0, Math.PI * 2);
  ctx.arc(9, 6, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = css([30, 56, 30], 1);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(4.6, 9.8);
  ctx.quadraticCurveTo(7, 8.2, 9.4, 9.8);
  ctx.stroke();
  return art;
}

/** Charred ground tile for wildfire scars (alpha falloff towards the edge). */
export function makeAsh(seed: number): Art {
  const art = createArt(70, 36, 35, 18);
  const { ctx } = art;
  const rng = (() => {
    let s = seed * 9301 + 49297;
    return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  })();
  ctx.save();
  ctx.translate(35, 18);
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 36);
  g.addColorStop(0, 'rgba(26,22,22,0.92)');
  g.addColorStop(0.7, 'rgba(34,28,26,0.78)');
  g.addColorStop(1, 'rgba(34,28,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 24;
    const x = 35 + Math.cos(a) * r;
    const y = 18 + Math.sin(a) * r * 0.5;
    ctx.fillStyle = css(rng() < 0.25 ? [200, 70, 30] : rng() < 0.5 ? [70, 60, 56] : [14, 12, 14], rng() < 0.25 ? 0.5 : 0.55);
    ctx.beginPath();
    ctx.ellipse(x, y, 0.8 + rng() * 2.2, 0.5 + rng(), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return art;
}
