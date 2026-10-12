import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { BuildingStatus, BuildingType } from '../../sim';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { currentObjective, newlyDone, nextUnlock, objectiveRows, type ObjectiveRow } from '../lib/objectives';

function Row({ row, fresh }: { row: ObjectiveRow; fresh: boolean }) {
  const pct = Math.round((row.progress.current / row.progress.target) * 100);
  return (
    <li className={`obj ${row.done ? 'is-done' : ''} ${fresh ? 'is-fresh' : ''} ${row.victory ? 'is-victory' : ''}`} data-testid={`objective-${row.id}`}>
      <span className="obj__check" aria-hidden="true">
        {row.done ? <Icon name="check" size={13} /> : row.victory ? <Icon name="trophy" size={14} /> : null}
      </span>
      <span className="obj__body">
        <span className="obj__title">{row.title}</span>
        <span className="obj__hint">{row.hint}</span>
        {!row.done && (
          <span className="obj__progress">
            <span className="progress progress--thin" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="obj__label">{row.progress.label}</span>
          </span>
        )}
        {row.unlocks && <span className="obj__unlock">{row.done ? 'Unlocked' : 'Unlocks'}: {row.unlocks}</span>}
      </span>
    </li>
  );
}

/** Collapsible objectives widget (bottom-left of the playfield). Completed objectives pop with a check animation. */
export function ObjectivesTracker() {
  // Only primitives and strings: the snapshot's arrays are new objects every tick, so they are reduced here.
  const input = useUiStore(
    useShallow((s) => {
      const snap = s.snapshot;
      if (!snap) return null;
      return {
        day: snap.day,
        population: snap.population,
        food: Math.floor(snap.stock.food),
        done: snap.progress.objectivesDone.join(','),
        toolsCrafted: snap.progress.toolsCrafted,
        /** "house:c,farm:s,..." (type and status) of every building. */
        buildings: snap.buildings.map((b) => `${b.type}:${b.status}`).join(','),
        happiness: Math.round(snap.settlers.reduce((a, x) => a + x.needs.happiness, 0) / Math.max(1, snap.settlers.length)),
        settlers: snap.settlers.length,
      };
    }),
  );
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  const rows = useMemo(
    () =>
      input
        ? objectiveRows({
            day: input.day,
            population: input.population,
            stock: { food: input.food },
            progress: { objectivesDone: input.done ? input.done.split(',') : [], toolsCrafted: input.toolsCrafted },
            buildings: input.buildings
              ? input.buildings.split(',').map((x) => {
                  const [type, status] = x.split(':');
                  return { type: type as BuildingType, status: status as BuildingStatus };
                })
              : [],
            // Only the average mood is used, so one stand-in settler carries it.
            settlers: input.settlers > 0 ? [{ needs: { happiness: input.happiness } }] : [],
          })
        : [],
    [input],
  );

  // Pop the check on objectives that completed since the last render (not on the first one).
  useEffect(() => {
    const doneIds = rows.filter((r) => r.done).map((r) => r.id);
    if (seen.current === null) {
      seen.current = new Set(doneIds);
      return;
    }
    const added = newlyDone(seen.current, doneIds);
    seen.current = new Set(doneIds);
    if (added.length === 0) return;
    setFresh(new Set(added));
    const t = window.setTimeout(() => setFresh(new Set()), 3500);
    return () => window.clearTimeout(t);
  }, [rows]);

  if (!input) return null;
  const current = currentObjective(rows);
  const unlock = nextUnlock(rows);
  const doneCount = rows.filter((r) => r.done).length;

  return (
    <aside className={`objectives glass ${open ? 'is-open' : ''}`} aria-label="Objectives" data-testid="objectives">
      <button type="button" className="objectives__head" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="objectives-toggle">
        <Icon name="flag" size={16} className="objectives__icon" />
        <span className="objectives__summary">
          {current ? (
            <>
              <span className="objectives__current" data-testid="objective-current">
                {current.title}
              </span>
              <span className="objectives__sub">
                {current.hint} {current.progress.label}
              </span>
            </>
          ) : (
            <span className="objectives__current">All objectives complete</span>
          )}
        </span>
        <span className="objectives__count">
          {doneCount}/{rows.length}
        </span>
        <Icon name="chevron" size={14} className="objectives__chev" />
      </button>
      {open && (
        <div className="objectives__body">
          <ul className="obj-list">
            {rows.map((r) => (
              <Row key={r.id} row={r} fresh={fresh.has(r.id)} />
            ))}
          </ul>
          {unlock && (
            <p className="objectives__next" data-testid="objectives-next-unlock">
              <Icon name="lock" size={13} /> Next unlock: <strong>{unlock.unlocks}</strong> ({unlock.title})
            </p>
          )}
        </div>
      )}
      {!open && fresh.size > 0 && (
        <div className="objectives__toast" role="status">
          <Icon name="good" size={14} /> Objective complete!
        </div>
      )}
    </aside>
  );
}
