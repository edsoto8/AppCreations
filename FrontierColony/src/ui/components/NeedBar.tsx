import { useEffect, useRef, useState } from 'react';
import type { NeedType } from '../../sim';
import { NEED_COLOR, NEED_ICON, NEED_LABEL, NEED_TOOLTIP, needLevel, trendOf, type TrendDir } from '../lib/settlerInfo';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/** Direction a value moved over the last couple of seconds. Compares against a sample taken >= 1.5 s ago. */
export function useTrend(value: number, resetKey: unknown): TrendDir {
  const [prev, setPrev] = useState<number | null>(null);
  const sample = useRef<{ v: number; t: number; key: unknown }>({ v: value, t: performance.now(), key: resetKey });
  useEffect(() => {
    const now = performance.now();
    const s = sample.current;
    if (s.key !== resetKey) {
      sample.current = { v: value, t: now, key: resetKey };
      setPrev(null);
    } else if (now - s.t >= 1500) {
      setPrev(s.v);
      sample.current = { v: value, t: now, key: resetKey };
    }
  }, [value, resetKey]);
  return trendOf(prev, value);
}

export interface NeedBarProps {
  need: NeedType;
  value: number;
  /** Changes when the inspected settler changes, so trends reset. */
  resetKey: unknown;
}

/** Inspector row: icon, label, bar, value and a trend arrow, with the design-doc tooltip. */
export function NeedBar({ need, value, resetKey }: NeedBarProps) {
  const trend = useTrend(value, resetKey);
  const level = needLevel(value);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <Tooltip title={NEED_LABEL[need]} content={NEED_TOOLTIP[need].replace(/^[^:]+:\s*/, '')} side="left">
      <div className={`need-bar need-bar--${level}`} style={{ ['--need-color' as string]: NEED_COLOR[need] }} tabIndex={0} data-testid={`need-${need}`}>
        <Icon name={NEED_ICON[need]} size={16} className="need-bar__icon" />
        <span className="need-bar__label">{NEED_LABEL[need]}</span>
        <span className="need-bar__track" role="meter" aria-label={NEED_LABEL[need]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <span className="need-bar__fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="need-bar__value">{Math.round(value)}</span>
        <span className={`need-bar__trend need-bar__trend--${trend}`} aria-label={trend === 'flat' ? 'steady' : trend === 'up' ? 'rising' : 'falling'}>
          {trend === 'up' && <Icon name="arrowUp" size={12} />}
          {trend === 'down' && <Icon name="arrowDown" size={12} />}
          {trend === 'flat' && <span aria-hidden="true">&ndash;</span>}
        </span>
      </div>
    </Tooltip>
  );
}
