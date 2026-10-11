import type { Sprite, Texture } from 'pixi.js';

/** Assign a texture and apply its default anchor (Pixi only does this in the Sprite constructor). */
export function setTex(sprite: Sprite, tex: Texture): void {
  sprite.texture = tex;
  const a = tex.defaultAnchor;
  if (a) sprite.anchor.set(a.x, a.y);
}
