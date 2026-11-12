import { memo, useEffect } from 'react';
import { useStore } from '../app/store';
import type { AppApi } from '../app/types';
import { manualAxes } from './format';
import { useApi } from './hooks';
import { Icon, type IconName } from './icons';

/**
 * Shared manual-drive input: keyboard keys (WASD / arrows) and the on-screen pad are merged and
 * sent to the controller via api.setManualInput whenever they change.
 */
export const manualInput = {
  keys: new Set<string>(),
  pad: { forward: 0, turn: 0 },
  last: '',
  send(api: AppApi | null): void {
    if (!api) return;
    const k = manualAxes(this.keys);
    const forward = Math.max(-1, Math.min(1, k.forward + this.pad.forward));
    const turn = Math.max(-1, Math.min(1, k.turn + this.pad.turn));
    const vacuum = useStore.getState().manualVacuum;
    const sig = `${forward}|${turn}|${vacuum}`;
    if (sig === this.last) return;
    this.last = sig;
    api.setManualInput(forward, turn, vacuum);
  },
  reset(api: AppApi | null): void {
    this.keys.clear();
    this.pad = { forward: 0, turn: 0 };
    this.last = '';
    api?.setManualInput(0, 0, useStore.getState().manualVacuum);
  },
};

const PAD: Array<{ id: string; icon: IconName; label: string; f: number; t: number }> = [
  { id: 'up', icon: 'chevD', label: 'Forward', f: 1, t: 0 },
  { id: 'left', icon: 'chevL', label: 'Turn left', f: 0, t: 1 },
  { id: 'down', icon: 'chevD', label: 'Reverse', f: -1, t: 0 },
  { id: 'right', icon: 'chevR', label: 'Turn right', f: 0, t: -1 },
];

/** Touch / mouse drive pad (hold to drive). */
export const ManualPad = memo(function ManualPad() {
  const api = useApi();
  useEffect(() => () => manualInput.reset(api), [api]);
  const press = (f: number, t: number) => {
    manualInput.pad = { forward: f, turn: t };
    manualInput.send(api);
  };
  const release = () => press(0, 0);
  return (
    <div className="dpad" role="group" aria-label="Drive pad (hold)">
      {PAD.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`dpad-btn dpad-${b.id}`}
          aria-label={b.label}
          title={b.label}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            press(b.f, b.t);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onKeyDown={(e) => {
            if (e.key === 'Enter') press(b.f, b.t);
          }}
          onKeyUp={(e) => {
            if (e.key === 'Enter') release();
          }}
        >
          <Icon name={b.icon} size={18} />
        </button>
      ))}
      <span className="dpad-hub" aria-hidden="true" />
    </div>
  );
});
