/**
 * Scene-graph layout. Everything inside `world` is transformed by the camera.
 *
 *   ground    static chunked terrain (sea-level tiles, flat decals)
 *   waterFx   animated shimmer and shoreline foam
 *   decals    dynamic ground overlays (reserved for tracks, construction pads ...)
 *   objects   depth-sorted: raised tiles, trees, rocks, mountains, buildings, settlers
 *   effects   particles (reserved for M6)
 *   overlays  hover, selection, placement ghost, map overlays
 *   labels    UI in the world: activity bubbles, names (reserved for M3)
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
