import { useEffect } from 'react';
import { useStore } from '../app/store';
import type { AppApi } from '../app/types';
import { canCommand } from '../sim/mission/transitions';
import { isTypingTarget } from './format';
import { CAMERA_ORDER } from './labels';
import { manualInput } from './ManualPad';
import { useUi } from './uiStore';

const DRIVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const ROTATE_STEP = (15 * Math.PI) / 180;

/**
 * Global keyboard shortcuts (ignored while typing in a text field):
 * Space pause/resume (vacuum toggle in manual) · 1–9 camera · Esc tool/selection · Delete remove ·
 * R / Shift+R rotate · M manual · H help · WASD / arrows drive in manual mode.
 */
export function useShortcuts(api: AppApi | null): void {
  useEffect(() => {
    if (!api) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const st = useStore.getState();
      const mode = st.telemetry?.mode ?? 'idle';
      const key = e.key.toLowerCase();
      const manual = mode === 'manual';

      if (manual && DRIVE_KEYS.has(key)) {
        e.preventDefault();
        if (!e.repeat) {
          manualInput.keys.add(key);
          manualInput.send(api);
        }
        return;
      }
      // Buttons handle Space/Enter themselves when focused; don't double-trigger.
      const onButton = (e.target as HTMLElement | null)?.closest?.('button, [role="radio"], select, a');
      if (e.key === ' ' || e.code === 'Space') {
        if (onButton) return;
        e.preventDefault();
        if (e.repeat) return;
        if (manual) {
          st.set({ manualVacuum: !st.manualVacuum });
          manualInput.last = '';
          manualInput.send(api);
        } else if (mode === 'paused') api.command({ type: 'resume' });
        else if (canCommand(mode, 'pause').ok) api.command({ type: 'pause' });
        return;
      }
      if (e.repeat) return;
      if (/^[1-9]$/.test(e.key)) {
        const cam = CAMERA_ORDER[Number(e.key) - 1];
        if (cam) st.set({ cameraMode: cam });
        return;
      }
      switch (key) {
        case 'escape': {
          const ui = useUi.getState();
          if (ui.helpOpen) ui.set({ helpOpen: false });
          else if (st.inspected) st.set({ inspected: null });
          else st.set({ tool: 'none', selection: null });
          break;
        }
        case 'delete':
        case 'backspace':
          if (st.selection) {
            e.preventDefault();
            api.removeSelected();
          }
          break;
        case 'r':
          if (st.selection) api.rotateSelected(e.shiftKey ? -ROTATE_STEP : ROTATE_STEP);
          break;
        case 'm':
          if (manual) api.command({ type: 'manual', enable: false });
          else api.command({ type: 'manual', enable: true });
          break;
        case 'h':
        case '?':
          useUi.getState().set({ helpOpen: !useUi.getState().helpOpen });
          break;
        default:
          break;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (DRIVE_KEYS.has(key) && manualInput.keys.delete(key)) manualInput.send(api);
    };
    const onBlur = () => {
      if (manualInput.keys.size) {
        manualInput.keys.clear();
        manualInput.send(api);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    // Leaving manual mode clears held keys; vacuum toggles propagate immediately.
    const unsub = useStore.subscribe((s, p) => {
      const m = s.telemetry?.mode;
      const pm = p.telemetry?.mode;
      if (m !== pm && (m === 'manual' || pm === 'manual')) manualInput.reset(api);
      if (s.manualVacuum !== p.manualVacuum && m === 'manual') manualInput.send(api);
    });
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      unsub();
    };
  }, [api]);
}
