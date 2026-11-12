import type { Ctx } from '../ui/context';
import type { KeypadKey, ScreenId, TxnState } from '../core/types';
import type { TourRun } from './TourRunner';

/** Poll a condition in sim time (so pause/step apply). Resolves false on timeout or tour cancel. */
export async function waitFor(ctx: Ctx, pred: () => boolean, run?: TourRun, timeoutSimMs = 180_000): Promise<boolean> {
  const start = ctx.clock.now();
  while (!pred()) {
    if (run?.cancelled) return false;
    if (ctx.clock.now() - start > timeoutSimMs) return false;
    await ctx.clock.wait(100);
  }
  return true;
}

export function waitScreen(ctx: Ctx, ids: ScreenId[], run?: TourRun): Promise<boolean> {
  return waitFor(ctx, () => ids.includes(ctx.sys.app.screen.id) && !ctx.sys.app.busy, run);
}

export function waitTxn(ctx: Ctx, states: TxnState[], run?: TourRun): Promise<boolean> {
  return waitFor(
    ctx,
    () => {
      const t = ctx.sys.journal.transactions[ctx.sys.journal.transactions.length - 1];
      return !!t && (states.includes(t.state) || t.history.some((x) => states.includes(x.to)));
    },
    run,
  );
}

/** Press physical keypad keys one by one (animated key travel + sound). */
export async function pressKeys(ctx: Ctx, keys: KeypadKey[], run?: TourRun): Promise<void> {
  const press = (window as unknown as { atmPressKey?: (k: KeypadKey, kb: boolean) => void }).atmPressKey;
  for (const k of keys) {
    if (run?.cancelled) return;
    if (press) press(k, true);
    else ctx.sys.app.input({ kind: 'key', key: k });
    await ctx.clock.wait(420);
  }
}

/** Touch an on-screen button (if it exists and is enabled). */
export async function touch(ctx: Ctx, id: string, run?: TourRun): Promise<boolean> {
  if (run?.cancelled) return false;
  const b = ctx.sys.app.screen.buttons.find((x) => x.id === id);
  if (!b || !b.enabled) return false;
  ctx.sfx.play('click');
  ctx.sys.app.input({ kind: 'touch', target: id });
  await ctx.clock.wait(300);
  return true;
}

/** Touch the first button whose id starts with a prefix (e.g. the first account). */
export async function touchPrefix(ctx: Ctx, prefix: string, run?: TourRun): Promise<boolean> {
  const b = ctx.sys.app.screen.buttons.find((x) => x.id.startsWith(prefix) && x.enabled);
  return b ? touch(ctx, b.id, run) : false;
}

/** Make sure the ATM is idle at the welcome screen with a usable demo card selected. */
export async function ensureIdle(ctx: Ctx, run?: TourRun): Promise<boolean> {
  if (ctx.sys.operator.active) ctx.sys.operator.exit();
  if (ctx.sys.app.sessionActive && ctx.sys.app.screen.buttons.length) {
    ctx.sys.app.input({ kind: 'key', key: 'CANCEL' });
  }
  return waitFor(ctx, () => ctx.sys.app.screen.id === 'WELCOME' && !ctx.sys.app.busy && !ctx.sys.app.sessionActive, run, 60_000);
}

export async function takeWhenPresented(ctx: Ctx, kind: 'cash' | 'card', run?: TourRun, delay = 1500): Promise<void> {
  const ok = await waitFor(ctx, () => (kind === 'cash' ? ctx.port.waitingForCash : ctx.port.waitingForCard), run);
  if (!ok) return;
  await ctx.clock.wait(delay);
  if (run?.cancelled) return;
  if (kind === 'cash') ctx.port.collectCash();
  else ctx.port.takeCard();
}
