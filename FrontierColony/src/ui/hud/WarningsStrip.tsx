import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameController } from '../../game';
import { uiStore, useUiStore } from '../../store';
import { Icon, type IconName } from '../components/Icon';
import { computeWarnings, newDangerIds, type Warning } from '../lib/warnings';

const ICON: Record<Warning['severity'], IconName> = { info: 'info', good: 'good', warning: 'warning', danger: 'danger' };
const MAX_VISIBLE = 4;

/** Persistent alerts (GAME_DESIGN §12). Chips jump to the relevant panel or settler. Danger alerts toast once when they appear. */
export function WarningsStrip() {
  const controller = useGameController();
  // Reduce the snapshot to the facts the rules use, so unrelated changes do not re-render the strip.
  const input = useUiStore(
    useShallow((s) => {
      const snap = s.snapshot;
      if (!snap) return null;
      return {
        food: Math.floor(snap.stock.food),
        water: Math.floor(snap.stock.water),
        wood: Math.floor(snap.stock.wood),
        stone: Math.floor(snap.stock.stone),
        tools: Math.floor(snap.stock.tools),
        cap: snap.storageCapacity,
        pop: snap.population,
        beds: snap.housingCapacity,
        season: snap.season,
        day: snap.day,
        who: snap.settlers
          .map((x) => `${x.id}:${x.name}:${Math.round(x.needs.hunger)}:${Math.round(x.needs.happiness)}:${Math.round(x.needs.health)}:${x.activity.kind === 'idle' ? 1 : 0}`)
          .join('|'),
        sites: snap.buildings.map((b) => `${b.type}${b.status[0]}`).join('|'),
      };
    }),
  );
  const snapshot = useUiStore((s) => s.snapshot);

  const warnings = useMemo(
    () =>
      snapshot && input
        ? computeWarnings({
            stock: { wood: input.wood, stone: input.stone, food: input.food, water: input.water, tools: input.tools },
            storageCapacity: input.cap,
            population: input.pop,
            housingCapacity: input.beds,
            season: input.season,
            day: input.day,
            settlers: snapshot.settlers,
            buildings: snapshot.buildings,
          })
        : [],
    // The snapshot object changes every tick; `input` changes only when something the rules read does.
    [input],
  );

  const previous = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(warnings.map((w) => w.id));
    // The first evaluation after a new game or load only records the baseline.
    if (previous.current !== null) {
      for (const id of newDangerIds(warnings, previous.current)) {
        const w = warnings.find((x) => x.id === id);
        if (w) uiStore.getState().pushToast(w.text, 'danger');
      }
    }
    previous.current = ids;
  }, [warnings]);

  if (warnings.length === 0) return null;
  const shown = warnings.slice(0, MAX_VISIBLE);
  const hidden = warnings.length - shown.length;

  const act = (w: Warning) => {
    const ui = uiStore.getState();
    if (w.action.kind === 'panel') ui.setOpenPanel(w.action.panel);
    else if (w.action.kind === 'settler') {
      const id = w.action.id;
      const s = snapshot?.settlers.find((x) => x.id === id);
      ui.select({ kind: 'settler', id });
      if (s) controller.centerOn(s.pos);
    }
  };

  return (
    <ul className="warnings" aria-label="Warnings" data-testid="warnings">
      {shown.map((w) => (
        <li key={w.id}>
          <button type="button" className={`warning-chip warning-chip--${w.severity}`} onClick={() => act(w)} disabled={w.action.kind === 'none'} data-testid={`warning-${w.id}`}>
            <Icon name={ICON[w.severity]} size={14} />
            <span>{w.text}</span>
          </button>
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <span className="warning-chip warning-chip--more" title={warnings.slice(MAX_VISIBLE).map((w) => w.text).join('\n')}>
            +{hidden} more
          </span>
        </li>
      )}
    </ul>
  );
}
