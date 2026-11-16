import { useEffect, useState } from 'react';
import { perfStats } from '../rendering/perfStats';
import { runtime } from '../rendering/runtime';

export const DRAW_CALL_BUDGET = 400;

export function PerfOverlay() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  const rt = runtime.current;
  const f = (rt?.host as { factory?: { engine: { processed: number; pending: number } } } | undefined)?.factory;
  return (
    <div className="perf" data-testid="perf">
      <div>
        <b>{perfStats.fps.toFixed(0)}</b> fps
      </div>
      <div className={perfStats.calls > DRAW_CALL_BUDGET ? 'bad' : ''}>
        {perfStats.calls} draw calls <span className="muted">/ {DRAW_CALL_BUDGET}</span>
      </div>
      <div>{(perfStats.triangles / 1000).toFixed(0)}k triangles</div>
      <div>
        {perfStats.geometries} geo · {perfStats.textures} tex
      </div>
      {f && (
        <div>
          {f.engine.processed.toLocaleString()} events · {f.engine.pending} pending
        </div>
      )}
    </div>
  );
}
