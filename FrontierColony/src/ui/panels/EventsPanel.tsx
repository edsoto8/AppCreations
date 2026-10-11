import { useEffect, useMemo, useState } from 'react';
import type { LogEntry, LogSeverity } from '../../sim';
import { useGameController } from '../../game';
import { uiStore, useUiStore } from '../../store';
import { Icon, type IconName } from '../components/Icon';
import { formatClock } from '../lib/format';
import { eventTitle, EVENT_INFO } from '../lib/eventInfo';
import { filterLog, formatHoursRemaining } from '../lib/logView';

const SEVERITY_ICON: Record<LogSeverity, IconName> = { info: 'info', good: 'good', warning: 'warning', danger: 'danger' };
const FILTERS: { id: LogSeverity | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'good', label: 'Good' },
  { id: 'warning', label: 'Warnings' },
  { id: 'danger', label: 'Danger' },
  { id: 'info', label: 'Info' },
];

/** The colony chronicle: active events on top, then the log with the newest entries first. */
export function EventsPanel() {
  const controller = useGameController();
  const log = useUiStore((s) => s.snapshot?.recentLog);
  const active = useUiStore((s) => s.snapshot?.activeEvents);
  const settlers = useUiStore((s) => s.snapshot?.settlers);
  const buildings = useUiStore((s) => s.snapshot?.buildings);
  const [filter, setFilter] = useState<LogSeverity | 'all'>('all');
  // Entries newer than this id were unread when the panel opened.
  const [seenAtOpen] = useState(() => uiStore.getState().eventsSeenId ?? Number.MAX_SAFE_INTEGER);

  const newest = log && log.length > 0 ? log[log.length - 1]!.id : null;
  useEffect(() => {
    if (newest !== null) uiStore.getState().markEventsSeen(newest);
  }, [newest]);

  const rows = useMemo(() => filterLog(log ?? [], filter), [log, filter]);

  const jump = (e: LogEntry) => {
    const ui = uiStore.getState();
    if (e.settlerId !== null) {
      const s = settlers?.find((x) => x.id === e.settlerId);
      if (s) {
        ui.select({ kind: 'settler', id: s.id });
        controller.centerOn(s.pos);
        return;
      }
    }
    if (e.buildingId !== null) {
      const b = buildings?.find((x) => x.id === e.buildingId);
      if (b) {
        ui.select({ kind: 'building', id: b.id });
        controller.centerOn({ x: b.origin.x + b.footprint.w / 2, y: b.origin.y + b.footprint.h / 2 });
        return;
      }
    }
    if (e.tile) controller.centerOn({ x: e.tile.x + 0.5, y: e.tile.y + 0.5 });
  };
  const canJump = (e: LogEntry) => e.settlerId !== null || e.buildingId !== null || e.tile !== null;

  return (
    <div className="chronicle" data-testid="events-panel">
      {active && active.length > 0 && (
        <section className="chronicle__active" aria-label="Active events">
          <h3 className="section-title">Happening now</h3>
          <ul className="active-events">
            {active.map((a) => (
              <li key={a.id} className="active-event" title={(EVENT_INFO as Record<string, { effect: string }>)[a.kind]?.effect}>
                <span className="active-event__title">{eventTitle(a.kind)}</span>
                <span className="active-event__time">{formatHoursRemaining(a.hoursRemaining)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="seg" role="group" aria-label="Filter log">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`seg__btn ${filter === f.id ? 'is-active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`log-filter-${f.id}`}>
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="muted chronicle__empty">{log && log.length > 0 ? 'Nothing matches this filter.' : 'Nothing has happened yet. Give it time.'}</p>
      ) : (
        <ol className="log" data-testid="log-list">
          {rows.map((e) => (
            <li key={e.id} className={`log__entry log__entry--${e.severity} ${e.id > seenAtOpen ? 'is-new' : ''}`} data-testid="log-entry">
              <Icon name={SEVERITY_ICON[e.severity]} size={16} className="log__icon" />
              <span className="log__msg">{e.message}</span>
              <span className="log__time">
                Day {e.day}, {formatClock(e.timeOfDay)}
              </span>
              {canJump(e) && (
                <button type="button" className="log__jump" onClick={() => jump(e)} aria-label="Show on map" title="Show on map">
                  <Icon name="crosshair" size={13} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
