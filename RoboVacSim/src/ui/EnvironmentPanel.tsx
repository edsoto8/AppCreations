import { memo, useState } from 'react';
import { useStore } from '../app/store';
import type { Tool } from '../app/types';
import { FURNITURE_CATALOG, OBSTACLE_CATALOG } from '../sim/world/furnitureCatalog';
import type { FloorType, FurnitureKind, ObstacleKind } from '../sim/world/types';
import { useApi } from './hooks';
import { Icon } from './icons';
import { FLOOR_OPTIONS, SPILL_OPTIONS, TOOLS, WALL_OPTIONS } from './labels';
import { Field, Section, Segmented, Slider } from './primitives';

const ROTATE = (15 * Math.PI) / 180;

const ToolPalette = memo(function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const set = useStore((s) => s.set);
  const choose = (t: Tool) => set({ tool: tool === t && t !== 'none' ? 'none' : t });
  const active = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  return (
    <Section title="Tools">
      <div className="tool-grid" role="toolbar" aria-label="Editor tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`tool ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} onClick={() => choose(t.id)} title={t.hint} data-testid={`tool-${t.id}`}>
            <Icon name={t.icon} size={18} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <ToolOptions />
      <p className="hint" role="note">
        <Icon name="info" size={13} />
        {active.hint}
      </p>
    </Section>
  );
});

function ToolOptions() {
  const tool = useStore((s) => s.tool);
  const obstacleKind = useStore((s) => s.obstacleKind);
  const furnitureKind = useStore((s) => s.furnitureKind);
  const spillKind = useStore((s) => s.spillKind);
  const set = useStore((s) => s.set);
  if (tool === 'addObstacle')
    return (
      <Field label="Obstacle">
        <select className="select" value={obstacleKind} onChange={(e) => set({ obstacleKind: e.target.value as ObstacleKind })} aria-label="Obstacle kind" data-testid="obstacle-kind">
          {(Object.keys(OBSTACLE_CATALOG) as ObstacleKind[]).map((k) => (
            <option key={k} value={k}>
              {OBSTACLE_CATALOG[k].label} — {Math.round(OBSTACLE_CATALOG[k].defaults.h * 100)} cm tall
            </option>
          ))}
        </select>
      </Field>
    );
  if (tool === 'addFurniture')
    return (
      <Field label="Furniture">
        <select className="select" value={furnitureKind} onChange={(e) => set({ furnitureKind: e.target.value as FurnitureKind })} aria-label="Furniture kind" data-testid="furniture-kind">
          {(Object.keys(FURNITURE_CATALOG) as FurnitureKind[]).map((k) => (
            <option key={k} value={k}>
              {FURNITURE_CATALOG[k].label}
            </option>
          ))}
        </select>
      </Field>
    );
  if (tool === 'spill')
    return (
      <Field label="Dirt type">
        <Segmented size="sm" label="Dirt type" value={spillKind} onChange={(k) => set({ spillKind: k })} options={SPILL_OPTIONS} testId="spill-kind" />
      </Field>
    );
  return null;
}

function SelectionCard() {
  const api = useApi();
  const sel = useStore((s) => s.selection);
  useStore((s) => s.layoutVersion);
  if (!sel) return null;
  let name: string = sel.id;
  if (api) {
    const l = api.sim.layout;
    if (sel.kind === 'furniture') {
      const f = l.furniture.find((x) => x.id === sel.id);
      if (f) name = FURNITURE_CATALOG[f.kind].label;
    } else if (sel.kind === 'obstacle') {
      const o = l.obstacles.find((x) => x.id === sel.id);
      if (o) name = OBSTACLE_CATALOG[o.kind].label;
    } else {
      const z = l.zones.find((x) => x.id === sel.id);
      if (z) name = `${z.kind === 'noGo' ? 'No-go' : 'No-mop'} zone · ${z.rect.w.toFixed(1)} × ${z.rect.h.toFixed(1)} m`;
    }
  }
  return (
    <div className="selection-card" data-testid="selection-card">
      <div>
        <span className="eyebrow">Selected {sel.kind}</span>
        <strong>{name}</strong>
      </div>
      <div className="row gap-sm">
        {sel.kind !== 'zone' && (
          <>
            <button type="button" className="icon-btn" aria-label="Rotate −15° (Shift+R)" title="Rotate −15° (Shift+R)" onClick={() => api?.rotateSelected(-ROTATE)}>
              <Icon name="rotateL" size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Rotate +15° (R)" title="Rotate +15° (R)" onClick={() => api?.rotateSelected(ROTATE)}>
              <Icon name="rotateR" size={15} />
            </button>
          </>
        )}
        <button type="button" className="icon-btn danger" aria-label="Delete selected (Delete)" title="Delete (Del)" onClick={() => api?.removeSelected()} data-testid="btn-delete-selected">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

const Floors = memo(function Floors() {
  const api = useApi();
  const rooms = useStore((s) => s.rooms);
  return (
    <Section title="Floor types">
      <div className="floor-list">
        {rooms.map((r) => (
          <label key={r.id} className="floor-row">
            <span>{r.name}</span>
            <select className="select select-sm" value={r.floor} onChange={(e) => api?.setFloorType(r.id, e.target.value as FloorType)} aria-label={`Floor type for ${r.name}`} data-testid={`floor-${r.id}`}>
              {FLOOR_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </Section>
  );
});

const DemoControls = memo(function DemoControls() {
  const api = useApi();
  const soc = useStore((s) => s.telemetry?.battery ?? 1);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? Math.round(soc * 100);
  return (
    <Section title="Demo controls">
      <div onPointerUp={() => setDraft(null)} onKeyUp={() => setDraft(null)} onBlur={() => setDraft(null)}>
      <Slider
        label="Battery"
        value={shown}
        min={1}
        max={100}
        step={1}
        format={(v) => `${v}%`}
        onChange={(v) => {
          setDraft(v);
          api?.setBattery(v / 100);
        }}
        testId="battery-slider"
      />
      </div>
      <div className="row gap-sm wrap">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.setBattery(0.25)} data-testid="btn-battery-25">
          Set 25%
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.setBattery(0.18)} data-testid="btn-battery-18" title="Below the 20% return threshold — triggers recharge-and-resume mid-mission">
          Set 18% <span className="muted">(low)</span>
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.setBattery(1)}>
          Full
        </button>
      </div>
      <Field label="Dock service">
        <div className="row gap-sm wrap">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.dockService('refill')} data-testid="btn-dock-refill">
            Refill clean tank
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.dockService('emptyDirty')}>
            Empty dirty tank
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => api?.dockService('replaceBag')}>
            Replace dust bag
          </button>
        </div>
      </Field>
    </Section>
  );
});

export const EnvironmentPanel = memo(function EnvironmentPanel() {
  const api = useApi();
  const wallMode = useStore((s) => s.wallMode);
  const set = useStore((s) => s.set);
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="panel-stack">
      <ToolPalette />
      <SelectionCard />
      <Section title="Dynamic obstacles">
        <button type="button" className="btn btn-secondary btn-block" onClick={() => api?.dropObstacleOnPath()} data-testid="btn-drop-obstacle" title="Drops a random obstacle ~0.8 m ahead on the planned path">
          <Icon name="box" size={15} />
          Drop obstacle on robot path
        </button>
        <p className="hint">
          <Icon name="info" size={13} />
          The robot isn&rsquo;t told — it must detect the object with LiDAR, the front sensor or the bumper and replan.
        </p>
      </Section>
      <Section title="Walls & map">
        <Field label="Wall visibility">
          <Segmented label="Wall visibility" value={wallMode} onChange={(w) => set({ wallMode: w })} options={WALL_OPTIONS.map((o) => ({ ...o, testId: `walls-${o.value}` }))} />
        </Field>
        <button
          type="button"
          className={`btn btn-sm ${confirmClear ? 'btn-danger' : 'btn-ghost'}`}
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true);
              window.setTimeout(() => setConfirmClear(false), 3000);
              return;
            }
            setConfirmClear(false);
            api?.clearMap();
          }}
          data-testid="btn-clear-map"
        >
          <Icon name="eraser" size={14} />
          {confirmClear ? 'Click again to clear the robot map' : 'Clear robot map'}
        </button>
      </Section>
      <Floors />
      <DemoControls />
    </div>
  );
});
