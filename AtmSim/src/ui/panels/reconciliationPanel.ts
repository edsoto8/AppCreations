import type { Ctx } from '../context';
import { formatCents } from '../../core/money';
import { h, mount, fmtTime, confirmClick } from '../dom';

const DISCREPANCIES: Array<{ kind: 'missing-notes' | 'counter-error' | 'misloaded-note'; label: string; tip: string }> = [
  { kind: 'missing-notes', label: 'Notes missing from a cassette', tip: 'Physically remove notes without updating the counters (e.g. a miscounted replenishment).' },
  { kind: 'counter-error', label: 'Counter error', tip: 'The machine counter drifts away from the real note count.' },
  { kind: 'misloaded-note', label: 'Wrong denomination loaded', tip: 'A note of another denomination is loaded into a cassette.' },
];

function line(label: string, cents: number, note = '', cls = ''): HTMLElement {
  return h('div', { class: `report-line ${cls}` }, h('span', null, label), h('span', { class: 'muted' }, note), h('span', { class: 'num' }, formatCents(cents)));
}

/** End-of-day cash balancing: journal vs. counters vs. physical count, with discrepancy injection. */
export function renderReconciliation(ctx: Ctx, el: HTMLElement): void {
  const r = ctx.sys.recon.report();
  const sev = (s: string) => (s === 'critical' ? 'err' : s === 'warning' ? 'warn' : 'info');
  const auditTail = ctx.sys.journal.audit.slice(-25).reverse();
  mount(
    el,
    h(
      'div',
      { class: 'card', style: `border-color:${r.balanced ? '#2c7a59' : '#7a2c3a'}`, id: 'recon-status', 'data-balanced': String(r.balanced) },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h3', null, 'Daily cash balancing'), h('span', { class: `badge ${r.balanced ? 'ok' : 'err'}` }, r.balanced ? 'BALANCED' : 'DIFFERENCES FOUND')),
      h('p', { class: 'muted' }, `Business period ${fmtTime(r.baselineTime)} → ${fmtTime(r.time)}. Physical count is taken from the actual notes in each cassette and bin.`),
      h(
        'div',
        { class: 'cols3', style: 'margin-top:6px' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, formatCents(r.expectedEndingCents)), h('div', { class: 'l' }, 'Expected (per journal)')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, formatCents(r.counterEndingCents)), h('div', { class: 'l' }, 'Machine counters')),
        h('div', { class: 'stat' }, h('div', { class: 'v', style: r.physicalEndingCents !== r.expectedEndingCents ? 'color:var(--err)' : '' }, formatCents(r.physicalEndingCents)), h('div', { class: 'l' }, 'Observed (physical count)')),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Balancing statement'),
      line('Beginning inventory', r.beginningCents, 'start of business day'),
      line('+ Replenishments', r.replenishedCents, 'loaded from vault'),
      line('− Cassette unloads', -r.unloadedCents, 'returned to vault'),
      line('− Cash dispensed (journal)', -r.dispensedPerJournalCents, `device ${formatCents(r.dispensedPerDeviceCents)} · host ${formatCents(r.hostPostedCents)}`),
      line('+ Deposits accepted', r.depositsCents, 'deposit cassette'),
      line('Rejected notes (still bank cash)', r.rejectedCents, `${r.rejectedNotes} notes in reject cassette`),
      line('Retracted notes (still bank cash)', r.retractedCents, `${r.retractedNotes} notes in retract bin`),
      line('− Bins emptied to vault', -r.binsEmptiedCents, 'recorded removals'),
      line('= Expected ending inventory', r.expectedEndingCents, '', 'total'),
      line('Observed physical count', r.physicalEndingCents, r.unaccountedNotes ? `${r.unaccountedNotes} notes unaccounted` : '', 'total'),
      line('Difference', r.physicalEndingCents - r.expectedEndingCents, r.physicalEndingCents === r.expectedEndingCents ? 'balanced' : 'investigate', 'total'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Per cassette (notes)'),
      h(
        'table',
        { class: 'grid', id: 'recon-cassettes' },
        h('thead', null, h('tr', null, ['Cassette', 'Begin', '+Load', '−Unload', '−Picked', 'Expected', 'Counter', 'Physical'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h(
          'tbody',
          null,
          r.cassettes.map((c) =>
            h(
              'tr',
              { class: c.physical !== c.expected || c.counter !== c.expected || c.misdenominated ? 'diff' : '' },
              h('td', null, `${c.id} ($${c.denom})`, c.misdenominated ? h('div', { style: 'color:var(--err);font-size:11px' }, `${c.misdenominated} wrong-denomination note(s)`) : null),
              h('td', { class: 'num' }, c.beginning),
              h('td', { class: 'num' }, c.loaded),
              h('td', { class: 'num' }, c.unloaded),
              h('td', { class: 'num' }, c.picked),
              h('td', { class: 'num' }, c.expected),
              h('td', { class: 'num' }, c.counter),
              h('td', { class: 'num' }, c.physical),
            ),
          ),
        ),
      ),
      h('p', { class: 'muted' }, `Bins: reject ${r.bins.reject} · retract ${r.bins.retract} · deposit ${r.bins.deposit} notes.`),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Differences requiring investigation'),
      r.differences.length
        ? r.differences.map((d) => h('div', { style: 'margin:6px 0', 'data-difference': d.title }, h('span', { class: `badge ${sev(d.severity)}` }, d.severity.toUpperCase()), ' ', h('b', null, d.title), h('p', { style: 'margin:3px 0' }, d.explanation)))
        : h('p', { class: 'muted' }, 'None. Journal, counters and physical cash agree.'),
      h('h4', null, 'How differences are detected'),
      h('ul', null, r.method.map((m) => h('li', null, m))),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Training: introduce a deliberate discrepancy'),
      h(
        'div',
        { class: 'chip-row' },
        DISCREPANCIES.map((d) =>
          h('button', { class: 'btn small', title: d.tip, 'data-discrepancy': d.kind, onclick: () => { const msg = ctx.sys.recon.injectDiscrepancy(d.kind); ctx.ui.toast(msg, 'warn'); ctx.ui.refresh(); } }, d.label),
        ),
      ),
      h(
        'div',
        { class: 'chip-row', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', id: 'close-day', onclick: () => { ctx.sys.recon.closeDay(); ctx.ui.toast('Business day closed: ending inventory becomes the new beginning inventory', 'ok'); ctx.ui.refresh(); } }, 'Close business day'),
        h('button', { class: 'btn danger', onclick: (e: Event) => confirmClick(e.currentTarget as HTMLElement, 'Click again to reset', () => ctx.resetAll()) }, 'Reset simulator'),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Transaction journal summary'),
      h(
        'table',
        { class: 'grid' },
        h('thead', null, h('tr', null, h('th', null, 'Txn'), h('th', null, 'Type'), h('th', null, 'State'), h('th', { class: 'num' }, 'Collected'), h('th', { class: 'num' }, 'Posted'))),
        h(
          'tbody',
          null,
          ctx.sys.journal.transactions
            .slice(-30)
            .reverse()
            .map((t) => h('tr', null, h('td', { class: 'mono' }, t.id), h('td', null, t.type), h('td', null, t.state), h('td', { class: 'num' }, formatCents(t.collectedCents)), h('td', { class: 'num' }, formatCents(t.postedCents)))),
        ),
      ),
    ),
    h('div', { class: 'card' }, h('h4', null, 'Audit log (latest)'), h('div', { class: 'mono', style: 'max-height:200px;overflow:auto' }, auditTail.map((a) => h('div', null, `${fmtTime(a.time)} ${a.actor} · ${a.action}${a.detail ? ' — ' + a.detail : ''}`)))),
  );
}
