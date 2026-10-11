import { POPULATION_CAP } from '../../sim';
import { useShallow } from 'zustand/react/shallow';
import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { HOUSING_TOOLTIP } from '../lib/tooltipText';

/** Population / beds. Turns amber when settlers outnumber beds. */
export function PopulationChip() {
  const data = useUiStore(
    useShallow((s) => (s.snapshot ? { pop: s.snapshot.population, beds: s.snapshot.housingCapacity } : null)),
  );
  if (!data) return null;
  const homeless = Math.max(0, data.pop - data.beds);
  const tooltip = (
    <>
      <p>{HOUSING_TOOLTIP}</p>
      <dl className="tt-stats">
        <dt>Settlers</dt>
        <dd>{data.pop}</dd>
        <dt>Beds</dt>
        <dd>{data.beds}</dd>
        <dt>Colony limit</dt>
        <dd>{POPULATION_CAP}</dd>
      </dl>
      {homeless > 0 && (
        <p className="tt-alert tt-alert--warning">
          {homeless} settler{homeless === 1 ? '' : 's'} sleeping outdoors. Build more houses.
        </p>
      )}
    </>
  );
  return (
    <Tooltip title="Population and housing" content={tooltip} side="bottom">
      <div
        className={`chip chip--pop ${homeless > 0 ? 'chip--low' : ''}`}
        data-testid="population"
        tabIndex={0}
        role="group"
        aria-label={`Population ${data.pop} of ${data.beds} beds`}
      >
        <Icon name="people" className="chip__icon" />
        <div className="chip__text">
          <div className="chip__main">
            <span className="chip__amount">{data.pop}</span>
            <span className="chip__cap">/{data.beds}</span>
          </div>
          <div className="chip__rate chip__rate--label">
            <Icon name="housing" size={11} /> beds
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
