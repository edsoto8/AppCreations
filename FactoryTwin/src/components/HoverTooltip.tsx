import { useUi } from '../store';

export function HoverTooltip() {
  const hover = useUi((s) => s.hover);
  if (!hover) return null;
  return (
    <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
      {hover.label}
    </div>
  );
}
