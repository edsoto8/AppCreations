import { RESOURCE_TYPES, type ResourceAmounts, type ResourceCost } from '../../sim';
import { Icon } from './Icon';
import { RESOURCE_LABEL } from '../lib/tooltipText';

/** Resource cost as icon + amount chips. Chips the colony cannot afford turn red. */
export function CostChips({ cost, stock, size = 'md' }: { cost: ResourceCost; stock?: ResourceAmounts | null; size?: 'sm' | 'md' }) {
  const entries = RESOURCE_TYPES.filter((r) => (cost[r] ?? 0) > 0);
  if (entries.length === 0) return <span className="muted">Free</span>;
  return (
    <span className={`cost-chips cost-chips--${size}`}>
      {entries.map((r) => {
        const need = cost[r] ?? 0;
        const short = stock ? stock[r] < need : false;
        return (
          <span key={r} className={`cost-chip ${short ? 'is-short' : ''}`} title={short ? `Need ${Math.ceil(need - (stock?.[r] ?? 0))} more ${RESOURCE_LABEL[r].toLowerCase()}` : RESOURCE_LABEL[r]}>
            <Icon name={r} size={size === 'sm' ? 14 : 16} />
            {need}
          </span>
        );
      })}
    </span>
  );
}
