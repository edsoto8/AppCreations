import { useMemo } from 'react';
import { RESOURCE_TYPES } from '../../sim';
import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { Icon, type IconName } from '../components/Icon';
import { RESOURCE_LABEL } from '../lib/tooltipText';
import { seriesFor, sparklinePoints, spanLabel, type HistorySample, type SeriesKey } from '../lib/statsSeries';

const KEYS: SeriesKey[] = ['population', ...RESOURCE_TYPES];
const LABEL: Record<SeriesKey, string> = { population: 'Settlers', ...RESOURCE_LABEL };
const ICON: Record<SeriesKey, IconName> = { population: 'people', wood: 'wood', stone: 'stone', food: 'food', water: 'water', tools: 'tools' };
const COLOR: Record<SeriesKey, string> = {
  population: 'var(--c-people)',
  wood: 'var(--c-wood)',
  stone: 'var(--c-stone)',
  food: 'var(--c-food)',
  water: 'var(--c-water)',
  tools: 'var(--c-tools)',
};
const W = 300;
const H = 56;

function SparkCard({ history, k }: { history: readonly HistorySample[]; k: SeriesKey }) {
  const s = seriesFor(history, k);
  const points = sparklinePoints(s.values, W, H, 2, k !== 'population');
  const area = points ? `${points} ${W - 2},${H} 2,${H}` : '';
  const sign = s.delta > 0 ? '+' : s.delta < 0 ? '−' : '';
  return (
    <li className="spark" data-testid={`stat-${k}`}>
      <div className="spark__head">
        <Icon name={ICON[k]} size={16} />
        <span className="spark__name">{LABEL[k]}</span>
        <span className="spark__last">{Math.floor(s.last)}</span>
        <span className={`spark__delta ${s.delta > 0 ? 'is-up' : s.delta < 0 ? 'is-down' : ''}`}>
          {sign}
          {Math.abs(Math.round(s.delta))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spark__svg" role="img" aria-label={`${LABEL[k]} over time`}>
        {area && <polygon points={area} fill={COLOR[k]} opacity=".14" />}
        {points && <polyline points={points} fill="none" stroke={COLOR[k]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="spark__range">
        <span>min {Math.floor(s.min)}</span>
        <span>max {Math.floor(s.max)}</span>
      </div>
    </li>
  );
}

/** Population and stock over the last three in-game days, as inline SVG sparklines (no chart library). */
export function StatsPanel() {
  const controller = useGameController();
  // One sample is added per in-game hour, so re-read the history once an hour.
  const hourKey = useUiStore((s) => (s.snapshot ? s.snapshot.day * 24 + Math.floor(s.snapshot.timeOfDay) : -1));
  const history = useMemo<HistorySample[]>(
    () =>
      controller.getState().stats.history.map((h) => ({ tick: h.tick, day: h.day, timeOfDay: h.timeOfDay, stock: { ...h.stock }, population: h.population })),
    [controller, hourKey],
  );
  return (
    <div className="stats" data-testid="stats-panel">
      <p className="muted">{spanLabel(history.length)}. One sample per in-game hour.</p>
      {history.length < 2 ? (
        <p className="muted stats__empty">Charts appear after the first couple of hours.</p>
      ) : (
        <ul className="spark-list">
          {KEYS.map((k) => (
            <SparkCard key={k} history={history} k={k} />
          ))}
        </ul>
      )}
    </div>
  );
}
