import type { Ctx } from '../context';
import type { CassetteId, DeviceId, Denomination } from '../../core/types';
import { formatWhole } from '../../core/money';
import { h, mount, fmtTime } from '../dom';
import { statusBadge, denomLine, denomValue, denomOptions } from './basicPanels';

let testOutput: { device: DeviceId; passed: boolean; lines: string[] } | undefined;
const TESTABLE: DeviceId[] = ['dispenser', 'printer', 'cardReader', 'contactless', 'network', 'depositModule'];

async function act(ctx: Ctx, label: string, fn: () => unknown): Promise<void> {
  try {
    const r = (await fn()) as { ok?: boolean; message?: string } | undefined;
    if (r && r.ok === false) ctx.ui.toast(r.message ?? `${label}: refused`, 'warn');
    else ctx.ui.toast(r?.message ?? label, 'ok');
  } catch (err) {
    ctx.ui.toast(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
  }
  ctx.ui.refresh();
}

/** Operator & maintenance training console (separate from customer mode). */
export function renderMaintenance(ctx: Ctx, el: HTMLElement): void {
  const op = ctx.sys.operator;
  const inv = ctx.sys.inventory;
  const snap = inv.snapshot();
  const on = op.active;
  const dis = !on;
  const doorsOpen = ctx.views.doorsHeldOpen || ctx.views.mode === 'internal';
  const devices = ctx.sys.devices.all();
  const journal = ctx.sys.journal.entries.slice(-60).reverse();

  mount(
    el,
    h(
      'div',
      { class: 'card', style: on ? 'border-color:#7a5a1a' : '' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('h3', null, 'Operator session'), on ? h('span', { class: 'badge warn' }, 'IN MAINTENANCE') : h('span', { class: 'badge ok' }, 'IN SERVICE')),
      h('p', { class: 'muted' }, on ? 'The ATM shows “temporarily out of service” to customers while you work. Every action is written to the journal and audit log.' : 'Start an operator session to service the ATM. It can only start between customer sessions.'),
      h(
        'div',
        { class: 'chip-row' },
        on
          ? h('button', { class: 'btn primary', id: 'op-exit', onclick: () => act(ctx, 'Operator session closed — ATM back in service', () => op.exit()) }, 'Exit maintenance')
          : h('button', { class: 'btn primary', id: 'op-enter', disabled: ctx.sys.app.sessionActive, onclick: () => act(ctx, 'Operator session started', () => op.enter()) }, 'Enter maintenance'),
        h('button', { class: 'btn', onclick: () => { ctx.views.holdDoorsOpen(!doorsOpen); ctx.ui.refresh(); } }, doorsOpen ? 'Close doors' : 'Open service door & safe'),
        h('button', { class: 'btn', onclick: () => ctx.ui.setMode('reconciliation') }, 'End-of-day reconciliation ›'),
      ),
      h('p', { class: 'muted', style: 'font-size:11px;margin-top:8px' }, 'Training simulation only: no real service credentials, lock procedures or security bypass information is included.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Maintenance checklist'),
      op.checklist.map((c) => h('div', { class: 'check' + (c.done ? ' done' : '') }, h('span', { class: 'box' }, c.done ? '✓' : ''), h('span', { class: 'lbl' }, c.label))),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Cash cassettes'),
      snap.cassettes.map((c) => {
        const id = c.id as CassetteId;
        const denomSel = h('select', { class: 'field', disabled: dis, 'aria-label': `Denomination for cassette ${id}` }, denomOptions(c.denom)) as HTMLSelectElement;
        const countIn = h('input', { class: 'field', type: 'number', min: '0', max: String(c.capacity), value: '500', style: 'width:70px', disabled: dis, 'aria-label': 'Notes to load' }) as HTMLInputElement;
        return h(
          'div',
          { style: 'border-top:1px solid var(--line);padding:8px 0', 'data-op-cassette': id },
          h(
            'div',
            { style: 'display:flex;justify-content:space-between;align-items:center' },
            h('b', null, `Cassette ${id} · $${c.denom}`),
            h('span', null, c.installed ? statusBadge(c.status) : statusBadge('REMOVED'), ' ', c.low ? statusBadge('WARNING') : null),
          ),
          h('div', { class: 'muted' }, `Counter ${c.counter} · physical ${c.physical}${c.physical !== c.counter ? ' ⚠ mismatch' : ''} · capacity ${c.capacity} · ${formatWhole(c.counter * c.denom * 100)}`),
          h('div', { class: 'bar' + (c.low ? ' low' : ''), style: 'margin:5px 0' }, h('i', { style: `width:${(c.physical / c.capacity) * 100}%` })),
          h(
            'div',
            { class: 'chip-row' },
            h('button', { class: 'btn small', disabled: dis || !c.installed, onclick: () => act(ctx, `Cassette ${id}: +100 notes from vault`, () => op.replenish(id, 100)) }, '+100'),
            h('button', { class: 'btn small', disabled: dis || !c.installed, onclick: () => act(ctx, `Cassette ${id} filled to capacity`, () => op.replenish(id, c.capacity - c.counter)) }, 'Fill'),
            c.installed
              ? h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, `Cassette ${id} removed`, () => op.removeCassette(id)) }, 'Remove')
              : h('button', { class: 'btn small primary', disabled: dis, onclick: () => act(ctx, `Cassette ${id} installed`, () => op.installCassette(id)) }, 'Install'),
            h('span', { class: 'muted' }, 'Reconfigure:'),
            denomSel,
            countIn,
            h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, `Cassette ${id} reconfigured`, () => op.reconfigureCassette(id, Number(denomSel.value) as Denomination, Number(countIn.value))) }, 'Apply'),
          ),
        );
      }),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Bins (counted separately from dispensable cash)'),
      h(
        'table',
        { class: 'grid' },
        h(
          'tbody',
          null,
          (
            [
              ['reject', 'Reject cassette', snap.reject],
              ['retract', 'Retract compartment', snap.retract],
              ['deposit', 'Deposit cassette', snap.deposit],
            ] as const
          ).map(([bin, label, counts]) =>
            h('tr', null, h('td', null, label), h('td', null, denomLine(counts)), h('td', { class: 'num' }, formatWhole(denomValue(counts))), h('td', null, h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, `${label} emptied to the vault (recorded)`, () => op.emptyBin(bin)) }, 'Empty'))),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Device health & diagnostics'),
      h(
        'table',
        { class: 'grid' },
        h(
          'tbody',
          null,
          devices.map((d) =>
            h(
              'tr',
              { 'data-device': d.id },
              h('td', null, d.name, h('div', { class: 'muted', style: 'font-size:11px' }, d.detail), h('div', { class: 'muted mono', style: 'font-size:10.5px' }, Object.entries(d.metrics).map(([k, v]) => `${k}:${v}`).join(' '))),
              h('td', null, statusBadge(d.status)),
              h(
                'td',
                { style: 'white-space:nowrap' },
                h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, `${d.name} reset`, () => op.resetDevice(d.id)) }, 'Reset'),
                TESTABLE.includes(d.id)
                  ? h(
                      'button',
                      {
                        class: 'btn small',
                        disabled: dis,
                        onclick: async () => {
                          const r = await op.runTest(d.id);
                          testOutput = { device: d.id, ...r };
                          ctx.ui.toast(`${d.name} test ${r.passed ? 'passed' : 'FAILED'}`, r.passed ? 'ok' : 'err');
                          ctx.ui.refresh();
                        },
                      },
                      'Test',
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
      testOutput ? h('div', { class: 'mono', style: 'margin-top:8px;background:#0d1422;padding:6px 8px;border-radius:6px' }, h('b', null, `${testOutput.device} test: ${testOutput.passed ? 'PASS' : 'FAIL'}`), testOutput.lines.map((l) => h('div', null, l))) : null,
      h(
        'div',
        { class: 'chip-row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, 'Jam cleared — notes purged to reject', () => op.clearJam()) }, 'Clear jam'),
        h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, 'Receipt paper loaded', () => op.loadPaper()) }, 'Load paper'),
        h('button', { class: 'btn small', onclick: () => act(ctx, 'Power restored', () => op.restorePower()) }, 'Restore power'),
        h('button', { class: 'btn small', disabled: dis, onclick: () => act(ctx, 'Retained cards returned to customers', () => op.returnRetainedCards()) }, 'Return retained cards'),
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Inventory discrepancies (counters vs physical notes)'),
      snap.cassettes.some((c) => c.counter !== c.physical)
        ? h('ul', null, snap.cassettes.filter((c) => c.counter !== c.physical).map((c) => h('li', null, `Cassette ${c.id}: counter ${c.counter}, physical ${c.physical} (${c.physical - c.counter > 0 ? '+' : ''}${c.physical - c.counter} notes). Investigate before closing the day.`)))
        : h('p', { class: 'muted' }, 'Counters agree with the physical notes in every cassette.'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Electronic journal (latest first)'),
      h('div', { class: 'mono', style: 'max-height:260px;overflow:auto' }, journal.map((j) => h('div', { class: `k-${j.kind}`, style: 'padding:1px 0;color:#9fb0c8' }, `${fmtTime(j.time)} ${j.kind.padEnd(8)} ${j.txnId ?? ''} ${j.text}`))),
    ),
  );
}
