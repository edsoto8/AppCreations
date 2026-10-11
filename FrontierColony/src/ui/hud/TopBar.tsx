import { RESOURCE_TYPES } from '../../sim';
import { useUiStore } from '../../store';
import { seasonInfo } from '../lib/format';
import { ClockWidget } from './ClockWidget';
import { PopulationChip } from './PopulationChip';
import { ResourceChip } from './ResourceChip';
import { SpeedControls } from './SpeedControls';

/** Top HUD bar: colony, clock + weather, resources, population, speed controls. */
export function TopBar() {
  const colonyName = useUiStore((s) => s.snapshot?.colonyName ?? null);
  const year = useUiStore((s) => (s.snapshot ? seasonInfo(s.snapshot.day).year : null));
  return (
    <header className="top-bar glass" data-testid="top-bar">
      {colonyName !== null && (
        <>
          <div className="hud-group colony" data-testid="colony-name-block">
            <div className="colony__name" title={colonyName}>
              {colonyName}
            </div>
            <div className="colony__sub">Year {year}</div>
          </div>
          <ClockWidget />
          <div className="hud-group resources" role="group" aria-label="Resources">
            {RESOURCE_TYPES.map((r) => (
              <ResourceChip key={r} resource={r} />
            ))}
          </div>
          <div className="hud-group">
            <PopulationChip />
          </div>
        </>
      )}
      <SpeedControls />
    </header>
  );
}
