import { useGameController } from '../game';
import { RESOURCE_TYPES } from '../sim';
import { GAME_SPEEDS } from '../shared/types';
import { useUiStore } from '../store';

const RESOURCE_LABELS = { wood: 'Wood', stone: 'Stone', food: 'Food', water: 'Water', tools: 'Tools' } as const;

export function formatClock(timeOfDay: number): string {
  const h = Math.floor(timeOfDay);
  const m = Math.floor((timeOfDay - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** M1 placeholder HUD: colony, day/time, resources, population, speed controls. */
export function TopBar() {
  const snapshot = useUiStore((s) => s.snapshot);
  const speed = useUiStore((s) => s.speed);
  const paused = useUiStore((s) => s.paused);
  const controller = useGameController();

  return (
    <div className="top-bar" data-testid="top-bar">
      {snapshot && (
        <>
          <span className="colony-name">{snapshot.colonyName}</span>
          <span data-testid="clock">
            Day {snapshot.day}, {formatClock(snapshot.timeOfDay)}
          </span>
          <span className="resources">
            {RESOURCE_TYPES.map((r) => (
              <span key={r} className="resource" data-testid={`resource-${r}`}>
                <span className="label">{RESOURCE_LABELS[r]}</span>
                {Math.floor(snapshot.stock[r])}
              </span>
            ))}
            <span className="resource" data-testid="population">
              <span className="label">Settlers</span>
              {snapshot.population}/{snapshot.housingCapacity}
            </span>
          </span>
        </>
      )}
      <span className="speed-controls" role="group" aria-label="Game speed">
        <button type="button" aria-pressed={paused} onClick={() => controller.togglePause()} data-testid="pause">
          {paused ? 'Resume' : 'Pause'}
        </button>
        {GAME_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={!paused && speed === s}
            onClick={() => {
              controller.setSpeed(s);
              controller.setPaused(false);
            }}
            data-testid={`speed-${s}`}
          >
            {s}x
          </button>
        ))}
      </span>
    </div>
  );
}
