import { useMemo } from 'react';
import { BUILDING_DEFS, type BuildingType } from '../../sim';
import { useGameController } from '../../game';
import { useUiStore } from '../../store';
import { BuildingIcon } from '../components/BuildingIcon';
import { CostChips } from '../components/CostChips';
import { Icon } from '../components/Icon';
import { checkPlacement } from '../lib/placement';

/** Shown in build mode: what is being placed, the controls, and the live reason for the hovered tile. */
export function PlacementBar() {
  const type = useUiStore((s) => s.buildMode);
  if (!type) return null;
  return <PlacementBarInner type={type} />;
}

function PlacementBarInner({ type }: { type: BuildingType }) {
  const controller = useGameController();
  const hover = useUiStore((s) => s.hoverTile);
  const stock = useUiStore((s) => s.snapshot?.available ?? null);
  const tick = useUiStore((s) => s.snapshot?.tick ?? 0);
  const setBuildMode = useUiStore((s) => s.setBuildMode);
  const def = BUILDING_DEFS[type];
  // Re-evaluated when the hovered tile, the stock or the sim tick changes.
  const hint = useMemo(() => checkPlacement(controller.getState(), type, hover), [controller, type, hover?.x, hover?.y, tick]);
  return (
    <div className="placement-bar glass" role="status" data-testid="placement-bar">
      <BuildingIcon type={type} size={34} />
      <div className="placement-bar__text">
        <div className="placement-bar__title">
          Placing {def.name} <CostChips cost={def.cost} stock={stock} size="sm" />
        </div>
        <div className="placement-bar__keys">
          <span className="kbd">Left-click</span> place · <span className="kbd">Right-click</span> / <span className="kbd">Esc</span> cancel
        </div>
        <div className={`placement-bar__hint placement-bar__hint--${hint.tone}`} data-testid="placement-hint">
          <Icon name={hint.tone === 'good' ? 'good' : hint.tone === 'bad' ? 'danger' : 'info'} size={14} /> {hint.text}
        </div>
      </div>
      <button type="button" className="btn small ghost icon-only" onClick={() => setBuildMode(null)} aria-label="Cancel placement" data-testid="placement-cancel">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
