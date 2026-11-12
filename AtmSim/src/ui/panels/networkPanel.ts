import type { Ctx } from '../context';
import { NetworkViz, renderMessageLog } from '../NetworkViz';
import { h, mount } from '../dom';

let bigViz: NetworkViz | undefined;
let logEl: HTMLElement | undefined;

const CONCEPTS: Array<[string, string]> = [
  ['Card authentication', 'The ATM sends a token for the card (never the card data itself in this simulator). The host checks the card is active, not blocked, expired or retained.'],
  ['PIN verification (simulated)', 'The PIN is turned into an encrypted “PIN block” inside the keypad in real ATMs. Here a toy hash labelled SIMPIN-… stands in for it — it is NOT real cryptography. The host recomputes and compares; three wrong PINs block the card (code 75).'],
  ['Balance & available funds', 'Available = ledger balance − holds. The host declines with code 51 when the request exceeds available funds, 61 when it exceeds the daily limit, 57 if the account is frozen.'],
  ['Authorization', 'An approval places a HOLD for the amount and returns an authorization code. Nothing is posted to the account yet.'],
  ['Completion & posting', 'Only after the customer takes the cash does the ATM send a completion. The host then posts a double-entry debit (customer account) / credit (ATM cash GL) and releases the hold.'],
  ['Transaction journal', 'Every step is written to the ATM’s electronic journal and the host’s log, so either side can be audited and reconciled later.'],
  ['Reversals', 'If the cash was not dispensed, not collected, or the outcome is unknown, the ATM sends a reversal to release the hold. Reversals are idempotent: sending one twice is harmless.'],
  ['Timeouts', 'If the response never arrives the ATM cannot know whether the host approved. It must assume it might have, and reverse — otherwise a hold could linger.'],
  ['Declines from the switch', 'When the issuer host is unreachable the network switch answers on its behalf (code 91, issuer unavailable). Some networks perform “stand-in” approvals; this simulator declines.'],
  ['Settlement (concept)', 'At the end of the business day the network and banks settle the totals of completed transactions between each other. Reconciliation compares those totals with the ATM’s own journal and cash.'],
];

export function renderNetwork(ctx: Ctx, el: HTMLElement): void {
  if (!bigViz) {
    bigViz = new NetworkViz(ctx.bus, ctx.clock, () => ctx.sys.config.hostHopLatencyMs, true);
    logEl = h('div', { id: 'net-log' });
    bigViz.onLog(() => logEl && renderMessageLog(logEl, bigViz!.log));
    if (ctx.sys.faults.isArmed('host-unavailable')) bigViz.setDown('HOST', true);
  }
  renderMessageLog(logEl!, bigViz.log);
  mount(
    el,
    h(
      'div',
      { class: 'card' },
      h('h3', null, 'ATM → Controller → Switch → Authorization host → Ledger'),
      h('p', { class: 'muted' }, 'Each request is animated hop by hop at simulation speed. Pause or step the timeline to read each message as it moves. Hover a box for its role.'),
      bigViz.el,
      h(
        'div',
        { class: 'chip-row', style: 'margin-top:6px' },
        h('span', { class: 'muted' }, 'Hop latency'),
        h(
          'select',
          {
            class: 'field',
            onchange: (e: Event) => {
              ctx.sys.config.hostHopLatencyMs = Number((e.target as HTMLSelectElement).value);
              ctx.ui.toast(`Hop latency ${ctx.sys.config.hostHopLatencyMs} ms (sim time)`);
            },
          },
          [150, 350, 700, 1200].map((v) => h('option', { value: String(v), selected: ctx.sys.config.hostHopLatencyMs === v }, `${v} ms`)),
        ),
        h('button', { class: 'btn small', onclick: () => { ctx.ui.setMode('troubleshoot'); ctx.troubleshoot.select('network-timeout'); } }, 'Demo: timeout + reversal'),
        h('button', { class: 'btn small', onclick: () => { ctx.ui.setMode('troubleshoot'); ctx.troubleshoot.select('host-unavailable'); } }, 'Demo: host unavailable'),
        h('button', { class: 'btn small', onclick: () => { ctx.ui.setMode('troubleshoot'); ctx.troubleshoot.select('insufficient-funds'); } }, 'Demo: decline 51'),
      ),
    ),
    h('div', { class: 'card' }, h('h4', null, 'Messages (newest first, fictional & readable)'), logEl!),
    h('div', { class: 'card' }, h('h4', null, 'Concepts'), CONCEPTS.map(([t, d]) => h('div', { style: 'margin:6px 0' }, h('b', null, t), h('p', { style: 'margin:2px 0' }, d)))),
    h('p', { class: 'muted' }, 'Educational model only — not a production banking protocol. No real card data, PINs, credentials or connectivity are used.'),
  );
}
