import { useUiStore } from '../../store';
import { Icon } from '../components/Icon';

/** Persistent notice while the simulation is stopped after an error. */
export function HaltedBanner() {
  const halted = useUiStore((s) => s.simHalted);
  const setOpenPanel = useUiStore((s) => s.setOpenPanel);
  if (!halted) return null;
  return (
    <div className="halted-banner" role="alert" data-testid="halted-banner">
      <Icon name="danger" size={20} />
      <span>The simulation stopped after an error. Load a save to continue.</span>
      <button type="button" className="btn small primary" onClick={() => setOpenPanel('saveLoad')} data-testid="halted-load">
        Load
      </button>
    </div>
  );
}
