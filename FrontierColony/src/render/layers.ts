/**
 * Scene-graph layout. Everything inside `world` is transformed by the camera.
 *
 *   ground    static chunked terrain: one baked picture per chunk (ground + trees, rocks, hills) when zoomed
 *             out, live flat-tile sprites when zoomed in (see terrain/terrainRenderer.ts)
 *   waterFx   animated shimmer and shoreline foam
 *   decals    dynamic ground overlays (wildfire scorch marks; the burnt ground regrows)
 *   objects   depth-sorted: buildings, settlers, redrawn "occluders" from baked chunks, and (zoomed in)
 *             raised tiles, trees, rocks, mountains
 *   effects   pooled particles, floating text, falling trees, wildfire flames and smoke
 *   overlays  hover, selection, placement ghost, map overlays
 *   labels    floating "+2 wood" style text (also holds the off-screen mesh that keeps
 *             Pixi's shared mesh shader off destroyed baked textures)
 */
import { Container } from 'pixi.js';

export interface Layers {
  world: Container;
  ground: Container;
  waterFx: Container;
  decals: Container;
  objects: Container;
  effects: Container;
  overlays: Container;
  labels: Container;
}

export function createLayers(): Layers {
  const world = new Container();
  const ground = new Container();
  const waterFx = new Container();
  const decals = new Container();
  const objects = new Container();
  const effects = new Container();
  const overlays = new Container();
  const labels = new Container();
  world.addChild(ground, waterFx, decals, objects, effects, overlays, labels);
  return { world, ground, waterFx, decals, objects, effects, overlays, labels };
}
