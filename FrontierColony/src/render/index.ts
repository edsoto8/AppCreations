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
  const dbg = new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('gpu') ?? '';
  const flag = (k: string): string | null => (dbg.split(',').find((x) => x.startsWith(k)) ?? null)?.slice(k.length) ?? null;
  await app.init({
    resizeTo: host,
    background: 0x141c2b,
    antialias: flag('aa') !== '0',
    autoStart: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    resolution: flag('res') ? Number(flag('res')) : Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
  });
  app.ticker.stop();
  if (flag('mt')) app.renderer.limits.maxBatchableTextures = Number(flag('mt'));
  app.canvas.setAttribute('data-testid', 'game-canvas');
  host.appendChild(app.canvas);
  const t0 = performance.now();
  const tex = buildTextureSet();
  const texMs = performance.now() - t0;
  const renderer = new IsoRenderer(app, callbacks, tex);
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('renderDebug')) {
    (window as unknown as { __frontierRender?: unknown }).__frontierRender = { renderer, stats: renderer.stats, pages: tex.pages, texMs };
  }
  return renderer;
};
