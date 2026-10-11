import { useCallback, useEffect, useState } from 'react';
import { useGameController } from '../../game';
import type { SaveSlotId, SaveSlotInfo } from '../../game/save';
import { uiStore, useUiStore } from '../../store';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { formatClock, formatDateTime, formatRelativeTime, pluralize } from '../lib/format';
import { PRESET_INFO } from '../lib/newGameOptions';
import { useGameFlow } from '../lib/useGameFlow';

const SLOT_LABEL: Record<SaveSlotId, string> = { autosave: 'Autosave', slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3' };

type Pending = { slot: SaveSlotId; action: 'save' | 'load' | 'delete' } | null;

export interface SaveLoadViewProps {
  /** `load` hides the save buttons (main menu). */
  mode: 'both' | 'load';
  /** Called after a slot was loaded successfully (to close the surrounding panel or menu). */
  onLoaded?: () => void;
}

/**
 * The save slot list used by the Save & Load panel, the game menu and the main menu's Load dialog.
 * Overwriting, loading over a running game and deleting each ask for confirmation first.
 */
export function SaveLoadView({ mode, onLoaded }: SaveLoadViewProps) {
  const controller = useGameController();
  const flow = useGameFlow();
  const [slots, setSlots] = useState<SaveSlotInfo[]>(() => controller.listSaves());
  const [pending, setPending] = useState<Pending>(null);
  const day = useUiStore((s) => s.snapshot?.day ?? 0);
  const gameRunning = useUiStore((s) => s.gameStarted && s.snapshot !== null && s.snapshot.outcome.status !== 'lost');
  const canSave = mode === 'both' && gameRunning;
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    setSlots(controller.listSaves());
    setNow(Date.now());
  }, [controller]);

  // The autosave changes at each new day while the view is open.
  useEffect(() => {
    refresh();
  }, [day, refresh]);

  // Keep "5 min ago" labels fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const run = (slot: SaveSlotId, action: 'save' | 'load' | 'delete', confirmed: boolean) => {
    const info = slots.find((s) => s.slot === slot);
    // Which actions need a second click: overwriting a used slot, deleting, and replacing the running game by loading.
    const needsConfirm = action === 'delete' || (action === 'save' && info?.exists === true) || (action === 'load' && mode === 'both' && gameRunning);
    if (needsConfirm && !confirmed) {
      setPending({ slot, action });
      return;
    }
    setPending(null);
    if (action === 'save') {
      controller.saveGame(slot);
      refresh();
    } else if (action === 'delete') {
      controller.deleteSave(slot);
      uiStore.getState().pushToast(`${SLOT_LABEL[slot]} deleted.`, 'info');
      refresh();
    } else {
      const result = flow.loadSlot(slot);
      if (result.ok) onLoaded?.();
      else refresh();
    }
  };

  const anySave = slots.some((s) => s.exists);

  return (
    <div className="saveload" data-testid="saveload">
      {mode === 'both' && !gameRunning && <p className="saveload__note">There is no running game to save.</p>}
      {mode === 'load' && !anySave && (
        <EmptyState icon="folder" hint="Start a new colony, and it is saved automatically.">
          No saved games yet.
        </EmptyState>
      )}
      <ul className="slot-list">
        {slots.map((info) => {
          const isPending = pending?.slot === info.slot;
          const manual = info.slot !== 'autosave';
          return (
            <li key={info.slot} className={`slot ${info.exists ? '' : 'slot--empty'} ${info.error ? 'slot--broken' : ''}`} data-testid={`slot-${info.slot}`}>
              <div className="slot__label">
                <Icon name={manual ? 'save' : 'flag'} size={16} />
                <span>{SLOT_LABEL[info.slot]}</span>
              </div>
              <div className="slot__meta">
                {info.summary ? (
                  <>
                    <div className="slot__title">{info.summary.colonyName}</div>
                    <div className="slot__line">
                      Day {info.summary.day}, {formatClock(info.summary.timeOfDay)} · {pluralize(info.summary.population, 'settler')} ·{' '}
                      {PRESET_INFO[info.summary.preset]?.name ?? info.summary.preset}
                    </div>
                    <div className="slot__line slot__line--dim" title={formatDateTime(info.savedAt)}>
                      Saved {formatRelativeTime(info.savedAt, now)}
                    </div>
                  </>
                ) : info.error ? (
                  <>
                    <div className="slot__title">Unreadable save</div>
                    <div className="slot__line slot__line--error">{info.error}</div>
                  </>
                ) : (
                  <div className="slot__line slot__line--dim">{manual ? 'Empty slot' : 'No autosave yet. One is made at the start of every day.'}</div>
                )}
              </div>
              <div className="slot__actions">
                {isPending && pending ? (
                  <div className="slot__confirm" role="group" aria-label="Confirm">
                    <span className="slot__confirm-text">
                      {pending.action === 'delete' ? 'Delete this save?' : pending.action === 'save' ? 'Overwrite it?' : 'Replace the current game?'}
                    </span>
                    <button type="button" className={`btn small ${pending.action === 'delete' ? 'danger' : 'primary'}`} onClick={() => run(info.slot, pending.action, true)} data-testid="confirm-yes" data-autofocus>
                      {pending.action === 'delete' ? 'Delete' : pending.action === 'save' ? 'Overwrite' : 'Load'}
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setPending(null)} data-testid="confirm-no">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    {manual && mode === 'both' && (
                      <button type="button" className="btn small" disabled={!canSave} onClick={() => run(info.slot, 'save', false)} data-testid={`save-${info.slot}`}>
                        Save
                      </button>
                    )}
                    <button type="button" className="btn small" disabled={!info.exists || info.error !== null} onClick={() => run(info.slot, 'load', false)} data-testid={`load-${info.slot}`}>
                      Load
                    </button>
                    <button type="button" className="btn small ghost icon-only" disabled={!info.exists} onClick={() => run(info.slot, 'delete', false)} aria-label={`Delete ${SLOT_LABEL[info.slot]}`} data-testid={`delete-${info.slot}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="saveload__foot">Games are stored in this browser. The autosave is refreshed at the start of every day.</p>
    </div>
  );
}
