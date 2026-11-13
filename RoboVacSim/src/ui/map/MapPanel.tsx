import { memo, useEffect, useRef, useState } from 'react';
import { useStore } from '../../app/store';
import type { AppApi } from '../../app/types';
import type { Rect, Vec2 } from '../../sim/world/types';
import { useApi } from '../hooks';
import { Icon } from '../icons';
import { IconButton } from '../primitives';
import { useUi } from '../uiStore';
import { DEFAULT_LAYERS, LAYER_LABELS, MapRenderer, type MapLayers, type MapUiSnapshot } from './mapRenderer';

/** Optional controller method (present on AppController, not yet on AppApi). */

function readUi(): MapUiSnapshot {
  const s = useStore.getState();
  return { selectedRooms: s.draft.rooms, roomsMode: s.draft.kind === 'rooms', spot: s.draft.spot, tool: s.tool };
}

function rectFrom(a: Vec2, b: Vec2): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Click/drag behaviour of the map for the active tool. */
function onMapClick(api: AppApi, renderer: MapRenderer, p: Vec2): void {
  const st = useStore.getState();
  switch (st.tool) {
    case 'spot':
      st.setDraft({ spot: { x: p.x, y: p.y }, kind: 'spot' });
      st.set({ tool: 'none' });
      return;
    case 'spill':
      api.spill(st.spillKind, p.x, p.y);
      return;
    case 'addObstacle':
      api.addObstacleAt(st.obstacleKind, p.x, p.y);
      return;
    case 'addFurniture':
      api.addFurnitureAt(st.furnitureKind, p.x, p.y);
      return;
    default:
      break;
  }
  if (st.draft.kind === 'rooms' && (st.tool === 'none' || st.tool === 'select')) {
    const ri = renderer.roomAt(p);
    const room = ri >= 0 ? api.sim.layout.rooms[ri] : undefined;
    if (!room) return;
    const cur = st.draft.rooms;
    st.setDraft({ rooms: cur.includes(room.id) ? cur.filter((r) => r !== room.id) : [...cur, room.id] });
  }
}

function LayerMenu({ layers, onChange, onClose }: { layers: MapLayers; onChange: (k: keyof MapLayers, v: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-layer-trigger]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="layer-menu" ref={ref} role="menu" aria-label="Map layers">
      {LAYER_LABELS.map((l) => (
        <button key={l.key} type="button" role="menuitemcheckbox" aria-checked={layers[l.key]} className={layers[l.key] ? 'on' : ''} onClick={() => onChange(l.key, !layers[l.key])} data-testid={`map-layer-${l.key}`}>
          <span className="sw" style={{ background: l.swatch }} />
          <span>{l.label}</span>
          <span className="check">{layers[l.key] && <Icon name="check" size={12} />}</span>
        </button>
      ))}
    </div>
  );
}

const LEGEND = [
  ['#e2ecf2', 'Wall / obstacle'],
  ['#2c3c4d', 'Free (known)'],
  ['#46e0c8', 'Cleaned'],
  ['#5ad1ff', 'LiDAR'],
  ['#f5b544', 'Trail'],
] as const;

/** The robot's 2D map: canvas drawn by MapRenderer in its own rAF loop. */
export const MapPanel = memo(function MapPanel({ variant = 'card' }: { variant?: 'card' | 'sheet' }) {
  const api = useApi();
  const apiRef = useRef(api);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [menuOpen, setMenuOpen] = useState(false);
  const mapSize = useUi((s) => s.mapSize);
  const setUi = useUi((s) => s.set);
  const tool = useStore((s) => s.tool);
  const roomsMode = useStore((s) => s.draft.kind === 'rooms');

  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  // Renderer lifecycle + size tracking.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = new MapRenderer(canvas, () => apiRef.current, readUi);
    rendererRef.current = r;
    const ro = new ResizeObserver(() => {
      const box = wrap.getBoundingClientRect();
      r.resize(box.width, box.height, window.devicePixelRatio || 1);
    });
    ro.observe(wrap);
    const box = wrap.getBoundingClientRect();
    r.resize(box.width, box.height, window.devicePixelRatio || 1);
    r.start();
    return () => {
      ro.disconnect();
      r.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.layers = layers;
    r.invalidate();
  }, [layers]);

  // Pointer interaction: click (tool action / room toggle), drag (pan or zone), wheel zoom, dblclick focus.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let down: { px: number; py: number; world: Vec2 | null; moved: boolean; id: number } | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const b = canvas.getBoundingClientRect();
      return { px: e.clientX - b.left, py: e.clientY - b.top };
    };
    const zoneTool = () => {
      const t = useStore.getState().tool;
      return t === 'noGo' || t === 'noMop' ? t : null;
    };
    const describe = (w: Vec2 | null) => {
      const el = hoverRef.current;
      const r = rendererRef.current;
      const a = apiRef.current;
      if (!el) return;
      if (!w || !r || !a) {
        el.textContent = '';
        return;
      }
      const ri = r.roomAt(w);
      const room = ri >= 0 ? a.sim.layout.rooms[ri]?.name : null;
      el.textContent = `x ${w.x.toFixed(2)}  y ${w.y.toFixed(2)} m${room ? `  ·  ${room}` : ''}`;
    };
    const onDown = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r || e.button !== 0) return;
      const p = local(e);
      down = { ...p, world: r.toWorld(p.px, p.py), moved: false, id: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      const w = r.toWorld(p.px, p.py);
      r.hover = w;
      describe(w);
      if (!down || down.id !== e.pointerId) return;
      if (!down.moved && Math.hypot(p.px - down.px, p.py - down.py) > 4) down.moved = true;
      if (!down.moved) return;
      if (zoneTool() && down.world && w) r.dragRect = rectFrom(down.world, w);
      else {
        r.panBy(e.movementX, e.movementY);
        canvas.style.cursor = 'grabbing';
      }
    };
    const onUp = (e: PointerEvent) => {
      const r = rendererRef.current;
      const a = apiRef.current;
      canvas.style.cursor = '';
      if (!down || !r || down.id !== e.pointerId) return;
      const d = down;
      down = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!a) return;
      const kind = zoneTool();
      if (kind && r.dragRect) {
        const rect = r.dragRect;
        r.dragRect = null;
        if (rect.w < 0.15 || rect.h < 0.15) useStore.getState().notify('Zone too small — drag a larger rectangle', 'warn');
        else a.addZone(kind, rect);
        return;
      }
      if (!d.moved && d.world) onMapClick(a, r, d.world);
    };
    const onLeave = () => {
      const r = rendererRef.current;
      if (r) r.hover = null;
      describe(null);
    };
    const onDbl = (e: MouseEvent) => {
      const r = rendererRef.current;
      const a = apiRef.current;
      if (!r || !a) return;
      const p = local(e);
      const w = r.toWorld(p.px, p.py);
      if (w) a.focus(w.x, w.y);
    };
    const onWheel = (e: WheelEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      e.preventDefault();
      r.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, local(e));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const zoom = (f: number) => rendererRef.current?.zoomBy(f);
  const collapsed = variant === 'card' && mapSize === 'collapsed';
  const hint =
    tool === 'spot'
      ? 'Click to set the spot-clean location'
      : tool === 'noGo' || tool === 'noMop'
        ? 'Drag to draw a zone'
        : tool === 'spill' || tool === 'addObstacle' || tool === 'addFurniture'
          ? 'Click the floor to place'
          : roomsMode
            ? 'Click rooms to select · double-click to focus'
            : 'Drag to pan · scroll to zoom · double-click to focus 3D';

  return (
    <section className={`map-panel map-${variant} size-${variant === 'card' ? mapSize : 'sheet'} ${tool !== 'none' ? 'tool-active' : ''}`} aria-label="Robot map">
      <header className="map-head">
        <div className="map-title">
          <Icon name="map" size={14} />
          <h4>Robot map</h4>
          <span className="map-sub">built from sensors</span>
        </div>
        <div className="map-tools">
          {!collapsed && (
            <>
              <button type="button" className={`icon-btn ${menuOpen ? 'on' : ''}`} aria-label="Map layers" title="Map layers" aria-expanded={menuOpen} aria-haspopup="menu" data-layer-trigger onClick={() => setMenuOpen((v) => !v)} data-testid="map-layers-btn">
                <Icon name="layers" size={15} />
              </button>
              <IconButton icon="minus" label="Zoom out" onClick={() => zoom(1 / 1.4)} />
              <IconButton icon="plus" label="Zoom in" onClick={() => zoom(1.4)} />
              <IconButton icon="fit" label="Fit house" onClick={() => rendererRef.current?.fit()} />
            </>
          )}
          {variant === 'card' && (
            <IconButton
              icon={mapSize === 'large' ? 'shrink' : collapsed ? 'chevD' : 'expand'}
              label={mapSize === 'large' ? 'Shrink map' : collapsed ? 'Show map' : 'Enlarge map'}
              onClick={() => setUi({ mapSize: mapSize === 'normal' ? 'large' : 'normal' })}
              testId="map-size-btn"
            />
          )}
          {variant === 'card' && !collapsed && <IconButton icon="close" label="Hide map" onClick={() => setUi({ mapSize: 'collapsed' })} />}
        </div>
        {menuOpen && (
          <LayerMenu
            layers={layers}
            onChange={(k, v) => setLayers((cur) => ({ ...cur, [k]: v }))}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </header>
      <div className="map-canvas-wrap" ref={wrapRef} hidden={collapsed}>
        <canvas
          ref={canvasRef}
          data-testid="map-canvas"
          tabIndex={0}
          role="img"
          aria-label="Robot occupancy map: robot, dock, planned path, cleaned area and rooms. Use the room chips in the Mission tab for keyboard selection."
          onKeyDown={(e) => {
            const r = rendererRef.current;
            if (!r) return;
            if (e.key === '+' || e.key === '=') r.zoomBy(1.25);
            else if (e.key === '-') r.zoomBy(0.8);
            else if (e.key === '0') r.fit();
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      </div>
      {!collapsed && (
        <footer className="map-foot">
          <span className="map-hover mono" ref={hoverRef} aria-live="off" />
          <span className="map-hint">{hint}</span>
          <span className="map-legend" aria-hidden="true">
            {LEGEND.map(([c, l]) => (
              <span key={l} title={l}>
                <i style={{ background: c }} />
                {l}
              </span>
            ))}
          </span>
        </footer>
      )}
    </section>
  );
});
