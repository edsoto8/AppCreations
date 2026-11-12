import { memo, useEffect, useRef } from 'react';
import { useStore } from '../app/store';
import { fmtCount } from './format';
import { fpsHistory, useHistoryVersion } from './hooks';
import { Icon } from './icons';
import { Kbd, Sparkline } from './primitives';
import { useUi } from './uiStore';
import { CAMERA_LABEL } from '../app/types';
import { CAMERA_ORDER } from './labels';

/** Renderer / simulation performance HUD (overlays.perf). */
export const PerfOverlay = memo(function PerfOverlay() {
  const on = useStore((s) => s.overlays.perf);
  const perf = useStore((s) => s.perf);
  useHistoryVersion(fpsHistory);
  if (!on) return null;
  const fps = perf?.fps ?? 0;
  const tone = fps >= 50 ? 'ok' : fps >= 28 ? 'warn' : 'error';
  return (
    <div className="hud perf-hud" data-testid="perf-overlay" aria-label="Performance statistics">
      <div className="perf-top">
        <span className={`perf-fps tone-${tone}`}>
          {fps.toFixed(0)}
          <small> FPS</small>
        </span>
        <Sparkline values={fpsHistory.series('fps').slice()} min={0} max={Math.max(65, ...fpsHistory.series('fps'))} tone={tone} label="FPS history" width={92} height={26} />
      </div>
      <dl className="perf-grid">
        <dt>Frame</dt>
        <dd>{perf ? `${perf.frameMs.toFixed(1)} ms` : '—'}</dd>
        <dt>Draw calls</dt>
        <dd>{perf ? fmtCount(perf.drawCalls) : '—'}</dd>
        <dt>Triangles</dt>
        <dd>{perf ? fmtCount(perf.triangles) : '—'}</dd>
        <dt>Geometries</dt>
        <dd>{perf?.geometries ?? '—'}</dd>
        <dt>Textures</dt>
        <dd>{perf?.textures ?? '—'}</dd>
        <dt>Sim step</dt>
        <dd>{perf ? `${perf.simStepMs.toFixed(3)} ms` : '—'}</dd>
        <dt>Steps/frame</dt>
        <dd>{perf?.stepsPerFrame ?? '—'}</dd>
        <dt>Adaptive</dt>
        <dd>{perf ? `L${perf.adaptiveLevel}` : '—'}</dd>
      </dl>
    </div>
  );
});

/** Card describing the robot/dock part picked in the 3D view. */
export const InspectorCard = memo(function InspectorCard() {
  const part = useStore((s) => s.inspected);
  const set = useStore((s) => s.set);
  if (!part) return null;
  return (
    <aside className="hud inspector" aria-label="Component inspector" data-testid="inspector">
      <header>
        <span className={`owner-tag ${part.owner}`}>{part.owner === 'robot' ? 'AURA-X1 robot' : 'Dock station'}</span>
        <button type="button" className="icon-btn" aria-label="Close inspector" onClick={() => set({ inspected: null })} data-testid="inspector-close">
          <Icon name="close" size={14} />
        </button>
      </header>
      <h3>{part.name}</h3>
      <p>{part.description}</p>
    </aside>
  );
});

/** Hover info from the 3D view + active tool hint. */
export const ViewportHint = memo(function ViewportHint() {
  const hover = useStore((s) => s.hoverInfo);
  const tool = useStore((s) => s.tool);
  const cam = useStore((s) => s.cameraMode);
  return (
    <div className="viewport-chips">
      <span className="vchip" title="Camera mode (keys 1–9)">
        <Icon name="camera" size={13} />
        {CAMERA_LABEL[cam]}
        <Kbd>{CAMERA_ORDER.indexOf(cam) + 1}</Kbd>
      </span>
      {tool !== 'none' && (
        <span className="vchip tone-accent">
          Tool: {tool} <Kbd>Esc</Kbd>
        </span>
      )}
      {hover && <span className="vchip">{hover}</span>}
    </div>
  );
});

const SHORTCUTS: Array<[string[], string]> = [
  [['Space'], 'Pause / resume (toggles vacuum in manual drive)'],
  [['1', '…', '9'], 'Camera modes'],
  [['W', 'A', 'S', 'D'], 'Drive in manual mode (arrow keys too)'],
  [['M'], 'Toggle manual drive'],
  [['Esc'], 'Cancel tool / clear selection / close'],
  [['Delete'], 'Remove selected item'],
  [['R'], 'Rotate selected +15°'],
  [['Shift', 'R'], 'Rotate selected −15°'],
  [['H'], 'Show / hide this help'],
];

/** Help dialog with keyboard shortcuts and a quick tour. */
export const HelpOverlay = memo(function HelpOverlay() {
  const open = useUi((s) => s.helpOpen);
  const set = useUi((s) => s.set);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && set({ helpOpen: false })}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" data-testid="help-dialog">
        <header className="modal-head">
          <h2 id="help-title">
            <Icon name="keyboard" size={18} /> Shortcuts &amp; quick tour
          </h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label="Close help" onClick={() => set({ helpOpen: false })}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="modal-body">
          <div className="help-cols">
            <div>
              <h3>Keyboard</h3>
              <ul className="shortcut-list">
                {SHORTCUTS.map(([keys, desc]) => (
                  <li key={desc}>
                    <span className="keys">
                      {keys.map((k, i) => (k === '…' ? <span key={i} className="muted"> – </span> : <Kbd key={i}>{k}</Kbd>))}
                    </span>
                    <span>{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Quick tour</h3>
              <ol className="tour">
                <li>
                  Pick a <strong>mission type</strong> and press <strong>Start</strong>. The robot leaves the dock, maps unknown space with LiDAR and cleans in lanes.
                </li>
                <li>
                  The <strong>2D map</strong> shows only what the robot has sensed. Click rooms to select them, double-click to fly the 3D camera there.
                </li>
                <li>
                  Use the <strong>Environment</strong> tab to drop obstacles on the robot&rsquo;s path, spill dirt or draw no-go zones, then watch it replan.
                </li>
                <li>
                  <strong>Learn</strong> walks through the robotics behind each subsystem with live values from the simulation.
                </li>
              </ol>
              <p className="disclaimer">Simplified educational model — not an accurate engineering simulation.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
