import { useEffect, useRef } from 'react';
import { uiStore, useUiStore } from '../../store';
import { Tooltip } from '../components/Tooltip';
import { OVERLAY_HELP, OVERLAY_LABEL, OVERLAY_ORDER } from '../lib/overlay';

/**
 * Map overlay switch (off / resources / buildable), next to the minimap. V cycles it. While a building is
 * being placed the buildable overlay turns on by itself, and goes back when placement ends (unless the player chose another).
 */
export function OverlayToggle() {
  const overlay = useUiStore((s) => s.overlay);
  const buildMode = useUiStore((s) => s.buildMode);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const auto = useRef(false);

  useEffect(() => {
    const ui = uiStore.getState();
    if (buildMode && ui.overlay === 'none') {
      auto.current = true;
      ui.setOverlay('buildable');
    } else if (!buildMode && auto.current) {
      auto.current = false;
      if (ui.overlay === 'buildable') ui.setOverlay('none');
    }
  }, [buildMode, setOverlay]);

  // Choosing an overlay by hand ends the automatic behaviour.
  const choose = (mode: (typeof OVERLAY_ORDER)[number]) => {
    auto.current = false;
    setOverlay(mode);
  };

  const help = (
    <>
      {OVERLAY_ORDER.map((m) => (
        <p key={m}>
          <strong>{OVERLAY_LABEL[m]}:</strong> {OVERLAY_HELP[m]}
        </p>
      ))}
      <p>
        Shortcut: <span className="kbd">V</span> cycles them.
      </p>
    </>
  );

  return (
    <Tooltip title="Map overlay" content={help} side="top">
      <div className="overlay-toggle glass" role="radiogroup" aria-label="Map overlay" data-testid="overlay-toggle">
        {OVERLAY_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={overlay === m}
            className={`overlay-toggle__btn ${overlay === m ? 'is-active' : ''}`}
            onClick={() => choose(m)}
            data-testid={`overlay-${m}`}
          >
            {OVERLAY_LABEL[m]}
          </button>
        ))}
      </div>
    </Tooltip>
  );
}
