/**
 * PixiJS v8 renderer entry point. `createRenderer` sets up the Application and hands it to
 * `IsoRenderer` (renderer.ts), which implements the `GameRenderer` contract from ./types.
 *
 * Module map:
 *   renderer.ts        orchestration, picking, GameRenderer implementation
 *   camera.ts          eased pan / zoom / centerOn, clamping
 *   input.ts           pointer, wheel, touch and keyboard handling
 *   layers.ts          scene-graph layers (ground → objects → effects → overlays → labels)
 *   terrain/           chunked terrain: model (typed tile data), chunk builder, culling, water animation
 *   textures/          procedural art (canvas) packed into atlases
 *   entities/          settlers, buildings, hover / selection / ghost overlays
 */
import { Application } from 'pixi.js';
import { IsoRenderer } from './renderer';
import { buildTextureSet } from './textures';
import type { CreateRenderer } from './types';

export type { GameRenderer, RendererCallbacks, FrameInfo, CameraState, CreateRenderer } from './types';

export const createRenderer: CreateRenderer = async (host, callbacks) => {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: 0x141c2b,
    antialias: true,
    autoStart: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
  });
  app.ticker.stop();
  app.canvas.setAttribute('data-testid', 'game-canvas');
  host.appendChild(app.canvas);
  const tex = buildTextureSet();
  const renderer = new IsoRenderer(app, callbacks, tex);
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('renderDebug')) {
    (window as unknown as { __frontierRender?: unknown }).__frontierRender = { renderer, stats: renderer.stats, pages: tex.pages };
  }
  return renderer;
};
