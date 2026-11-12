import * as THREE from 'three';
import type { Ctx } from '../context';
import type { FaultDefinition, FaultId, Transaction } from '../../core/types';
import { FAULTS } from '../../faults/catalog';
import { runScenario, recoverFault } from '../../faults/autopilot';
import { componentInfo } from '../../knowledge/components';
import { formatCents } from '../../core/money';
import { h, mount } from '../dom';
import { stateClass } from './basicPanels';

const CATEGORY_ORDER: FaultDefinition['category'][] = ['ACCOUNT', 'CASH', 'MECHANICAL', 'PERIPHERAL', 'COMMUNICATION', 'CUSTOMER', 'POWER'];

/** Drives the troubleshooting workflow: select a scenario, run the autopilot demo, perform recovery. */
export class TroubleshootController {
  selected: FaultId | null = null;
  running = false;
  log: string[] = [];
  lastTxn?: Transaction;
  lastSummary = '';
  private ctx!: Ctx;

  attach(ctx: Ctx): void {
    this.ctx = ctx;
    ctx.bus.on('reset', () => {
      this.running = false;
      this.log = [];
      this.lastTxn = undefined;
      this.lastSummary = '';
    });
  }

  select(id: FaultId): void {
    this.selected = id;
    const c = this.ctx;
    c.ui.showTab('troubleshoot');
    const def = FAULTS.find((f) => f.id === id)!;
    const objs = def.components.map((cid) => c.model.parts.get(cid)).filter((o): o is THREE.Object3D => !!o);
    c.stage.alertOutline.selectedObjects = objs;
    c.ui.refresh();
  }

  focusComponents(def: FaultDefinition): void {
    const c = this.ctx;
    const internal = def.components.some((id) => componentInfo(id).group !== 'Exterior');
    if (internal && c.views.mode === 'exterior') c.views.setMode('xray', { moveCamera: false });
    const objs = def.components.map((cid) => c.model.parts.get(cid)).filter((o): o is THREE.Object3D => !!o);
    if (!objs.length) return;
    const group = new THREE.Box3();
    for (const o of objs) group.expandByObject(o);
    const center = group.getCenter(new THREE.Vector3());
    const size = group.getSize(new THREE.Vector3()).length();
    void c.stage.focus(center.clone().add(new THREE.Vector3(0.55, 0.25, 1).normalize().multiplyScalar(Math.max(0.9, size * 1.6))), center);
  }

  private say(t: string): void {
    this.log.push(t);
    if (this.log.length > 30) this.log.shift();
    this.ctx.ui.refresh();
  }

  /** Waits (in sim time, so pause/step apply) for the ATM to present something, then takes it. */
  private async takeWhenReady(kind: 'cash' | 'card'): Promise<void> {
    const c = this.ctx;
    for (let i = 0; i < 600; i++) {
      const waiting = kind === 'cash' ? c.port.waitingForCash : c.port.waitingForCard;
      if (waiting) {
        await c.clock.wait(1400);
        if (kind === 'cash') c.port.collectCash();
        else {
          c.port.takeCard();
          c.mech.takeCard();
        }
        return;
      }
      await c.clock.wait(100);
    }
  }

  async run(id: FaultId): Promise<void> {
    const c = this.ctx;
    if (this.running) return;
    if (c.sys.app.sessionActive || c.sys.app.busy) {
      c.ui.toast('Finish the current customer session first (or press Reset).', 'warn');
      return;
    }
    if (c.sys.operator.active) c.sys.operator.exit();
    const def = FAULTS.find((f) => f.id === id)!;
    this.selected = id;
    this.running = true;
    this.log = [];
    this.lastTxn = undefined;
    c.ui.setActiveCard(def.demo.cardId);
    c.ui.showTab('troubleshoot');
    c.sfx.unlock();
    const f = c.model.anchors.focus.front;
    void c.stage.focus(f.position, f.target);
    if (c.views.mode !== 'exterior' && c.views.mode !== 'xray') c.views.setMode('exterior', { moveCamera: false });
    this.say(`Scenario: ${def.title}`);
    try {
      const res = await runScenario(c.sys, id, {
        collectCash: () => void this.takeWhenReady('cash'),
        takeCard: () => void this.takeWhenReady('card'),
        onStep: (t) => this.say(t),
      });
      this.lastTxn = res.txn;
      this.lastSummary = res.summary;
      this.say('Done. ' + res.summary);
      this.focusComponents(def);
    } catch (err) {
      this.say('Scenario stopped: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      this.running = false;
      c.ui.refresh();
    }
  }

  /** Performs the technician's recovery workflow for a fault (domain `recoverFault`), logging each step. */
  async recover(id: FaultId): Promise<void> {
    const c = this.ctx;
    if (this.running) return;
    if (c.sys.app.sessionActive && id !== 'power-loss') {
      c.ui.toast('Wait for the customer session to end before servicing the ATM.', 'warn');
      return;
    }
    this.running = true;
    this.say('Recovery: technician opens the ATM…');
    const doorsWere = c.views.doorsHeldOpen;
    c.views.holdDoorsOpen(true);
    try {
      const lines = await recoverFault(c.sys, id);
      for (const l of lines) this.say('🔧 ' + l);
      c.ui.toast('Recovery complete — ATM back in service', 'ok');
    } catch (err) {
      c.ui.toast('Recovery failed: ' + (err instanceof Error ? err.message : String(err)), 'err');
    } finally {
      this.running = false;
      await c.clock.wait(1200);
      c.views.holdDoorsOpen(doorsWere);
      c.ui.refresh();
    }
  }
}

export function renderTroubleshoot(ctx: Ctx, el: HTMLElement): void {
  const tc = ctx.troubleshoot;
  const def = tc.selected ? FAULTS.find((f) => f.id === tc.selected) : undefined;
  const faults = ctx.sys.faults;
  const byCat = CATEGORY_ORDER.map((cat) => [cat, FAULTS.filter((f) => f.category === cat)] as const).filter(([, l]) => l.length);
  const devicesBad = ctx.sys.devices.all().filter((d) => d.status !== 'OK');
  mount(
    el,
    def
      ? h(
          'div',
          { class: 'card', style: 'border-color:#7a2c3a', 'data-fault': def.id },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:6px' }, h('h3', null, def.title), h('span', { class: 'badge err' }, def.category)),
          h(
            'div',
            { class: 'chip-row', style: 'margin:8px 0' },
            h('button', { class: 'btn primary', id: 'run-scenario', disabled: tc.running, onclick: () => void tc.run(def.id) }, tc.running ? '⏳ Running…' : '▶ Run demonstration'),
            faults.isArmed(def.id)
              ? h('button', { class: 'btn', onclick: () => { faults.disarm(def.id); ctx.ui.refresh(); } }, 'Disarm')
              : h('button', { class: 'btn', title: 'Arm the fault, then operate the ATM yourself in Customer mode', onclick: () => { faults.arm(def.id); ctx.ui.toast(`Armed: ${def.title}. Use the ATM to trigger it.`, 'warn'); ctx.ui.refresh(); } }, 'Arm only'),
            h('button', { class: 'btn', id: 'recover-fault', disabled: tc.running, onclick: () => void tc.recover(def.id) }, '🔧 Perform recovery'),
            h('button', { class: 'btn small', onclick: () => tc.focusComponents(def) }, '◎ Show components'),
          ),
          faults.isArmed(def.id) ? h('p', null, h('span', { class: 'badge warn' }, 'ARMED'), ' ', def.latching ? 'Latching: stays active until the recovery action.' : 'One-shot: triggers once on the next matching operation.') : null,
          h('h4', null, '1 · What happened'),
          h('p', null, def.explanation),
          h('h4', null, '2–3 · Affected components (outlined red in 3D)'),
          h('div', { class: 'chip-row' }, def.components.map((cid) => h('button', { class: 'btn small', onclick: () => ctx.ui.select(cid, { focus: true }) }, componentInfo(cid).name))),
          h('h4', null, '4 · Resulting transaction state'),
          h('p', null, def.transactionOutcome),
          tc.lastTxn
            ? h(
                'p',
                null,
                'Observed: ',
                h('span', { class: `pill-state ${stateClass(tc.lastTxn.state)}`, id: 'scenario-state' }, tc.lastTxn.state),
                ` ${tc.lastTxn.id} · presented ${formatCents(tc.lastTxn.presentedCents)} · posted ${formatCents(tc.lastTxn.postedCents)}`,
                h('button', { class: 'btn small', style: 'margin-left:6px', onclick: () => ctx.ui.showTab('transaction') }, 'Lifecycle ›'),
              )
            : null,
          h('h4', null, '5 · Customer-facing outcome'),
          h('p', null, def.customerOutcome),
          h('h4', null, '6 · Recovery workflow'),
          h('div', null, def.recovery.map((r, i) => h('div', { class: 'fault-step' }, h('span', { class: 'n' }, String(i + 1)), h('span', null, r)))),
          tc.log.length ? h('div', null, h('h4', null, 'Demonstration log'), h('div', { class: 'mono', style: 'max-height:160px;overflow:auto' }, tc.log.map((l) => h('div', null, '› ' + l)))) : null,
        )
      : h('div', { class: 'card' }, h('h3', null, 'Failure & troubleshooting simulator'), h('p', null, 'Pick a scenario. “Run demonstration” drives a customer through the transaction with the fault armed so you can watch what the machine, the host and the ledger do. “Arm only” lets you trigger it yourself. Every scenario explains the outcome and the recovery workflow.'), h('p', { class: 'muted' }, 'Note: a failure does not automatically mean the customer was charged — watch the hold, the posting and the reversal in the Transaction tab.')),
    devicesBad.length
      ? h('div', { class: 'card' }, h('h4', null, 'Devices needing attention'), devicesBad.map((d) => h('div', null, h('span', { class: `badge ${d.status === 'WARNING' ? 'warn' : 'err'}` }, d.status), ' ', d.name, ' — ', h('span', { class: 'muted' }, d.detail))))
      : null,
    byCat.map(([cat, list]) =>
      h(
        'div',
        { class: 'card' },
        h('h4', null, cat),
        h(
          'div',
          { class: 'list' },
          list.map((f) =>
            h(
              'button',
              { class: 'item' + (tc.selected === f.id ? ' active' : ''), 'data-fault-item': f.id, onclick: () => tc.select(f.id) },
              h('span', { class: 'grow' }, f.title, h('div', { class: 'sub' }, f.customerOutcome.slice(0, 90) + (f.customerOutcome.length > 90 ? '…' : ''))),
              faults.isArmed(f.id) ? h('span', { class: 'badge warn' }, 'ARMED') : null,
            ),
          ),
        ),
      ),
    ),
  );
}
