import { useShallow } from 'zustand/react/shallow';
import { BUILDING_DEFS, BUILDING_TYPES, type BuildingDef, type BuildingType } from '../../sim';
import { useUiStore } from '../../store';
import { BuildingIcon } from '../components/BuildingIcon';
import { CostChips } from '../components/CostChips';
import { Icon, type IconName } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { RESOURCE_LABEL } from '../lib/tooltipText';
import { placementRule, unlockText } from '../lib/placement';
import { pluralize } from '../lib/format';

/** Placeable building types in catalogue order (the town center is never placeable). */
export const CATALOGUE: BuildingType[] = BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].placeable);

/** One-line production summary, e.g. "4 food every 4 h" or "1 tools every 3 h (uses 3 wood, 2 stone)". */
export function productionText(def: BuildingDef): string | null {
  const p = def.production;
  if (!p) {
    if (def.jobCategory === 'woodcutting') return 'Fells nearby trees for wood';
    if (def.jobCategory === 'mining') return 'Quarries nearby hills for stone';
    return null;
  }
  const inputs = Object.entries(p.inputs)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${n} ${RESOURCE_LABEL[r as keyof typeof RESOURCE_LABEL].toLowerCase()}`);
  return `${p.amount} ${RESOURCE_LABEL[p.output].toLowerCase()} every ${p.cycleHours} h${inputs.length ? ` (uses ${inputs.join(', ')})` : ''}`;
}

function Stat({ icon, children, tip }: { icon: IconName; children: React.ReactNode; tip: string }) {
  return (
    <Tooltip content={tip} side="top">
      <span className="stat" tabIndex={0}>
        <Icon name={icon} size={14} />
        {children}
      </span>
    </Tooltip>
  );
}

/** Building catalogue: pick a building, then click the map. Shift+1..7 also pick. */
export function BuildPanel() {
  const { buildMode, stock, unlocked } = useUiStore(
    useShallow((s) => ({ buildMode: s.buildMode, stock: s.snapshot?.stock ?? null, unlocked: s.snapshot?.progress.unlocked ?? null })),
  );
  const setBuildMode = useUiStore((s) => s.setBuildMode);

  return (
    <div className="catalogue" data-testid="build-panel">
      <p className="muted catalogue__intro">Pick a building, then left-click the map to place it. Settlers haul the materials and build it.</p>
      <ul className="catalogue__list">
        {CATALOGUE.map((type, i) => {
          const def = BUILDING_DEFS[type];
          const locked = unlocked !== null && !unlocked.includes(type);
          const selected = buildMode === type;
          const production = productionText(def);
          const lockTip = unlockText(type);
          return (
            <li key={type}>
              <Tooltip title={locked ? `${def.name} (locked)` : undefined} content={locked ? (lockTip ?? 'Not unlocked yet.') : null} side="left">
                <button
                  type="button"
                  className={`build-card ${selected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
                  aria-pressed={selected}
                  aria-disabled={locked}
                  onClick={() => {
                    if (!locked) setBuildMode(selected ? null : type);
                  }}
                  data-testid={`build-${type}`}
                >
                  <span className="build-card__art">
                    <BuildingIcon type={type} size={52} />
                    {locked && (
                      <span className="build-card__lock">
                        <Icon name="lock" size={16} />
                      </span>
                    )}
                  </span>
                  <span className="build-card__body">
                    <span className="build-card__head">
                      <span className="build-card__name">{def.name}</span>
                      {i < 9 && <span className="kbd">{`⇧${i + 1}`}</span>}
                    </span>
                    <span className="build-card__desc">{def.description}</span>
                    <CostChips cost={def.cost} stock={stock} />
                    <span className="build-card__stats">
                      <Stat icon="clock" tip={`About ${def.buildHours} worker-hours of building. More builders (up to ${def.maxBuilders}) finish sooner.`}>
                        {def.buildHours} h
                      </Stat>
                      {def.maxWorkers > 0 && (
                        <Stat icon="settlers" tip={`Employs up to ${pluralize(def.maxWorkers, 'worker')}.`}>
                          {def.maxWorkers}
                        </Stat>
                      )}
                      {def.housing > 0 && (
                        <Stat icon="housing" tip={`Beds for ${def.housing} settlers.`}>
                          {def.housing} beds
                        </Stat>
                      )}
                      {def.storage > 0 && (
                        <Stat icon="food" tip={`Raises the capacity of every resource by ${def.storage}.`}>
                          +{def.storage} storage
                        </Stat>
                      )}
                      <Stat icon="compass" tip="Footprint in tiles.">
                        {def.footprint.w}x{def.footprint.h}
                      </Stat>
                    </span>
                    {production && <span className="build-card__prod">{production}</span>}
                    <span className="build-card__rule">{placementRule(type)}</span>
                    {locked && lockTip && <span className="build-card__locked-note">Locked. {lockTip}</span>}
                  </span>
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
