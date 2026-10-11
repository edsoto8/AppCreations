import { useEffect, useMemo, useRef } from 'react';
import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { describeTile } from '../lib/tileInfo';
import { useUiScale } from '../lib/usePrefsSync';

/**
 * Small floating card near the cursor describing the hovered tile (terrain, resource left, building,
 * settlers). Never takes pointer events. The position is written straight to the DOM, so moving the
 * mouse does not re-render React.
 */
export function HoverCard() {
  const tile = useUiStore((s) => s.hoverTile);
  const buildMode = useUiStore((s) => s.buildMode);
  const snapshot = useUiStore((s) => s.snapshot);
  const controller = useGameController();
  const scale = useUiScale();
  const ref = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, overCanvas: false });

  useEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const { x, y, overCanvas } = pointer.current;
      el.style.visibility = overCanvas ? 'visible' : 'hidden';
      const w = el.offsetWidth * scale;
      const h = el.offsetHeight * scale;
      const left = x + 18 + w > window.innerWidth - 8 ? x - 18 - w : x + 18;
      const top = Math.max(8, Math.min(y + 14, window.innerHeight - h - 8));
      el.style.transform = `translate(${Math.max(8, left)}px, ${top}px) scale(${scale})`;
    };
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, overCanvas: e.target instanceof HTMLCanvasElement };
      place();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    place();
    return () => window.removeEventListener('pointermove', onMove);
  });

  const card = useMemo(
    () => (tile && snapshot ? describeTile(controller.getState(), tile, snapshot.settlers, snapshot.buildings) : null),
    [tile, snapshot, controller],
  );
  if (!card || buildMode) return null;

  return (
    <div ref={ref} className="hover-card" style={{ visibility: 'hidden' }} data-testid="hover-card" aria-hidden="true">
      <div className="hover-card__title">
        {card.building ?? card.terrain}
        <span className="hover-card__coord">
          {tile?.x}, {tile?.y}
        </span>
      </div>
      {card.building && <div className="hover-card__line">{card.buildingStatus ?? `On ${card.terrain.toLowerCase()}`}</div>}
      {card.resource && <div className="hover-card__line hover-card__line--res">{card.resource}</div>}
      {card.elevation > 0 && !card.building && <div className="hover-card__line hover-card__line--dim">Height {card.elevation}</div>}
      {card.settlers.map((s) => (
        <div key={s} className="hover-card__line hover-card__line--settler">
          {s}
        </div>
      ))}
    </div>
  );
}
