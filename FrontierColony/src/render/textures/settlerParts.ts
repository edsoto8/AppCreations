/**
 * Character rig parts, tools, carried goods and activity badges. Body parts are drawn in
 * near-white shades so the sprite tint (skin / hair / shirt from `Appearance`) supplies the colour.
 * Facing: parts are drawn for a character looking towards screen-right-down ("se"); "sw" mirrors the rig
 * and the back views ("ne", "nw") use the *Back variants.
 */
import { css } from '../util/color';
import { createArt, softBlob, type Art } from './canvas';
import { SHADOW } from './palette';

const OUTLINE = css([38, 28, 30], 1);

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// --- Body ---------------------------------------------------------------------------------------

/** Leg: anchored at the hip (top centre). */
export function makeLeg(): Art {
  const art = createArt(6, 12, 3, 1);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  rr(ctx, 0.3, 0, 5.4, 11.4, 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 6, 0);
  g.addColorStop(0, css([128, 98, 72], 1));
  g.addColorStop(1, css([88, 66, 50], 1));
  ctx.fillStyle = g;
  rr(ctx, 0.9, 0.5, 4.2, 7.6, 1.6);
  ctx.fill();
  // boot
  ctx.fillStyle = css([52, 38, 32], 1);
  rr(ctx, 0.9, 7.4, 4.6, 3.6, 1.4);
  ctx.fill();
  ctx.fillStyle = css([92, 70, 56], 1);
  ctx.fillRect(1.3, 7.6, 3.4, 0.7);
  return art;
}

/** Torso (tint = shirt). Anchored at the waist (bottom centre). */
export function makeTorso(back: boolean): Art {
  const art = createArt(16, 14, 8, 12.5);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  rr(ctx, 2.6, 0.8, 10.8, 12.2, 3.6);
  ctx.fill();
  const g = ctx.createLinearGradient(3, 1, 13, 12);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(0.55, css([232, 232, 238], 1));
  g.addColorStop(1, css([184, 184, 198], 1));
  ctx.fillStyle = g;
  rr(ctx, 3.3, 1.5, 9.4, 10.6, 3);
  ctx.fill();
  // belt
  ctx.fillStyle = css([88, 64, 48], 0.95);
  ctx.fillRect(3.3, 9.3, 9.4, 1.7);
  if (!back) {
    ctx.fillStyle = css([226, 196, 120], 1);
    ctx.fillRect(7.2, 9.2, 1.6, 1.9);
    // collar V
    ctx.fillStyle = css([0, 0, 0], 0.16);
    ctx.beginPath();
    ctx.moveTo(6, 1.7);
    ctx.lineTo(10, 1.7);
    ctx.lineTo(8, 4.6);
    ctx.fill();
  } else {
    ctx.fillStyle = css([0, 0, 0], 0.1);
    ctx.fillRect(7.6, 2.5, 0.8, 6.6);
  }
  return art;
}

/** Sleeve (tint = shirt). Anchored at the shoulder. The hand is a separate sprite. */
export function makeSleeve(): Art {
  const art = createArt(6, 9, 3, 1.4);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  rr(ctx, 0.2, 0, 5.6, 8, 2.6);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 6, 0);
  g.addColorStop(0, css([252, 252, 255], 1));
  g.addColorStop(1, css([188, 188, 200], 1));
  ctx.fillStyle = g;
  rr(ctx, 0.8, 0.5, 4.4, 6.8, 2.1);
  ctx.fill();
  return art;
}

/** Hand (tint = skin), anchored at its centre. */
export function makeHand(): Art {
  const art = createArt(6, 6, 3, 3);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(3, 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css([255, 244, 236], 1);
  ctx.beginPath();
  ctx.arc(3, 3, 1.9, 0, Math.PI * 2);
  ctx.fill();
  return art;
}

/** Head (tint = skin), anchored at the chin/neck. */
export function makeHead(back: boolean): Art {
  const art = createArt(16, 16, 8, 13);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(8, 8, 5.4, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(6.2, 6, 0.5, 8, 8, 5);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(1, css([218, 208, 204], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(8, 8, 4.7, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!back) {
    ctx.fillStyle = css([40, 28, 26], 0.95);
    ctx.beginPath();
    ctx.ellipse(6.2, 8.4, 0.62, 0.8, 0, 0, Math.PI * 2);
    ctx.ellipse(9.8, 8.4, 0.62, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css([226, 110, 100], 0.4);
    ctx.beginPath();
    ctx.ellipse(5, 10, 1, 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(11, 10, 1, 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = css([120, 66, 56], 0.7);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(7.2, 10.9);
    ctx.quadraticCurveTo(8, 11.5, 8.8, 10.9);
    ctx.stroke();
  }
  return art;
}

/** Hair styles 0..3 (tint = hair colour). Same anchor as the head. */
export function makeHair(style: number, back: boolean): Art {
  const art = createArt(16, 16, 8, 13);
  const { ctx } = art;
  const draw = (fill: string | CanvasGradient, grow: number): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (back) {
      // full cap covering the back of the head
      ctx.ellipse(8, 7.7, 5.2 + grow, 5 + grow, 0, 0, Math.PI * 2);
      if (style === 3) ctx.rect(3.4 - grow, 7, 9.2 + grow * 2, 5.6 + grow);
    } else {
      ctx.moveTo(2.6 - grow, 8.2);
      ctx.bezierCurveTo(2 - grow, 1.4 - grow, 14 + grow, 1.4 - grow, 13.4 + grow, 8.2);
      if (style === 0) {
        ctx.quadraticCurveTo(11.4, 5.2, 8, 4.8);
        ctx.quadraticCurveTo(4.6, 5.2, 2.6 - grow, 8.2);
      } else if (style === 1) {
        ctx.quadraticCurveTo(12, 6.4, 9, 5.2);
        ctx.quadraticCurveTo(5.6, 6.6, 2.6 - grow, 8.2);
      } else if (style === 2) {
        ctx.lineTo(12.4 + grow, 5.8);
        ctx.quadraticCurveTo(8, 3.6, 3.6 - grow, 5.8);
      } else {
        // long hair framing the face
        ctx.lineTo(13.4 + grow, 12.6);
        ctx.lineTo(11.8, 12.6);
        ctx.lineTo(11.6, 6.6);
        ctx.quadraticCurveTo(8, 4.4, 4.4, 6.6);
        ctx.lineTo(4.2, 12.6);
        ctx.lineTo(2.6 - grow, 12.6);
      }
    }
    ctx.closePath();
    ctx.fill();
  };
  draw(OUTLINE, 0.7);
  const g = ctx.createLinearGradient(3, 2, 13, 9);
  g.addColorStop(0, css([255, 255, 255], 1));
  g.addColorStop(1, css([168, 168, 178], 1));
  draw(g, 0);
  return art;
}

/** Straw hat (untinted). Anchored like the head. */
export function makeHat(): Art {
  const art = createArt(20, 16, 10, 13);
  const { ctx } = art;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.ellipse(10, 5.6, 8.6, 2.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4.6, 5);
  ctx.quadraticCurveTo(5, 0.2, 10, 0.2);
  ctx.quadraticCurveTo(15, 0.2, 15.4, 5);
  ctx.fill();
  ctx.fillStyle = css([214, 176, 98], 1);
  ctx.beginPath();
  ctx.ellipse(10, 5.4, 7.9, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(5, 0, 15, 5);
  g.addColorStop(0, css([236, 204, 128], 1));
  g.addColorStop(1, css([182, 142, 72], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(5.3, 5);
  ctx.quadraticCurveTo(5.6, 0.9, 10, 0.9);
  ctx.quadraticCurveTo(14.4, 0.9, 14.7, 5);
  ctx.fill();
  ctx.fillStyle = css([150, 62, 52], 1);
  ctx.fillRect(5.4, 3.7, 9.2, 1);
  return art;
}

// --- Tools and carried goods ----------------------------------------------------------------------

function handle(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, w = 1.5): void {
  ctx.strokeStyle = css([60, 40, 28], 1);
  ctx.lineWidth = w + 1.1;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.strokeStyle = css([156, 112, 70], 1);
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}

const STEEL = [196, 200, 208] as const;

/** All tools point "up" (-y) with the grip anchored near the bottom of the handle. */
export function makeAxe(): Art {
  const art = createArt(14, 20, 5, 17);
  const { ctx } = art;
  handle(ctx, 5, 1, 19);
  ctx.fillStyle = css([40, 34, 36], 1);
  ctx.beginPath();
  ctx.moveTo(4, 1);
  ctx.lineTo(11.6, -0.4);
  ctx.quadraticCurveTo(13.4, 3.6, 11.6, 7.6);
  ctx.lineTo(4, 5.6);
  ctx.fill();
  const g = ctx.createLinearGradient(5, 1, 12, 7);
  g.addColorStop(0, css([236, 240, 246], 1));
  g.addColorStop(1, css(STEEL, 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(4.6, 1.6);
  ctx.lineTo(11, 0.4);
  ctx.quadraticCurveTo(12.4, 3.6, 11, 7);
  ctx.lineTo(4.6, 5.2);
  ctx.fill();
  return art;
}

export function makePick(): Art {
  const art = createArt(18, 20, 9, 17);
  const { ctx } = art;
  handle(ctx, 9, 1.5, 19);
  ctx.strokeStyle = css([40, 34, 36], 1);
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(1.4, 5.2);
  ctx.quadraticCurveTo(9, -1.4, 16.6, 5.2);
  ctx.stroke();
  ctx.strokeStyle = css(STEEL, 1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1.8, 4.9);
  ctx.quadraticCurveTo(9, -0.8, 16.2, 4.9);
  ctx.stroke();
  return art;
}

export function makeHammer(): Art {
  const art = createArt(12, 18, 6, 15);
  const { ctx } = art;
  handle(ctx, 6, 2.5, 17);
  ctx.fillStyle = css([40, 34, 36], 1);
  ctx.beginPath();
  ctx.roundRect(1.4, 0.4, 9.4, 5.2, 1);
  ctx.fill();
  ctx.fillStyle = css([150, 154, 164], 1);
  ctx.beginPath();
  ctx.roundRect(2, 1, 8.2, 4, 0.8);
  ctx.fill();
  ctx.fillStyle = css([214, 218, 226], 1);
  ctx.fillRect(2.4, 1.3, 7.4, 1);
  return art;
}

export function makeHoe(): Art {
  const art = createArt(14, 22, 5, 19);
  const { ctx } = art;
  handle(ctx, 5, 1.5, 21);
  ctx.fillStyle = css([40, 34, 36], 1);
  ctx.beginPath();
  ctx.moveTo(3.6, 0.6);
  ctx.lineTo(12.8, 2.6);
  ctx.lineTo(12.4, 5.4);
  ctx.lineTo(3.6, 3.8);
  ctx.fill();
  ctx.fillStyle = css(STEEL, 1);
  ctx.beginPath();
  ctx.moveTo(4.2, 1.2);
  ctx.lineTo(11.8, 3);
  ctx.lineTo(11.6, 4.7);
  ctx.lineTo(4.2, 3.2);
  ctx.fill();
  return art;
}

export function makeBucket(withWater: boolean): Art {
  const art = createArt(12, 14, 6, 2);
  const { ctx } = art;
  // handle arc
  ctx.strokeStyle = css([60, 44, 34], 1);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(6, 4.8, 3.6, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = css([44, 32, 26], 1);
  ctx.beginPath();
  ctx.moveTo(1.4, 5);
  ctx.lineTo(10.6, 5);
  ctx.lineTo(9.6, 12.6);
  ctx.lineTo(2.4, 12.6);
  ctx.fill();
  const g = ctx.createLinearGradient(1, 0, 11, 0);
  g.addColorStop(0, css([182, 134, 86], 1));
  g.addColorStop(1, css([118, 82, 54], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(2, 5.5);
  ctx.lineTo(10, 5.5);
  ctx.lineTo(9.2, 12);
  ctx.lineTo(2.8, 12);
  ctx.fill();
  ctx.strokeStyle = css([84, 82, 88], 0.9);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(2.2, 8);
  ctx.lineTo(9.8, 8);
  ctx.stroke();
  ctx.fillStyle = withWater ? css([96, 170, 220], 1) : css([40, 30, 24], 1);
  ctx.beginPath();
  ctx.ellipse(6, 5.4, 4, 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  return art;
}

/** Bundle of logs carried on the shoulder. Anchored at the centre. */
export function makeLogBundle(): Art {
  const art = createArt(18, 10, 9, 5);
  const { ctx } = art;
  for (const [x, y, c] of [
    [1, 5.5, [150, 108, 70]],
    [1.4, 2.6, [166, 122, 80]],
    [0.6, 0.4, [138, 98, 64]],
  ] as const) {
    ctx.fillStyle = css([50, 34, 26], 1);
    ctx.beginPath();
    ctx.roundRect(x - 0.5, y - 0.5, 16, 4, 2);
    ctx.fill();
    ctx.fillStyle = css(c, 1);
    ctx.beginPath();
    ctx.roundRect(x, y, 15, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = css([226, 186, 128], 1);
    ctx.beginPath();
    ctx.ellipse(x + 15, y + 1.5, 0.9, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = css([188, 150, 90], 1);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(8, 0.5);
  ctx.lineTo(8, 9);
  ctx.stroke();
  return art;
}

export function makeRockCarry(): Art {
  const art = createArt(12, 10, 6, 5);
  const { ctx } = art;
  ctx.fillStyle = css([44, 42, 48], 1);
  ctx.beginPath();
  ctx.moveTo(0.6, 7.4);
  ctx.lineTo(1.8, 2.4);
  ctx.lineTo(5.4, 0.4);
  ctx.lineTo(10, 2);
  ctx.lineTo(11.4, 7.2);
  ctx.lineTo(6, 9.6);
  ctx.fill();
  ctx.fillStyle = css([156, 152, 150], 1);
  ctx.beginPath();
  ctx.moveTo(1.6, 6.9);
  ctx.lineTo(2.6, 3);
  ctx.lineTo(5.4, 1.4);
  ctx.lineTo(9.2, 2.6);
  ctx.lineTo(10.2, 6.8);
  ctx.lineTo(6, 8.6);
  ctx.fill();
  ctx.fillStyle = css([206, 202, 194], 1);
  ctx.beginPath();
  ctx.moveTo(2.6, 3);
  ctx.lineTo(5.4, 1.4);
  ctx.lineTo(9.2, 2.6);
  ctx.lineTo(6, 4.4);
  ctx.fill();
  return art;
}

export function makeSack(color: [number, number, number] = [196, 164, 112]): Art {
  const art = createArt(12, 13, 6, 6.5);
  const { ctx } = art;
  ctx.fillStyle = css([52, 40, 30], 1);
  ctx.beginPath();
  ctx.moveTo(3.4, 1.6);
  ctx.quadraticCurveTo(0, 5.6, 1.4, 10.4);
  ctx.quadraticCurveTo(6, 12.6, 10.6, 10.4);
  ctx.quadraticCurveTo(12, 5.6, 8.6, 1.6);
  ctx.fill();
  const g = ctx.createLinearGradient(2, 2, 10, 11);
  g.addColorStop(0, css([color[0] + 24, color[1] + 24, color[2] + 20], 1));
  g.addColorStop(1, css([color[0] - 36, color[1] - 36, color[2] - 30], 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(3.8, 2.2);
  ctx.quadraticCurveTo(0.8, 5.8, 2, 10);
  ctx.quadraticCurveTo(6, 11.8, 10, 10);
  ctx.quadraticCurveTo(11.2, 5.8, 8.2, 2.2);
  ctx.fill();
  ctx.fillStyle = css([140, 60, 50], 1);
  ctx.fillRect(3.6, 1.6, 4.8, 1.2);
  return art;
}

export function makeCrateSmall(): Art {
  const art = createArt(12, 11, 6, 5.5);
  const { ctx } = art;
  ctx.fillStyle = css([50, 36, 28], 1);
  ctx.beginPath();
  ctx.roundRect(0.6, 1.4, 10.8, 8.8, 1);
  ctx.fill();
  ctx.fillStyle = css([188, 140, 92], 1);
  ctx.fillRect(1.4, 2.2, 9.2, 7.2);
  ctx.fillStyle = css([150, 106, 68], 1);
  ctx.fillRect(1.4, 5.2, 9.2, 1);
  ctx.fillRect(5.6, 2.2, 1, 7.2);
  ctx.strokeStyle = css([226, 186, 130], 1);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(1.5, 2.3, 9, 7);
  return art;
}

// --- Activity badges ------------------------------------------------------------------------------

export type BadgeKind = 'chop' | 'mine' | 'build' | 'craft' | 'farm' | 'water' | 'eat' | 'sleep' | 'chat' | 'rest';

function badgeBase(ctx: CanvasRenderingContext2D, color: [number, number, number]): void {
  ctx.fillStyle = css([30, 24, 30], 0.92);
  ctx.beginPath();
  ctx.arc(8, 8, 7.4, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(6, 5.5, 0.5, 8, 8, 6.8);
  g.addColorStop(0, css([Math.min(255, color[0] + 50), Math.min(255, color[1] + 50), Math.min(255, color[2] + 40)], 1));
  g.addColorStop(1, css(color, 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(8, 8, 6.4, 0, Math.PI * 2);
  ctx.fill();
}

export function makeBadge(kind: BadgeKind): Art {
  const art = createArt(16, 16, 8, 8);
  const { ctx } = art;
  const colors: Record<BadgeKind, [number, number, number]> = {
    chop: [196, 120, 52],
    mine: [124, 130, 150],
    build: [214, 170, 62],
    craft: [196, 96, 64],
    farm: [110, 168, 66],
    water: [70, 140, 206],
    eat: [212, 150, 70],
    sleep: [92, 100, 190],
    rest: [110, 130, 180],
    chat: [214, 130, 150],
  };
  badgeBase(ctx, colors[kind]);
  ctx.strokeStyle = css([255, 252, 240], 1);
  ctx.fillStyle = css([255, 252, 240], 1);
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  switch (kind) {
    case 'chop':
      ctx.beginPath();
      ctx.moveTo(5, 11.2);
      ctx.lineTo(10.4, 4.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8.6, 3.6);
      ctx.quadraticCurveTo(12.2, 4, 11.6, 7.6);
      ctx.lineTo(9.6, 6.6);
      ctx.fill();
      break;
    case 'mine':
      ctx.beginPath();
      ctx.moveTo(5.6, 11.2);
      ctx.lineTo(10, 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(4.2, 6.8);
      ctx.quadraticCurveTo(8, 2.6, 12.2, 5.6);
      ctx.stroke();
      break;
    case 'build':
    case 'craft':
      ctx.beginPath();
      ctx.moveTo(5.2, 11.4);
      ctx.lineTo(9.2, 6.6);
      ctx.stroke();
      ctx.fillRect(7.4, 3.8, 4.8, 3);
      break;
    case 'farm':
      ctx.beginPath();
      ctx.moveTo(8, 12);
      ctx.lineTo(8, 4);
      ctx.stroke();
      for (const [dx, dy] of [
        [-2.2, 6],
        [2.2, 6],
        [-2, 8.8],
        [2, 8.8],
        [0, 3.8],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(8 + dx, dy, 1.1, 1.8, dx * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'water':
      ctx.beginPath();
      ctx.moveTo(8, 3.4);
      ctx.quadraticCurveTo(12, 8.4, 10.8, 10.4);
      ctx.quadraticCurveTo(8, 12.6, 5.2, 10.4);
      ctx.quadraticCurveTo(4, 8.4, 8, 3.4);
      ctx.fill();
      break;
    case 'eat':
      ctx.beginPath();
      ctx.arc(8, 8, 3.8, 0, Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, 8);
      ctx.lineTo(12, 8);
      ctx.stroke();
      break;
    case 'sleep':
    case 'rest':
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind === 'sleep' ? 'Zz' : 'z', 8, 8.4);
      break;
    case 'chat':
      ctx.beginPath();
      ctx.roundRect(4, 4.4, 8, 5.4, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(6, 9.6);
      ctx.lineTo(5.6, 12);
      ctx.lineTo(8.2, 9.6);
      ctx.fill();
      break;
  }
  return art;
}

/** A floating "z" glyph for sleepers. */
export function makeZ(): Art {
  const art = createArt(12, 12, 6, 6);
  const { ctx } = art;
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = css([40, 50, 110], 0.9);
  ctx.strokeText('z', 6, 6.4);
  ctx.fillStyle = css([236, 242, 255], 1);
  ctx.fillText('z', 6, 6.4);
  return art;
}

/** Speech bubble with dots (or a heart) for socialising. */
export function makeSpeech(kind: 'dots' | 'heart' | 'note'): Art {
  const art = createArt(18, 16, 9, 14);
  const { ctx } = art;
  ctx.fillStyle = css([40, 34, 40], 0.9);
  ctx.beginPath();
  ctx.roundRect(1, 0.6, 16, 10.8, 5);
  ctx.moveTo(5.4, 11);
  ctx.lineTo(4.4, 14.2);
  ctx.lineTo(8.6, 11);
  ctx.fill();
  ctx.fillStyle = css([255, 252, 244], 1);
  ctx.beginPath();
  ctx.roundRect(1.8, 1.4, 14.4, 9.2, 4.2);
  ctx.moveTo(5.8, 10.4);
  ctx.lineTo(5, 13);
  ctx.lineTo(8.4, 10.4);
  ctx.fill();
  if (kind === 'dots') {
    ctx.fillStyle = css([90, 84, 100], 1);
    for (const x of [5.4, 9, 12.6]) {
      ctx.beginPath();
      ctx.arc(x, 6, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'heart') {
    ctx.fillStyle = css([226, 84, 110], 1);
    ctx.beginPath();
    ctx.moveTo(9, 9);
    ctx.bezierCurveTo(4, 5.6, 6, 2.2, 9, 4.8);
    ctx.bezierCurveTo(12, 2.2, 14, 5.6, 9, 9);
    ctx.fill();
  } else {
    ctx.fillStyle = css([90, 84, 150], 1);
    ctx.beginPath();
    ctx.arc(7.2, 7.8, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(8.4, 2.6, 1, 5.4);
    ctx.fillRect(8.4, 2.6, 3.6, 1.2);
  }
  return art;
}

export function makeBlanket(): Art {
  const art = createArt(22, 10, 11, 5);
  const { ctx } = art;
  softBlob(ctx, 11.5, 6.4, 10, 3.2, css(SHADOW, 1), 0.3);
  ctx.fillStyle = css([40, 30, 36], 1);
  ctx.beginPath();
  ctx.roundRect(1.4, 1.2, 19.2, 7, 3);
  ctx.fill();
  ctx.fillStyle = css([186, 96, 84], 1);
  ctx.beginPath();
  ctx.roundRect(2, 1.8, 18, 5.8, 2.6);
  ctx.fill();
  ctx.fillStyle = css([226, 170, 100], 0.9);
  ctx.fillRect(5, 1.8, 1.6, 5.8);
  ctx.fillRect(10, 1.8, 1.6, 5.8);
  ctx.fillRect(15, 1.8, 1.6, 5.8);
  return art;
}
