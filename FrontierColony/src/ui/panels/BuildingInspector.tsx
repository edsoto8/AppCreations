import { useState } from 'react';
import { BUILDING_DEFS, RESOURCE_TYPES, type ResourceAmounts } from '../../sim';
import { useGameController } from '../../game';
import { uiStore, useUiStore, type BuildingDetail } from '../../store';
import { BuildingIcon } from '../components/BuildingIcon';
import { Icon } from '../components/Icon';
import { Panel } from '../components/Panel';
import { buildingStatus, demolishRefund } from '../lib/buildingInfo';
import { RESOURCE_LABEL } from '../lib/tooltipText';
import { productionText } from './BuildPanel';
import { useSelectedBuilding } from '../lib/useSelectedDetail';

function amountsText(a: Partial<ResourceAmounts>): string {
  const parts = RESOURCE_TYPES.filter((r) => (a[r] ?? 0) > 0).map((r) => `${Math.floor(a[r] ?? 0)} ${RESOURCE_LABEL[r].toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

/** Right-side inspector for the selected building. */
export function BuildingInspector({ id }: { id: number }) {
  const building = useSelectedBuilding(id);
  const select = useUiStore((s) => s.select);
  if (!building) return null;
  return (
    <Panel
      className="panel--inspector"
      title={building.name}
      placement="right"
      width={350}
      onClose={() => select(null)}
      testId="building-inspector"
      titleNode={
        <div className="inspector-title">
          <span className="inspector-title__icon">
            <BuildingIcon type={building.type} size={44} />
          </span>
          <div className="inspector-title__text">
            <div className="inspector-title__name" data-testid="inspector-name">
              {building.name}
            </div>
            <div className="inspector-title__sub">
              {building.footprint.w}x{building.footprint.h} tiles · at {building.origin.x}, {building.origin.y}
            </div>
          </div>
        </div>
      }
    >
      <BuildingBody building={building} />
    </Panel>
  );
}

function PersonList({ title, people, empty }: { title: string; people: { id: number; name: string }[]; empty: string }) {
  const controller = useGameController();
  const select = useUiStore((s) => s.select);
  const settlers = useUiStore((s) => s.snapshot?.settlers);
  return (
    <section className="insp-section">
      <h3 className="section-title">{title}</h3>
      {people.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="person-list">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  select({ kind: 'settler', id: p.id });
                  const s = settlers?.find((x) => x.id === p.id);
                  if (s) controller.centerOn(s.pos);
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BuildingBody({ building }: { building: BuildingDetail }) {
  const controller = useGameController();
  const season = useUiStore((s) => s.snapshot?.season ?? null);
  const [confirming, setConfirming] = useState(false);
  const def = BUILDING_DEFS[building.type];
  const status = buildingStatus(building, def.outputCap, season);
  const production = productionText(def);
  const underConstruction = building.status === 'construction' && building.construction !== null;
  const c = building.construction;
  const isTown = building.type === 'townCenter';
  const outputs = RESOURCE_TYPES.filter((r) => building.output[r] > 0);

  const run = () => {
    const result = controller.dispatch(
      underConstruction ? { type: 'cancelBuilding', buildingId: building.id } : { type: 'demolishBuilding', buildingId: building.id },
    );
    setConfirming(false);
    if (result.ok) uiStore.getState().select(null);
  };

  return (
    <div className="inspector" data-testid="building-inspector-body">
      <p className="insp-flavor">{def.description}</p>

      <section className="insp-section">
        <div className={`status-line status-line--${status.tone}`} data-testid="building-status">
          {status.text}
        </div>
        {underConstruction && c && (
          <>
            <div className="progress-row">
              <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress * 100)}>
                <span style={{ width: `${Math.round(c.progress * 100)}%` }} />
              </span>
              <span className="progress-row__pct">{Math.round(c.progress * 100)}%</span>
            </div>
            {c.kind === 'new' && (
              <div className="materials" data-testid="materials">
                {RESOURCE_TYPES.filter((r) => c.required[r] > 0).map((r) => {
                  const done = c.delivered[r] >= c.required[r];
                  return (
                    <span key={r} className={`material ${done ? 'is-done' : ''}`}>
                      <Icon name={r} size={15} />
                      {Math.floor(c.delivered[r])}/{c.required[r]}
                    </span>
                  );
                })}
                <span className="muted material__label">delivered</span>
              </div>
            )}
          </>
        )}
      </section>

      {!underConstruction && production && (
        <section className="insp-section">
          <h3 className="section-title">Production</h3>
          <p>{production}</p>
          {def.production && (
            <div className="progress-row">
              <span className="progress progress--xp" aria-hidden="true">
                <span style={{ width: `${Math.round(building.productionProgress * 100)}%` }} />
              </span>
              <span className="progress-row__pct">{Math.round(building.productionProgress * 100)}%</span>
            </div>
          )}
          {outputs.length > 0 && <p className="muted">Waiting to be hauled: {amountsText(building.output)}.</p>}
        </section>
      )}

      {(def.storage > 0 || def.housing > 0) && !underConstruction && (
        <section className="insp-section">
          <h3 className="section-title">Capacity</h3>
          <dl className="kv">
            {def.storage > 0 && (
              <>
                <dt>Storage</dt>
                <dd>+{def.storage} of every resource</dd>
              </>
            )}
            {def.housing > 0 && (
              <>
                <dt>Beds</dt>
                <dd>
                  {building.residents.length} / {def.housing}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {def.maxWorkers > 0 && (
        <PersonList
          title={underConstruction ? 'Builders' : `Workers (${building.workers.length}/${def.maxWorkers})`}
          people={building.workers}
          empty={underConstruction ? 'No builders yet.' : 'Nobody works here yet. Settlers pick jobs on their own.'}
        />
      )}
      {def.maxWorkers === 0 && underConstruction && <PersonList title="Builders" people={building.workers} empty="No builders yet." />}
      {def.housing > 0 && !underConstruction && <PersonList title="Residents" people={building.residents} empty="Nobody lives here." />}

      {!isTown && (
        <section className="insp-section insp-actions">
          {confirming ? (
            <div className="confirm-box" role="group" aria-label="Confirm">
              <p>
                {underConstruction
                  ? `Cancel construction? Delivered materials (${amountsText(c?.delivered ?? {})}) go back to the stockpile.`
                  : `Demolish the ${def.name}? You get back ${amountsText(demolishRefund(def.cost))}.`}
              </p>
              <div className="dialog-actions">
                <button type="button" className="btn small ghost" onClick={() => setConfirming(false)} data-testid="building-confirm-no" data-autofocus>
                  Keep it
                </button>
                <button type="button" className="btn small danger" onClick={run} data-testid="building-confirm-yes">
                  {underConstruction ? 'Cancel construction' : 'Demolish'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn small danger" onClick={() => setConfirming(true)} data-testid="building-remove">
              <Icon name="trash" size={14} /> {underConstruction ? 'Cancel construction' : 'Demolish'}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
