import { useShallow } from 'zustand/react/shallow';
import { GAME_SPEEDS, type GameSpeed } from '../../shared/types';
import { useUiStore } from '../../store';
import { useGameController } from '../../game';
import { Icon, type IconName } from '../components/Icon';
import { Tooltip } from '../components/Tooltip';
import { SPEED_TOOLTIP } from '../lib/tooltipText';

const SPEED_ICON: Record<GameSpeed, IconName> = { 1: 'play1', 2: 'play2', 4: 'play4' };

/** Pause + 1x / 2x / 4x. Keyboard: Space, 1, 2, 3 (handled globally by useHotkeys). */
export function SpeedControls() {
  const { speed, paused } = useUiStore(useShallow((s) => ({ speed: s.speed, paused: s.paused })));
  const controller = useGameController();
  return (
    <div className="speed-controls" role="group" aria-label="Game speed" data-testid="speed-controls">
      <Tooltip title={SPEED_TOOLTIP.pause.title} content={<ShortcutHint k={SPEED_TOOLTIP.pause.key} />} side="bottom">
        <button
          type="button"
          className={`speed-btn speed-btn--pause ${paused ? 'is-active' : ''}`}
          aria-pressed={paused}
          aria-label={paused ? 'Resume' : 'Pause'}
          onClick={() => controller.togglePause()}
          data-testid="pause"
        >
          <Icon name={paused ? 'play1' : 'pause'} size={18} />
        </button>
      </Tooltip>
      {GAME_SPEEDS.map((s) => (
        <Tooltip key={s} title={SPEED_TOOLTIP[s].title} content={<ShortcutHint k={SPEED_TOOLTIP[s].key} />} side="bottom">
          <button
            type="button"
            className={`speed-btn ${!paused && speed === s ? 'is-active' : ''}`}
            aria-pressed={!paused && speed === s}
            aria-label={`Speed ${s}x`}
            onClick={() => {
              controller.setSpeed(s);
              controller.setPaused(false);
            }}
            data-testid={`speed-${s}`}
          >
            <Icon name={SPEED_ICON[s]} size={18} />
            <span className="speed-btn__label">{s}x</span>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ShortcutHint({ k }: { k: string }) {
  return (
    <span>
      Shortcut: <span className="kbd">{k}</span>
    </span>
  );
}
