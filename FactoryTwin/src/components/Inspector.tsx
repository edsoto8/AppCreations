import { useEffect, useState } from 'react';
import type { EntityDetail } from '../simulation/types';
import { useUi } from '../store';
import { runtime } from '../rendering/runtime';
import { formatTime } from '../simulation/clock';
import { STATE_COLORS } from './Legend';

/** Details of the selected entity, refreshed twice per second from the host (not per frame). */
export function Inspector() {
  const selection = useUi((s) => s.selection);
  const select = useUi((s) => s.select);
  const setCameraMode = useUi((s) => s.setCameraMode);
  const [detail, setDetail] = useState<EntityDetail | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rt = runtime.current;
      if (!rt || !selection) {
        setDetail(null);
        return;
      }
      const d = await rt.host.getDetail(selection);
      if (alive) setDetail(d);
    };
    void load();
    const id = setInterval(load, 500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selection]);

  if (!selection) {
    return (
      <div className="pad muted" data-testid="inspector-empty">
        Click any machine, conveyor, worker, vehicle, pallet, rack or product in the 3D view to inspect it. Hover shows a tooltip.
      </div>
    );
  }
  if (!detail) return <div className="pad muted">{selection.kind} {selection.id} is no longer in the factory.</div>;
  const status = detail.fields.find((f) => f.label === 'Status')?.value;
  const followable = ['product', 'worker', 'vehicle', 'pallet'].includes(detail.kind);
  return (
    <div className="inspector" data-testid="inspector">
      <div className="insp-head">
        <div>
          <div className="kind">{detail.kind}</div>
          <h2>{detail.title}</h2>
        </div>
        {status && (
          <span className="pill" style={{ background: STATE_COLORS[status] ?? '#334155' }}>
            {status}
          </span>
        )}
      </div>
      <div className="row gap">
        <button className="btn small" onClick={() => setCameraMode('focus')}>
          Focus
        </button>
        {followable && (
          <button className="btn small" onClick={() => setCameraMode('follow')}>
            Follow
          </button>
        )}
        <button className="btn small" onClick={() => select(null)}>
          Clear
        </button>
      </div>
      <table className="kv">
        <tbody>
          {detail.fields.map((f) => (
            <tr key={f.label}>
              <th>{f.label}</th>
              <td>{f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.history.length > 0 && (
        <>
          <h3>{detail.kind === 'product' ? 'Lifecycle' : detail.kind === 'station' ? 'Maintenance & history' : 'History'}</h3>
          <ol className="history">
            {[...detail.history].reverse().map((h, i) => (
              <li key={i}>
                <span className="t">{formatTime(h.t)}</span> {h.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
