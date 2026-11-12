import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import type { LogEntry } from '../sim/Simulation';
import { fmtClock } from './format';
import { Icon, type IconName } from './icons';

type Level = LogEntry['level'];
type Filter = 'all' | Level;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'OK' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const LEVEL_ICON: Record<Level, IconName> = { info: 'info', success: 'check', warn: 'alert', error: 'alert' };

export const EventLog = memo(function EventLog() {
  const logs = useStore((s) => s.logs);
  const [filter, setFilter] = useState<Filter>('all');
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const shown = filter === 'all' ? logs : logs.filter((l) => l.level === filter);
  const counts = { warn: 0, error: 0 };
  for (const l of logs) if (l.level === 'warn' || l.level === 'error') counts[l.level]++;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <section className="log-panel" data-testid="log-panel" aria-label="Event log">
      <header className="log-head">
        <Icon name="list" size={14} />
        <h4>Event log</h4>
        <div className="log-filters" role="radiogroup" aria-label="Filter log by level">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              className={`log-filter lvl-${f.value} ${filter === f.value ? 'on' : ''}`}
              onClick={() => setFilter(f.value)}
              data-testid={`log-filter-${f.value}`}
            >
              {f.label}
              {(f.value === 'warn' || f.value === 'error') && counts[f.value] > 0 && <span className="count">{counts[f.value]}</span>}
            </button>
          ))}
        </div>
      </header>
      <ol
        className="log-list"
        ref={listRef}
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {shown.length === 0 && <li className="log-empty">No {filter === 'all' ? '' : `${filter} `}events yet</li>}
        {shown.map((l) => (
          <li key={l.id} className={`log-row lvl-${l.level}`}>
            <span className="log-time">{fmtClock(l.time)}</span>
            <Icon name={LEVEL_ICON[l.level]} size={12} className="log-icon" />
            <span className="log-msg">{l.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
});

interface ToastItem {
  id: number;
  text: string;
  level: Level;
  leaving: boolean;
}

/** Toast stack fed by store.toast; each toast auto-dismisses after 4 s. */
export const Toasts = memo(function Toasts() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number[]>());

  useEffect(() => {
    if (!toast) return;
    const { id, text, level } = toast;
    setItems((cur) => {
      if (cur.some((t) => t.id === id)) return cur;
      // Collapse an identical message that is already showing.
      const rest = cur.filter((t) => t.text !== text);
      return [...rest, { id, text, level, leaving: false }].slice(-4);
    });
    const leave = window.setTimeout(() => setItems((cur) => cur.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3700);
    const remove = window.setTimeout(() => {
      setItems((cur) => cur.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 4000);
    timers.current.set(id, [leave, remove]);
  }, [toast]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((ts) => ts.forEach((t) => clearTimeout(t)));
  }, []);

  const dismiss = (id: number) => setItems((cur) => cur.filter((t) => t.id !== id));

  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast lvl-${t.level} ${t.leaving ? 'leaving' : ''}`} role={t.level === 'error' ? 'alert' : 'status'}>
          <Icon name={LEVEL_ICON[t.level]} size={15} />
          <span>{t.text}</span>
          <button type="button" className="toast-x" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
});
