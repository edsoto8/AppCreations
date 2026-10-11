import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ResourceType } from '../../sim';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import {
  daysOfSupply,
  formatAmount,
  formatDays,
  formatRate,
  quantizeRate,
  stockLevel,
  type StockLevel,
} from '../lib/format';
import { RESOURCE_LABEL, RESOURCE_TOOLTIP } from '../lib/tooltipText';

/** Drop the leading "Wood: " (the tooltip title already says it) and capitalise what is left. */
function describe(text: string): string {
  const body = text.replace(/^[^:]+:\s*/, '');
  return body.charAt(0).toUpperCase() + body.slice(1);
}

interface ChipData {
  amount: number;
  cap: number;
  rate: number;
  population: number;
  toolsInUse: number;
}

/** One resource: icon, amount / capacity, per-day net rate and a fill bar. Re-renders only when the shown values change. */
export const ResourceChip = memo(function ResourceChip({ resource }: { resource: ResourceType }) {
  const data = useUiStore(
    useShallow((s): ChipData | null => {
      const snap = s.snapshot;
      if (!snap) return null;
      let toolsInUse = 0;
      if (resource === 'tools') for (const st of snap.settlers) if (st.hasTool) toolsInUse++;
      return {
        amount: Math.floor(snap.stock[resource]),
        cap: snap.storageCapacity,
        rate: quantizeRate(snap.rates[resource]),
        population: snap.population,
        toolsInUse,
      };
    }),
  );
  if (!data) return null;

  const rate = formatRate(data.rate);
  const consumable = resource === 'food' || resource === 'water';
  const level: StockLevel = consumable ? stockLevel(data.amount, data.population) : 'ok';
  const full = data.cap > 0 && data.amount >= data.cap * 0.95;
  const fill = data.cap > 0 ? Math.min(1, data.amount / data.cap) : 0;
  const days = consumable ? daysOfSupply(data.amount, data.population) : null;

  const tooltip = (
    <>
      <p>{describe(RESOURCE_TOOLTIP[resource])}</p>
      <dl className="tt-stats">
        <dt>Stored</dt>
        <dd>
          {data.amount} / {data.cap}
        </dd>
        <dt>Net per day</dt>
        <dd className={`rate rate--${rate.trend}`}>{rate.text}</dd>
        {days !== null && (
          <>
            <dt>Supply</dt>
            <dd>{formatDays(days)} for {data.population}</dd>
          </>
        )}
        {resource === 'tools' && (
          <>
            <dt>In use</dt>
            <dd>{data.toolsInUse} held by settlers</dd>
          </>
        )}
      </dl>
      {level === 'out' && <p className="tt-alert tt-alert--danger">Out of stock!</p>}
      {level === 'low' && <p className="tt-alert tt-alert--warning">Less than a day of supply left.</p>}
      {full && <p className="tt-alert tt-alert--warning">Storage nearly full. Build a storage shed to hold more.</p>}
    </>
  );

  return (
    <Tooltip title={RESOURCE_LABEL[resource]} content={tooltip} side="bottom">
      <div
        className={`chip chip--${resource} ${level !== 'ok' ? `chip--${level}` : ''} ${full ? 'chip--full' : ''}`}
        data-testid={`resource-${resource}`}
        tabIndex={0}
        role="group"
        aria-label={`${RESOURCE_LABEL[resource]}: ${data.amount} of ${data.cap}, ${rate.text} per day`}
      >
        <Icon name={resource} className="chip__icon" />
        <div className="chip__text">
          <div className="chip__main">
            <span className="chip__amount">{formatAmount(data.amount)}</span>
            <span className="chip__cap">/{data.cap}</span>
          </div>
          <div className={`chip__rate rate rate--${rate.trend}`}>
            {rate.text}
            <span className="chip__unit">/day</span>
          </div>
        </div>
        <span className="chip__bar" aria-hidden="true">
          <span className="chip__fill" style={{ transform: `scaleX(${fill})` }} />
        </span>
      </div>
    </Tooltip>
  );
});
