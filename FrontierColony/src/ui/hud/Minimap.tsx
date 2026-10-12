import { useCallback, useEffect, useRef } from 'react';
import { MAX_ELEVATION, type WorldState } from '../../sim';
import { useGameController } from '../../game';
import { uiStore, useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { minimapToTile, terrainPixels, tileToMinimap, viewportCorners } from '../lib/minimap';

/** Drawn size in CSS pixels. */
export const MINIMAP_SIZE = 156;

interface BaseImage {
  world: WorldState;
  revision: number;
  canvas: HTMLCanvasElement;
}

function buildBase(world: WorldState): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = world.width;
  canvas.height = world.height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const data = terrainPixels(world.terrain, world.elevation, MAX_ELEVATION);
    ctx.putImageData(new ImageData(data, world.width, world.height), 0, 0);
  }
  return canvas;
}

/**
 * Corner minimap on a 2D canvas. The terrain image is rebuilt only when the world or its revision
 * changes; buildings, settlers and the camera rectangle are redrawn about 20 times a second straight
 * from the store snapshot and the camera (no React re-render). Click or drag to move the camera.
 */
export function Minimap() {
  const controller = useGameController();
  const open = useUiStore((s) => s.prefs.minimapOpen);
  const setPrefs = useUiStore((s) => s.setPrefs);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const base = useRef<BaseImage | null>(null);
  const dragging = useRef(false);
  const lastPan = useRef(0);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(MINIMAP_SIZE * dpr);
    canvas.height = Math.round(MINIMAP_SIZE * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    // Looked up once and again only if React replaced it.
    let view: HTMLCanvasElement | null = null;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 50) return;
      last = now;
      const state = controller.getState();
      const world = state.world;
      if (!base.current || base.current.world !== world || base.current.revision !== world.revision) {
        base.current = { world, revision: world.revision, canvas: buildBase(world) };
      }
      const S = MINIMAP_SIZE;
      const N = world.width;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(base.current.canvas, 0, 0, S, S);

      const snap = uiStore.getState().snapshot;
      if (snap) {
        const k = S / N;
        for (const b of snap.buildings) {
          const p = tileToMinimap(b.origin.x, b.origin.y, N, S);
          ctx.fillStyle = b.status === 'construction' ? 'rgba(248,205,120,0.55)' : '#e8ae4d';
          ctx.fillRect(p.x, p.y, Math.max(2, b.footprint.w * k), Math.max(2, b.footprint.h * k));
          ctx.strokeStyle = 'rgba(30,18,8,0.8)';
          ctx.lineWidth = 0.75;
          ctx.strokeRect(p.x + 0.4, p.y + 0.4, Math.max(2, b.footprint.w * k) - 0.8, Math.max(2, b.footprint.h * k) - 0.8);
        }
        ctx.fillStyle = '#fff6e0';
        for (const s of snap.settlers) {
          const p = tileToMinimap(s.pos.x, s.pos.y, N, S);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const cam = controller.getCamera();
      if (!view || !view.isConnected) view = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
      if (cam && view) {
        const corners = viewportCorners(cam, view.clientWidth, view.clientHeight).map((c) => tileToMinimap(c.x, c.y, N, S));
        ctx.beginPath();
        corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,240,200,0.12)';
        ctx.fill();
        ctx.strokeStyle = '#fff2cc';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, controller]);

  const pan = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const size = controller.getState().world.width;
      // Rect is the visual (possibly UI-scaled) size, so normalise to MINIMAP_SIZE.
      const px = ((e.clientX - rect.left) / rect.width) * MINIMAP_SIZE;
      const py = ((e.clientY - rect.top) / rect.height) * MINIMAP_SIZE;
      const tile = minimapToTile(px, py, size, MINIMAP_SIZE);
      controller.centerOn({ x: tile.x + 0.5, y: tile.y + 0.5 });
    },
    [controller],
  );

  return (
    <section className={`minimap glass ${open ? 'is-open' : ''}`} aria-label="Minimap" data-testid="minimap">
      <header className="minimap__head">
        <button type="button" className="minimap__toggle" aria-expanded={open} onClick={() => setPrefs({ minimapOpen: !open })} data-testid="minimap-toggle">
          <Icon name="compass" size={15} />
          <span>Map</span>
          <Icon name="chevron" size={12} className="minimap__chev" />
        </button>
        {open && (
          <span className="minimap__zoom">
            <Tooltip content="Zoom out" side="top">
              <button type="button" className="btn ghost icon-only small" aria-label="Zoom out" onClick={() => controller.zoomBy(1 / 1.25)} data-testid="minimap-zoom-out">
                <span aria-hidden="true">&minus;</span>
              </button>
            </Tooltip>
            <Tooltip content="Zoom in" side="top">
              <button type="button" className="btn ghost icon-only small" aria-label="Zoom in" onClick={() => controller.zoomBy(1.25)} data-testid="minimap-zoom-in">
                <span aria-hidden="true">+</span>
              </button>
            </Tooltip>
          </span>
        )}
      </header>
      {open && (
        <canvas
          ref={canvasRef}
          className="minimap__canvas"
          style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }}
          role="img"
          aria-label="Minimap of the colony. Click or drag to move the camera."
          data-testid="minimap-canvas"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pan(e);
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            const now = performance.now();
            if (now - lastPan.current < 60) return;
            lastPan.current = now;
            pan(e);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        />
      )}
    </section>
  );
}
