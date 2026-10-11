import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';

/** Subtle "Paused" pill (placed by `.hud-top-center`). Never blocks input. */
export function PauseIndicator() {
  const paused = useUiStore((s) => s.paused);
  const menuOpen = useUiStore((s) => s.gameMenuOpen);
  if (!paused || menuOpen) return null;
  return (
    <div className="pause-pill" role="status" data-testid="pause-indicator">
      <Icon name="pause" size={14} />
      <span>Paused</span>
      <span className="kbd">Space</span>
    </div>
  );
}

/** Faint frame around the whole viewport while paused. Must not sit inside a transformed parent (it is position: fixed). */
export function PauseFrame() {
  const paused = useUiStore((s) => s.paused);
  const menuOpen = useUiStore((s) => s.gameMenuOpen);
  return paused && !menuOpen ? <div className="pause-frame" aria-hidden="true" /> : null;
}
