import { useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { JOB_CATEGORIES, type JobCategory, type PriorityLevel } from '../../sim';
import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { pluralize } from '../lib/format';
import { DEFAULT_PRIORITY, JOB_INFO, PRIORITY_LABEL, PRIORITY_LEVELS, PRIORITY_TOOLTIP, countByJob, stepLevel } from '../lib/jobs';

function LevelControl({ category, level, onSet }: { category: JobCategory; level: PriorityLevel; onSet: (l: PriorityLevel) => void }) {
  const refs = useRef<Record<number, HTMLButtonElement | null>>({});
  const move = (delta: -1 | 1) => {
    const next = stepLevel(level, delta);
    if (next !== level) {
      onSet(next);
      refs.current[next]?.focus();
    }
  };
  return (
    <div
      className="levels"
      role="radiogroup"
      aria-label={`${JOB_INFO[category].label} priority`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {PRIORITY_LEVELS.map((l) => (
        <button
          key={l}
          ref={(el) => {
            refs.current[l] = el;
          }}
          type="button"
          role="radio"
          aria-checked={level === l}
          tabIndex={level === l ? 0 : -1}
          className={`level level--${l} ${level === l ? 'is-active' : ''}`}
          onClick={() => onSet(l)}
          title={PRIORITY_LABEL[l]}
          data-testid={`priority-${category}-${l}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Job priorities: 0 (never) to 3 (high) per category, applied instantly via `setPriority`. */
export function PrioritiesPanel() {
  const controller = useGameController();
  const priorities = useUiStore((s) => s.snapshot?.priorities);
  const counts = useUiStore(useShallow((s) => countByJob(s.snapshot?.settlers ?? [])));
  const set = (category: JobCategory, level: PriorityLevel) => {
    controller.dispatch({ type: 'setPriority', category, level });
  };
  const allNormal = priorities ? JOB_CATEGORIES.every((c) => priorities[c] === DEFAULT_PRIORITY) : true;

  return (
    <div className="priorities" data-testid="priorities-panel">
      <p className="muted priorities__intro">
        {PRIORITY_TOOLTIP}
      </p>
      <div className="priorities__head" aria-hidden="true">
        <span>Job</span>
        <span className="priorities__legend">
          {PRIORITY_LEVELS.map((l) => (
            <span key={l}>{PRIORITY_LABEL[l]}</span>
          ))}
        </span>
      </div>
      <ul className="priorities__list">
        {JOB_CATEGORIES.map((c) => {
          const info = JOB_INFO[c];
          const level = priorities?.[c] ?? DEFAULT_PRIORITY;
          return (
            <li key={c} className={`job ${level === 0 ? 'is-off' : ''}`} data-testid={`job-${c}`}>
              <span className="job__icon">
                <Icon name={info.icon} size={22} />
              </span>
              <span className="job__name">
                {info.label}
                <Tooltip content={counts[c] > 0 ? `${pluralize(counts[c], 'settler')} doing this right now.` : 'Nobody is doing this right now.'} side="top">
                <span className={`job__count ${counts[c] > 0 ? 'is-busy' : ''}`} tabIndex={0} data-testid={`job-count-${c}`} aria-label={`${counts[c]} working`}>
                  <Icon name="settlers" size={13} /> {counts[c]}
                </span>
                </Tooltip>
              </span>
              <LevelControl category={c} level={level} onSet={(l) => set(c, l)} />
              <span className="job__desc">{info.description}</span>
            </li>
          );
        })}
      </ul>
      <div className="priorities__foot">
        <button
          type="button"
          className="btn small ghost"
          disabled={allNormal}
          onClick={() => JOB_CATEGORIES.forEach((c) => priorities && priorities[c] !== DEFAULT_PRIORITY && set(c, DEFAULT_PRIORITY))}
          data-testid="priorities-reset"
        >
          Reset all to Normal
        </button>
      </div>
    </div>
  );
}
