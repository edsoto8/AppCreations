import { memo } from 'react';
import { useStore } from '../app/store';
import { CAMERA_LABEL, type DirtView } from '../app/types';
import { Icon } from './icons';
import { CAMERA_ICON, CAMERA_ORDER, OVERLAY_TOGGLES, QUALITY_OPTIONS } from './labels';
import { Field, Kbd, Section, Segmented, Slider, Toggle } from './primitives';

const CameraGrid = memo(function CameraGrid() {
  const cam = useStore((s) => s.cameraMode);
  const set = useStore((s) => s.set);
  return (
    <Section title="Camera">
      <div className="cam-grid" role="radiogroup" aria-label="Camera mode">
        {CAMERA_ORDER.map((m, i) => (
          <button key={m} type="button" role="radio" aria-checked={cam === m} className={`cam ${cam === m ? 'on' : ''}`} onClick={() => set({ cameraMode: m })} data-testid={`camera-${m}`} title={`${CAMERA_LABEL[m]} (${i + 1})`}>
            <Icon name={CAMERA_ICON[m]} size={16} />
            <span>{CAMERA_LABEL[m]}</span>
            <Kbd>{i + 1}</Kbd>
          </button>
        ))}
      </div>
    </Section>
  );
});

const OverlayToggles = memo(function OverlayToggles() {
  const overlays = useStore((s) => s.overlays);
  const setOverlay = useStore((s) => s.setOverlay);
  return (
    <Section title="3D overlays">
      <Field label="Dirt">
        <Segmented<DirtView>
          label="Dirt visualisation"
          value={overlays.dirt}
          onChange={(v) => setOverlay('dirt', v)}
          testId="overlay-dirt"
          options={[
            { value: 'off', label: 'Off', testId: 'overlay-dirt-off' },
            { value: 'realistic', label: 'Realistic', testId: 'overlay-dirt-realistic' },
            { value: 'heatmap', label: 'Heatmap', testId: 'overlay-dirt-heatmap' },
          ]}
        />
      </Field>
      <div className="toggle-grid">
        {OVERLAY_TOGGLES.map((o) => (
          <Toggle key={o.key} on={overlays[o.key]} onChange={(v) => setOverlay(o.key, v)} label={o.label} hint={o.hint} testId={`overlay-${o.key}`} />
        ))}
      </div>
    </Section>
  );
});

const QualityPicker = memo(function QualityPicker() {
  const quality = useStore((s) => s.quality);
  const set = useStore((s) => s.set);
  return (
    <Section title="Render quality">
      <Segmented label="Render quality" value={quality} onChange={(q) => set({ quality: q })} options={QUALITY_OPTIONS.map((q) => ({ ...q, testId: `quality-${q.value}` }))} />
      <p className="hint">
        <Icon name="info" size={13} />
        Low disables shadows and post-processing; the renderer also adapts automatically when the frame rate drops.
      </p>
    </Section>
  );
});

const Inspection = memo(function Inspection() {
  const explode = useStore((s) => s.explode);
  const xray = useStore((s) => s.xray);
  const dustbinOpen = useStore((s) => s.dustbinOpen);
  const dockPanels = useStore((s) => s.dockPanels);
  const dockCutaway = useStore((s) => s.dockCutaway);
  const set = useStore((s) => s.set);
  return (
    <Section
      title="Robot & dock inspection"
      aside={
        <button type="button" className="link-btn" onClick={() => set({ explode: 0, xray: false, dustbinOpen: false, dockPanels: 0, dockCutaway: false })}>
          Reset
        </button>
      }
    >
      <Slider label="Explode robot" value={explode} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ explode: v })} testId="explode-slider" />
      <Slider label="Dock panels" value={dockPanels} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ dockPanels: v })} testId="dock-panels-slider" />
      <div className="toggle-grid">
        <Toggle on={xray} onChange={(v) => set({ xray: v })} label="X-ray shell" testId="toggle-xray" />
        <Toggle on={dustbinOpen} onChange={(v) => set({ dustbinOpen: v })} label="Dustbin open" testId="toggle-dustbin" />
        <Toggle on={dockCutaway} onChange={(v) => set({ dockCutaway: v })} label="Dock cutaway" testId="toggle-dock-cutaway" />
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ tool: 'inspect', cameraMode: 'exploded', explode: Math.max(explode, 0.6) })}>
        <Icon name="search" size={14} />
        Inspect parts (click a component)
      </button>
    </Section>
  );
});

export const ViewPanel = memo(function ViewPanel() {
  return (
    <div className="panel-stack">
      <CameraGrid />
      <OverlayToggles />
      <Inspection />
      <QualityPicker />
    </div>
  );
});
