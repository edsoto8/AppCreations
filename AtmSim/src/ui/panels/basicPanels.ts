import type { Ctx } from '../context';
import { COMPONENT_DEVICE } from '../context';
import type { ComponentId, DenomCounts, DeviceStatus, Transaction, TxnState, DispenseStrategy, Denomination } from '../../core/types';
import { FINAL_TXN_STATES, DENOMINATIONS } from '../../core/types';
import { componentInfo, COMPONENT_ORDER } from '../../knowledge/components';
import { formatCents, formatWhole } from '../../core/money';
import { h, mount, fmtTime } from '../dom';

export function statusBadge(s: DeviceStatus | string): HTMLElement {
  const cls = s === 'OK' ? 'ok' : s === 'WARNING' ? 'warn' : s === 'FAULT' || s === 'OFFLINE' ? 'err' : 'dim';
  return h('span', { class: `badge ${cls}` }, s);
}

const INTERNAL_GROUPS = new Set(['Upper module', 'Cash dispenser', 'Safe', 'Deposit']);

// ───────────────────────────── Details ─────────────────────────────

export function renderDetails(ctx: Ctx, el: HTMLElement): void {
  const id = ctx.ui.selected;
  if (!id) {
    mount(
      el,
      h(
        'div',
        { class: 'card' },
        h('h3', null, 'Component inspector'),
        h('p', null, 'Hover over the ATM to identify parts and click any part to see what it does, how it works, how it fails and how it is maintained.'),
        h('p', { class: 'muted' }, 'Tip: switch to X-ray, Cutaway, Exploded or Internal view (top-left of the viewport) to reach the mechanisms inside.'),
      ),
      h('div', { class: 'card' }, h('h4', null, 'All components'), componentList(ctx)),
    );
    return;
  }
  const info = componentInfo(id);
  const dev = COMPONENT_DEVICE[id];
  const health = dev ? ctx.sys.devices.get(dev) : undefined;
  const internal = INTERNAL_GROUPS.has(info.group);
  mount(
    el,
    h(
      'div',
      { class: 'card', 'data-component': id },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('h3', null, info.name), h('span', { class: 'badge info' }, info.group)),
      health ? h('div', { style: 'margin:4px 0 6px' }, 'Device health: ', statusBadge(health.status), ' ', h('span', { class: 'muted' }, health.detail)) : null,
      h('p', null, info.purpose),
      h(
        'div',
        { class: 'chip-row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', onclick: () => focusPart(ctx, id) }, '◎ Focus camera'),
        internal ? h('button', { class: 'btn small', onclick: () => ctx.views.setMode('internal', { moveCamera: false }) }, '🔧 Open ATM') : null,
        h('button', { class: 'btn small', onclick: () => ctx.ui.select(null) }, 'Clear selection'),
      ),
    ),
    h('div', { class: 'card' }, h('h4', null, 'How it works'), h('p', null, info.howItWorks), h('h4', null, 'Relationship to other components'), h('p', null, info.relationships)),
    h('div', { class: 'card' }, h('h4', null, 'Inputs'), h('p', null, info.inputs), h('h4', null, 'Outputs'), h('p', null, info.outputs)),
    h('div', { class: 'card' }, h('h4', null, 'Common operational failures'), h('ul', null, info.failures.map((f) => h('li', null, f)))),
    h('div', { class: 'card' }, h('h4', null, 'Maintenance considerations'), h('ul', null, info.maintenance.map((f) => h('li', null, f)))),
    info.genericNote ? h('div', { class: 'card', style: 'border-color:#3d4f72' }, h('h4', null, 'Generic design note'), h('p', null, info.genericNote)) : null,
  );
}

export function focusPart(ctx: Ctx, id: ComponentId): void {
  const obj = ctx.model.parts.get(id);
  if (!obj) return;
  const info = componentInfo(id);
  if (INTERNAL_GROUPS.has(info.group) && ctx.views.mode === 'exterior') ctx.views.setMode('internal', { moveCamera: false });
  void ctx.stage.focusObject(obj);
}

export function componentList(ctx: Ctx): HTMLElement {
  const groups = new Map<string, ComponentId[]>();
  for (const id of COMPONENT_ORDER) {
    const g = componentInfo(id).group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(id);
  }
  return h(
    'div',
    null,
    [...groups].map(([g, ids]) =>
      h(
        'details',
        { class: 'group', open: g === 'Exterior' || g === 'Cash dispenser' },
        h('summary', null, `${g} (${ids.length})`),
        h(
          'div',
          { class: 'list' },
          ids.map((id) =>
            h(
              'button',
              { class: 'item' + (ctx.ui.selected === id ? ' active' : ''), 'data-select': id, onclick: () => ctx.ui.select(id, { focus: true }) },
              h('span', { class: 'grow' }, componentInfo(id).name),
            ),
          ),
        ),
      ),
    ),
  );
}

// ───────────────────────────── Transaction ─────────────────────────────

const MAIN_PATH: TxnState[] = ['CREATED', 'AUTH_PENDING', 'AUTHORIZED', 'DISPENSING', 'PRESENTED', 'COLLECTED', 'COMPLETED'];
const EXCEPTION_STATES: TxnState[] = ['ESCROWED', 'DECLINED', 'TIMED_OUT', 'DISPENSE_FAILED', 'RETRACTED', 'SUSPECT', 'REVERSAL_PENDING', 'REVERSED', 'CANCELLED'];

const STATE_HELP: Partial<Record<TxnState, string>> = {
  AUTH_PENDING: 'Request is travelling to the bank host; nothing has been reserved yet.',
  AUTHORIZED: 'Host approved and placed a HOLD on the funds. Nothing is posted yet.',
  DISPENSING: 'Notes are being picked, checked and stacked inside the dispenser.',
  PRESENTED: 'Cash is in the shutter, waiting for the customer.',
  COLLECTED: 'Customer took the cash; the ATM sends a completion so the bank posts the debit.',
  COMPLETED: 'Posted to the ledger. Final.',
  DECLINED: 'Host (or switch) declined; no hold, no debit.',
  TIMED_OUT: 'No answer from the host in time. The host may have approved, so the ATM must reverse.',
  DISPENSE_FAILED: 'Mechanical failure before cash was presented; the authorization must be reversed.',
  RETRACTED: 'Customer did not take the cash; it was pulled back into the retract compartment.',
  SUSPECT: 'Outcome uncertain (power loss). Resolved at restart and in reconciliation.',
  REVERSAL_PENDING: 'Reversal message sent to release the hold.',
  REVERSED: 'Hold released; the customer is not charged. Final.',
  CANCELLED: 'Ended before reaching the host (or deposit returned). Final.',
  ESCROWED: 'Deposited notes are held in escrow until the customer confirms.',
};

export function currentTxn(ctx: Ctx): Transaction | undefined {
  const list = ctx.sys.journal.transactions;
  return list[list.length - 1];
}

function txnAmount(t: Transaction): string {
  if (t.type === 'BALANCE' || t.type === 'MINI_STATEMENT') return '—';
  return formatCents(t.requestedCents);
}

export function stateClass(s: TxnState): string {
  if (s === 'COMPLETED') return 'final-ok';
  if (FINAL_TXN_STATES.includes(s)) return 'final-bad';
  return '';
}

export function renderTransaction(ctx: Ctx, el: HTMLElement): void {
  const t = currentTxn(ctx);
  const visited = new Set<TxnState>(t ? [t.history[0]?.from ?? 'CREATED', ...t.history.map((x) => x.to)] : []);
  const pill = (s: TxnState) =>
    h('span', { class: `pill-state ${t?.state === s ? 'current' : visited.has(s) ? stateClass(s) || 'visited' : ''}`, style: visited.has(s) || t?.state === s ? '' : 'opacity:.35', title: STATE_HELP[s] ?? s }, s);
  const sections: Array<HTMLElement | null> = [];
  if (!t) {
    sections.push(h('div', { class: 'card' }, h('h3', null, 'No transaction yet'), h('p', null, 'Start a session in Customer mode. Every transaction moves through a lifecycle state machine; this panel shows each transition as it happens.')));
  } else {
    sections.push(
      h(
        'div',
        { class: 'card', 'data-txn': t.id, 'data-state': t.state },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h3', null, `${t.type.replace('_', ' ')} · ${txnAmount(t)}`), h('span', { class: `pill-state ${t.state === 'COMPLETED' ? 'final-ok' : FINAL_TXN_STATES.includes(t.state) ? 'final-bad' : 'current'}`, id: 'txn-state' }, t.state)),
        h(
          'div',
          { class: 'kv mono', style: 'margin-top:6px' },
          'Txn', t.id,
          'STAN', t.stan,
          'Account', t.accountId ?? '—',
          t.toAccountId ? 'To' : null, t.toAccountId ?? null,
          'Response', t.responseCode ? `${t.responseCode}` : '—',
          'Auth code', t.authCode ?? '—',
          'Presented', formatCents(t.presentedCents),
          'Collected', formatCents(t.collectedCents),
          'Posted', formatCents(t.postedCents),
        ),
        t.plan ? h('p', { class: 'muted', style: 'margin-top:6px' }, 'Dispense plan: ' + t.plan.picks.filter((p) => p.count).map((p) => `${p.count} × $${p.denom} (cassette ${p.cassette})`).join(' + ')) : null,
        t.outcome ? h('p', { style: 'margin-top:6px' }, h('b', null, 'Outcome: '), t.outcome) : null,
        STATE_HELP[t.state] ? h('p', { class: 'muted' }, STATE_HELP[t.state]!) : null,
      ),
      h('div', { class: 'card' }, h('h4', null, 'Lifecycle — normal path'), h('div', { class: 'sm' }, MAIN_PATH.map(pill)), h('h4', null, 'Exception path'), h('div', { class: 'sm' }, EXCEPTION_STATES.map(pill))),
      h(
        'div',
        { class: 'card' },
        h('h4', null, 'State transitions'),
        h(
          'table',
          { class: 'grid' },
          h('tbody', null, t.history.map((x) => h('tr', null, h('td', { class: 'mono' }, fmtTime(x.time)), h('td', { class: 'mono' }, `${x.from} → ${x.to}`), h('td', null, x.note)))),
        ),
      ),
    );
  }
  // balances of the active card's customer
  const card = ctx.sys.ledger.cards.get(ctx.ui.activeCardId);
  if (card) {
    const accts = card.accountIds.map((id) => ctx.sys.ledger.accounts.get(id)).filter((a) => !!a);
    sections.push(
      h(
        'div',
        { class: 'card' },
        h('h4', null, `Accounts — ${card.holderName} (simulated ledger)`),
        h(
          'table',
          { class: 'grid' },
          h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', { class: 'num' }, 'Ledger'), h('th', { class: 'num' }, 'Holds'), h('th', { class: 'num' }, 'Available'))),
          h(
            'tbody',
            null,
            accts.map((a) => {
              const holds = a.holds.reduce((s, x) => s + x.amountCents, 0);
              return h(
                'tr',
                { 'data-account': a.id },
                h('td', null, `${a.nickname}`, h('div', { class: 'muted mono' }, `${a.id}${a.status !== 'ACTIVE' ? ' · ' + a.status : ''}`)),
                h('td', { class: 'num' }, formatCents(a.ledgerCents)),
                h('td', { class: 'num', style: holds ? 'color:var(--warn)' : '' }, formatCents(holds)),
                h('td', { class: 'num' }, formatCents(a.ledgerCents - holds)),
              );
            }),
          ),
        ),
        h('p', { class: 'muted' }, `Card ${card.maskedNumber} · status ${card.status} · PIN tries left ${card.pinTriesRemaining}`),
      ),
    );
  }
  const recent = ctx.sys.journal.transactions.slice(-12).reverse();
  if (recent.length > 1)
    sections.push(
      h(
        'div',
        { class: 'card' },
        h('h4', null, 'Recent transactions'),
        h(
          'table',
          { class: 'grid' },
          h('tbody', null, recent.map((x) => h('tr', null, h('td', { class: 'mono' }, x.id), h('td', null, x.type), h('td', { class: 'num' }, txnAmount(x)), h('td', null, h('span', { class: `pill-state ${stateClass(x.state)}` }, x.state))))),
        ),
      ),
    );
  mount(el, sections);
}

// ───────────────────────────── Cash ─────────────────────────────

export function denomLine(c: DenomCounts | undefined): string {
  if (!c) return '—';
  const parts = DENOMINATIONS.filter((d) => (c[d] ?? 0) > 0).map((d) => `${c[d]} × $${d}`);
  return parts.length ? parts.join(', ') : '0';
}

export function denomValue(c: DenomCounts | undefined): number {
  if (!c) return 0;
  return DENOMINATIONS.reduce((s, d) => s + (c[d] ?? 0) * d * 100, 0);
}

export function renderCash(ctx: Ctx, el: HTMLElement, opts: { full?: boolean } = {}): void {
  const s = ctx.sys.inventory.snapshot();
  const totalNotes = s.cassettes.reduce((a, c) => a + c.counter, 0);
  const strategies: Array<{ id: DispenseStrategy; label: string; tip: string }> = [
    { id: 'min-notes', label: 'Fewest notes', tip: 'Largest denominations first — fewest notes, fastest dispense' },
    { id: 'balanced', label: 'Balanced', tip: 'Prefer the fullest cassettes so they run down evenly' },
    { id: 'small-notes', label: 'Small notes', tip: 'Customer-friendly mix with more small notes' },
  ];
  mount(
    el,
    s.lowCash ? h('div', { class: 'card', style: 'border-color:#7a5a1a;background:#2a210c' }, h('b', { style: 'color:var(--warn)' }, '⚠ Low-cash warning: '), 'one or more cassettes is below its low threshold. Schedule replenishment.') : null,
    h(
      'div',
      { class: 'cols', style: 'margin-bottom:10px' },
      h('div', { class: 'stat' }, h('div', { class: 'v', id: 'inv-available' }, formatWhole(s.availableCents)), h('div', { class: 'l' }, `Available to dispense · ${totalNotes.toLocaleString()} notes`)),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, formatWhole(s.totals.dispensedCents)), h('div', { class: 'l' }, 'Cash dispensed (collected)')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, formatWhole(s.totals.acceptedCents)), h('div', { class: 'l' }, 'Cash accepted (deposits)')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, `${s.totals.rejectedNotes} / ${s.totals.retractedNotes}`), h('div', { class: 'l' }, 'Notes rejected / retracted')),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Dispensing cassettes'),
      h(
        'table',
        { class: 'grid', id: 'cassette-table' },
        h('thead', null, h('tr', null, h('th', null, 'Cassette'), h('th', null, 'Denom'), h('th', { class: 'num' }, 'Notes'), h('th', { class: 'num' }, 'Total'), h('th', null, 'Status'))),
        h(
          'tbody',
          null,
          s.cassettes.map((c) => {
            const ratio = c.capacity ? c.counter / c.capacity : 0;
            return h(
              'tr',
              { 'data-cassette': c.id },
              h('td', null, h('b', null, c.id)),
              h('td', null, `$${c.denom}`),
              h('td', { class: 'num', 'data-count': String(c.counter) }, c.counter.toLocaleString(), c.physical !== c.counter && opts.full ? h('div', { class: 'muted', style: 'color:var(--warn)' }, `physical ${c.physical}`) : null),
              h('td', { class: 'num' }, formatWhole(c.counter * c.denom * 100)),
              h(
                'td',
                { style: 'min-width:90px' },
                !c.installed ? statusBadge('REMOVED') : c.status !== 'OK' ? statusBadge(c.status) : c.low ? statusBadge('WARNING') : statusBadge('OK'),
                h('div', { class: `bar ${c.counter === 0 ? 'empty' : c.low ? 'low' : ''}`, style: 'margin-top:4px' }, h('i', { style: `width:${Math.min(100, ratio * 100)}%` })),
              ),
            );
          }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Separated cash (not available to dispense)'),
      h(
        'table',
        { class: 'grid' },
        h(
          'tbody',
          null,
          binRow('Reject cassette', s.reject, 'Double/skewed/suspect notes and purged notes'),
          binRow('Retract compartment', s.retract, 'Bundles the customer did not take'),
          binRow('Deposit cassette', s.deposit, 'Accepted customer deposits'),
          binRow('Deposit escrow', s.escrow, 'Awaiting customer confirmation'),
          h('tr', null, h('td', null, 'In transport / stacker'), h('td', null, `${s.inTransport} / ${s.inStacker} notes`), h('td', { class: 'num' }, '')),
          binRow('Presented to customer', s.presented, 'In the shutter, not yet collected'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Dispense strategy'),
      h('div', { class: 'seg', id: 'strategy-seg' }, strategies.map((st) => h('button', { class: ctx.sys.config.strategy === st.id ? 'active' : '', title: st.tip, onclick: () => { ctx.sys.config.strategy = st.id; ctx.ui.toast(`Dispense strategy: ${st.label}`); ctx.ui.refresh(); } }, st.label))),
      h('p', { class: 'muted' }, strategies.find((x) => x.id === ctx.sys.config.strategy)?.tip ?? ''),
      opts.full ? planPreview(ctx) : null,
    ),
  );
}

function binRow(label: string, c: DenomCounts, tip: string): HTMLElement {
  return h('tr', { title: tip }, h('td', null, label), h('td', null, denomLine(c)), h('td', { class: 'num' }, formatWhole(denomValue(c))));
}

/** Try the dispense planner live for an amount under all strategies. */
function planPreview(ctx: Ctx): HTMLElement {
  const out = h('div', { style: 'margin-top:8px' });
  const input = h('input', { type: 'number', min: '0', step: '10', value: '180', style: 'width:100px;background:#0d1422;border:1px solid var(--line-2);color:var(--text);padding:5px;border-radius:6px', 'aria-label': 'Amount in dollars' }) as HTMLInputElement;
  const run = () => {
    const cents = Math.round(Number(input.value) * 100);
    const rows = (['min-notes', 'balanced', 'small-notes'] as DispenseStrategy[]).map((st) => {
      const r = ctx.sys.planDispense(cents, st);
      return h('tr', null, h('td', null, st), h('td', null, r.ok ? r.plan.picks.filter((p) => p.count).map((p) => `${p.count}×$${p.denom}`).join(' + ') + ` (${r.plan.totalNotes} notes)` : h('span', { style: 'color:var(--err)' }, `${r.reason}: ${r.detail}`)));
    });
    mount(out, h('table', { class: 'grid' }, h('tbody', null, rows)));
  };
  input.addEventListener('input', run);
  setTimeout(run);
  return h('div', null, h('h4', null, 'Plan preview (what the dispenser would pick)'), h('div', null, '$ ', input), out);
}

export function denomOptions(selected: Denomination): HTMLElement[] {
  return DENOMINATIONS.map((d) => h('option', { value: String(d), selected: d === selected }, `$${d}`));
}

// ───────────────────────────── Events / audit ─────────────────────────────

export function renderEvents(ctx: Ctx, el: HTMLElement): void {
  const audit = ctx.sys.journal.audit.slice(-150).reverse();
  mount(
    el,
    h('div', { class: 'card' }, h('h4', null, 'Audit log (important simulator actions & state transitions)'), h('p', { class: 'muted' }, `${ctx.sys.journal.audit.length} entries. The electronic journal streams in the bottom bar.`)),
    h(
      'table',
      { class: 'grid' },
      h('tbody', null, audit.map((a) => h('tr', null, h('td', { class: 'mono' }, fmtTime(a.time)), h('td', null, h('span', { class: 'badge dim' }, a.actor)), h('td', null, a.action, a.detail ? h('div', { class: 'muted' }, a.detail) : null)))),
    ),
  );
}
