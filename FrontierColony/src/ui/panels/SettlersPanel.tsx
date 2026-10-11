import { memo, useMemo, useState } from 'react';
import { useGameController } from '../../game';
import { useUiStore, type SettlerSummary } from '../../store';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import {
  NEED_COLOR,
  NEED_LABEL,
  NEED_ORDER,
  MOOD_EFFECT,
  MOOD_ICON,
  MOOD_LABEL,
  arrangeRoster,
  moodBand,
  needLevel,
  needWarning,
  type RosterFilter,
  type RosterSort,
} from '../lib/settlerInfo';

const FILTERS: { id: RosterFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'idle', label: 'Idle' },
];
const SORTS: { id: RosterSort; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'mood', label: 'Mood' },
  { id: 'needs', label: 'Lowest need' },
];

interface RowProps {
  settler: SettlerSummary;
  selected: boolean;
  onPick: (s: SettlerSummary) => void;
}

const Row = memo(
  function Row({ settler, selected, onPick }: RowProps) {
    const warning = needWarning(settler.needs);
    const band = moodBand(settler.needs.happiness);
    return (
      <li>
        <button type="button" className={`roster-row ${selected ? 'is-selected' : ''}`} onClick={() => onPick(settler)} data-testid={`settler-row-${settler.id}`} aria-pressed={selected}>
          <Avatar appearance={settler.appearance} size={38} />
          <span className="roster-row__main">
            <span className="roster-row__name">{settler.name}</span>
            <span className="roster-row__activity">{settler.activity.label}</span>
            {warning ? (
              <span className={`roster-row__warn roster-row__warn--${warning.level}`}>
                <Icon name={warning.level === 'critical' ? 'danger' : 'warning'} size={12} /> {warning.text}
                {settler.sick ? ' · Sick' : ''}
              </span>
            ) : settler.sick ? (
              <span className="roster-row__warn roster-row__warn--low">
                <Icon name="warning" size={12} /> Sick
              </span>
            ) : null}
          </span>
          <span className="roster-row__bars" aria-hidden="true">
            {NEED_ORDER.map((n) => (
              <span key={n} className={`mini-bar mini-bar--${needLevel(settler.needs[n])}`} style={{ ['--need-color' as string]: NEED_COLOR[n] }} title={`${NEED_LABEL[n]} ${Math.round(settler.needs[n])}`}>
                <span style={{ height: `${Math.max(4, Math.min(100, settler.needs[n]))}%` }} />
              </span>
            ))}
          </span>
          <Tooltip title={MOOD_LABEL[band]} content={`${MOOD_EFFECT[band]} Happiness ${Math.round(settler.needs.happiness)}.`} side="left">
            <span className="roster-row__mood" aria-label={`Mood: ${MOOD_LABEL[band]}`}>
              <Icon name={MOOD_ICON[band]} size={22} />
            </span>
          </Tooltip>
        </button>
      </li>
    );
  },
  (a, b) =>
    a.selected === b.selected &&
    a.onPick === b.onPick &&
    a.settler.id === b.settler.id &&
    a.settler.name === b.settler.name &&
    a.settler.activity.label === b.settler.activity.label &&
    a.settler.sick === b.settler.sick &&
    NEED_ORDER.every((n) => Math.round(a.settler.needs[n]) === Math.round(b.settler.needs[n])),
);

/** Settler roster: avatar, activity, need bars and mood per settler; click to select and centre the camera. */
export function SettlersPanel() {
  const controller = useGameController();
  const settlers = useUiStore((s) => s.snapshot?.settlers);
  const selectedId = useUiStore((s) => (s.selection?.kind === 'settler' ? s.selection.id : null));
  const select = useUiStore((s) => s.select);
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [sort, setSort] = useState<RosterSort>('name');

  const rows = useMemo(() => arrangeRoster(settlers ?? [], filter, sort), [settlers, filter, sort]);
  const attention = useMemo(() => (settlers ?? []).filter((s) => needWarning(s.needs) !== null || s.sick).length, [settlers]);

  const pick = useMemoPick(controller, select);

  return (
    <div className="roster" data-testid="settlers-panel">
      <div className="roster__controls">
        <div className="seg" role="group" aria-label="Filter settlers">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`seg__btn ${filter === f.id ? 'is-active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'attention' && attention > 0 && <span className="seg__badge">{attention}</span>}
            </button>
          ))}
        </div>
        <label className="roster__sort">
          <span>Sort</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as RosterSort)} data-testid="roster-sort">
            {SORTS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="muted roster__empty">{settlers && settlers.length > 0 ? 'Nobody matches this filter.' : 'No settlers yet.'}</p>
      ) : (
        <ul className="roster__list">
          {rows.map((s) => (
            <Row key={s.id} settler={s} selected={selectedId === s.id} onPick={pick} />
          ))}
        </ul>
      )}
    </div>
  );
}

function useMemoPick(controller: ReturnType<typeof useGameController>, select: (s: { kind: 'settler'; id: number }) => void) {
  return useMemo(
    () => (s: SettlerSummary) => {
      select({ kind: 'settler', id: s.id });
      controller.centerOn(s.pos);
    },
    [controller, select],
  );
}
