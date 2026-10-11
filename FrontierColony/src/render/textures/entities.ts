/** Small character parts and UI marker textures. Characters are drawn white so sprites can be tinted. */
import { css } from '../util/color';
import { createArt, softBlob, type Art } from './canvas';
import { SHADOW } from './palette';

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
