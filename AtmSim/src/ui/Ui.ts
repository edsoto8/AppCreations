import type { Ctx, AppMode, UiApi } from './context';
import { MODES } from './context';
import type { ComponentId, Card } from '../core/types';
import { componentInfo } from '../knowledge/components';
import { VIEW_MODES } from '../scene/ViewModes';
import { h, mount, rafThrottle } from './dom';
import { renderDetails, renderTransaction, renderCash, renderEvents, componentList } from './panels/basicPanels';
import { renderNetwork } from './panels/networkPanel';
import { renderMaintenance } from './panels/maintenancePanel';
import { renderTroubleshoot } from './panels/troubleshootPanel';
import { renderReconciliation } from './panels/reconciliationPanel';
import { TourRunner } from '../tutorials/TourRunner';
import { TOURS } from '../tutorials/tours';
import { formatWhole } from '../core/money';
import { DENOMINATIONS } from '../core/types';
import { FAULTS } from '../faults/catalog';

interface Tab {
  id: string;
  label: string;
  render: (el: HTMLElement) => void;
}

const CARD_COLORS: Record<string, number> = { 'card-alex': 0x1f6feb, 'card-sam': 0x2a9d8f, 'card-jordan': 0x8b5cf6, 'card-blocked': 0x6b7280 };

/** The DOM shell: mode tabs, left navigation, right-panel tabs, viewport overlays and hints. */
export class Ui implements UiApi {
  selected: ComponentId | null = null;
  mode: AppMode = 'customer';
  activeCardId = 'card-alex';
  private ctx!: Ctx;
  private rightTab = 'details';
  private tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  private tabBody = h('div', { class: 'tab-body' });
  private overlays = document.getElementById('viewport-overlays')!;
  private hintEl = h('div', { class: 'ov hint hidden', id: 'hint' });
  private stageEl = h('div', { class: 'ov stage-banner', style: 'display:none' });
  private walletEl = h('div', { class: 'ov wallet', id: 'wallet' });
  private netStrip = h('div', { class: 'ov net-strip', id: 'net-strip' });
  private toasts = h('div', { class: 'toast-wrap' });
  private viewSwitch = h('div', { class: 'ov view-switch' });
  private tourEl = h('div', { class: 'ov tour-card', style: 'display:none', id: 'tour-card' });
  tours!: TourRunner;
  private showNet = false;
  private netActiveUntil = 0;
  private refreshThrottled = rafThrottle(() => this.renderAll());

  init(ctx: Ctx): void {
    this.ctx = ctx;
    const right = document.getElementById('right-panel')!;
    mount(right, this.tabsEl, this.tabBody);
    this.overlays.append(this.viewSwitch, this.netStrip, this.stageEl, this.hintEl, this.walletEl, this.tourEl, this.toasts);
    this.netStrip.append(ctx.net.el, h('div', { class: 'last', id: 'net-last' }, 'Banking network idle'));
    this.tours = new TourRunner(ctx, this.tourEl);

    // top bar
    mount(
      document.getElementById('mode-tabs')!,
      MODES.map((m) => h('button', { class: 'mode-tab', 'data-mode': m.id, title: m.tip, onclick: () => this.setMode(m.id) }, m.label)),
    );
    const mute = document.getElementById('btn-mute')!;
    mute.addEventListener('click', () => {
      ctx.sfx.unlock();
      ctx.sfx.setMuted(!ctx.sfx.muted);
      mute.textContent = ctx.sfx.muted ? '🔇 Muted' : '🔊 Sound';
    });
    const quality = document.getElementById('btn-quality')!;
    const qs = ['high', 'medium', 'low'] as const;
    quality.addEventListener('click', () => {
      const q = qs[(qs.indexOf(ctx.stage.quality) + 1) % qs.length];
      ctx.stage.setQuality(q);
      quality.textContent = `Quality: ${q[0].toUpperCase()}${q.slice(1)}`;
      this.toast(`Visual quality: ${q}${q === 'low' ? ' (no shadows/outlines, lower resolution)' : ''}`);
    });
    document.getElementById('btn-reset')!.addEventListener('click', () => {
      if (!confirm('Reset the simulator to its initial training state? Ledger, cash, faults and journals are restored.')) return;
      ctx.resetAll();
    });

    // events that change what the panels show
    const bus = ctx.bus;
    for (const ev of ['txn.state', 'txn.created', 'inventory.changed', 'ledger.changed', 'device.changed', 'fault.armed', 'fault.cleared', 'audit'] as const) {
      bus.on(ev, () => this.refreshThrottled());
    }
    bus.on('screen.changed', ({ screen }) => {
      this.renderHint();
      if (screen.id === 'WELCOME' || screen.id === 'SERVICE_MODE') this.stageEl.style.display = 'none';
    });
    ctx.port.onChange(() => this.renderHint());
    bus.on('mech.stage', ({ label }) => {
      this.stageEl.style.display = '';
      mount(this.stageEl, h('span', { class: 'muted' }, 'Stage: '), h('b', null, label));
    });
    bus.on('net.message', (m) => {
      this.netActiveUntil = performance.now() + 7000;
      this.updateNetStrip();
      setTimeout(() => this.updateNetStrip(), 7100);
      const last = document.getElementById('net-last');
      if (last) last.textContent = `${m.from} → ${m.to}: ${m.direction === 'request' ? m.request.type + ' request' : (m.response?.code ?? '') + ' ' + (m.response?.text ?? '')}${m.dropped ? ' — LOST' : ''}`;
    });
    bus.on('reset', () => {
      this.stageEl.style.display = 'none';
      this.refreshThrottled();
    });
    this.setActiveCard(this.activeCardId);
    this.setMode('customer');
  }

  // ─────────── API ───────────

  setMode(mode: AppMode): void {
    const prev = this.mode;
    this.mode = mode;
    document.querySelectorAll<HTMLElement>('.mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const app = document.getElementById('app')!;
    app.classList.toggle('wide', ['network', 'cash', 'maintenance', 'troubleshoot', 'reconciliation'].includes(mode));
    this.walletEl.style.display = mode === 'customer' || mode === 'troubleshoot' || mode === 'network' ? '' : 'none';
    this.rightTab = mode === 'customer' ? 'transaction' : mode === 'inspect' ? 'details' : mode;
    const f = this.ctx.model.anchors.focus;
    if (prev !== mode) {
      if (mode === 'customer') {
        if (this.ctx.views.mode !== 'exterior') this.ctx.views.setMode('exterior', { moveCamera: false });
        void this.ctx.stage.focus(f.front.position, f.front.target);
      } else if (mode === 'maintenance') {
        this.ctx.views.setMode('internal', { moveCamera: false });
        void this.ctx.stage.focus(f.safe.position, f.safe.target);
      } else if (mode === 'inspect' && this.ctx.views.mode === 'exterior') {
        void this.ctx.stage.focus(f.side.position, f.side.target);
      }
      if (prev === 'maintenance' && mode !== 'maintenance' && this.ctx.sys.operator.active) {
        this.ctx.sys.operator.exit();
        this.toast('Left maintenance: operator session closed, ATM back in service', 'ok');
      }
    }
    this.renderAll();
  }

  showTab(id: string): void {
    this.rightTab = id;
    this.renderAll();
  }

  select(id: ComponentId | null, opts: { focus?: boolean } = {}): void {
    this.selected = id;
    const obj = id ? this.ctx.model.parts.get(id) : undefined;
    this.ctx.stage.selectOutline.selectedObjects = obj ? [obj] : [];
    if (id) {
      if (this.mode !== 'inspect' && this.mode !== 'maintenance' && this.mode !== 'troubleshoot') this.rightTab = 'details';
      else if (this.mode === 'inspect') this.rightTab = 'details';
      if (this.mode === 'maintenance' || this.mode === 'troubleshoot') this.rightTab = 'details';
      if (opts.focus) {
        const info = componentInfo(id);
        if (info.group !== 'Exterior' && this.ctx.views.mode === 'exterior') this.ctx.views.setMode('internal', { moveCamera: false });
        if (obj) void this.ctx.stage.focusObject(obj);
      }
      this.ctx.sfx.play('click');
    }
    this.renderAll();
  }

  toast(text: string, kind: 'info' | 'ok' | 'warn' | 'err' = 'info'): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), 4200);
  }

  setActiveCard(id: string): void {
    this.activeCardId = id;
    const card = this.ctx.sys.ledger.cards.get(id);
    if (card) this.ctx.mech.setCardAppearance(card.holderName, card.maskedNumber, CARD_COLORS[id] ?? 0x1f6feb);
    this.renderWallet();
    this.refreshThrottled();
  }

  cardUsable(): boolean {
    const app = this.ctx.sys.app;
    const card = this.ctx.sys.ledger.cards.get(this.activeCardId);
    return !!card && card.status !== 'RETAINED' && !app.sessionActive && !app.busy && app.screen.id === 'WELCOME';
  }

  insertCard(method: 'chip' | 'contactless'): void {
    this.ctx.sfx.unlock();
    const card = this.ctx.sys.ledger.cards.get(this.activeCardId);
    if (!card) return;
    if (!this.cardUsable()) {
      const s = this.ctx.sys.app.screen.id;
      this.toast(card.status === 'RETAINED' ? 'This card was retained by the ATM. Return it in Maintenance → Return retained cards.' : s === 'WELCOME' ? 'The ATM is busy.' : 'A session is already in progress — finish or cancel it first.', 'warn');
      return;
    }
    if (method === 'contactless' && !card.contactless) {
      this.toast(`${card.holderName}'s card is not contactless — insert it instead.`, 'warn');
      return;
    }
    this.ctx.sys.app.input({ kind: 'card', cardId: card.id, method });
    if (this.mode !== 'customer' && this.mode !== 'network' && this.mode !== 'troubleshoot') this.setMode('customer');
  }

  refresh(): void {
    this.refreshThrottled();
  }

  // ─────────── rendering ───────────

  private tabs(): Tab[] {
    const c = this.ctx;
    const list: Tab[] = [];
    const modeTab: Record<string, Tab> = {
      network: { id: 'network', label: 'Network', render: (el) => renderNetwork(c, el) },
      cash: { id: 'cash', label: 'Inventory', render: (el) => renderCash(c, el, { full: true }) },
      maintenance: { id: 'maintenance', label: 'Maintenance', render: (el) => renderMaintenance(c, el) },
      troubleshoot: { id: 'troubleshoot', label: 'Faults', render: (el) => renderTroubleshoot(c, el) },
      reconciliation: { id: 'reconciliation', label: 'Reconcile', render: (el) => renderReconciliation(c, el) },
    };
    if (modeTab[this.mode]) list.push(modeTab[this.mode]);
    list.push(
      { id: 'details', label: 'Details', render: (el) => renderDetails(c, el) },
      { id: 'transaction', label: 'Transaction', render: (el) => renderTransaction(c, el) },
    );
    if (this.mode !== 'cash') list.push({ id: 'cashmini', label: 'Cash', render: (el) => renderCash(c, el) });
    list.push({ id: 'events', label: 'Audit', render: (el) => renderEvents(c, el) });
    return list;
  }

  private renderAll(): void {
    if (!this.ctx) return;
    const tabs = this.tabs();
    if (!tabs.find((t) => t.id === this.rightTab)) this.rightTab = tabs[0].id;
    mount(
      this.tabsEl,
      tabs.map((t) => h('button', { class: t.id === this.rightTab ? 'active' : '', role: 'tab', 'data-tab': t.id, onclick: () => this.showTab(t.id) }, t.label)),
    );
    const scroll = this.tabBody.scrollTop;
    const active = document.activeElement;
    const keepFocus = active instanceof HTMLInputElement || active instanceof HTMLSelectElement ? active : null;
    if (keepFocus && this.tabBody.contains(keepFocus)) {
      // Don't re-render under the user's cursor while they're typing; try again later.
      setTimeout(() => this.refreshThrottled(), 600);
    } else {
      tabs.find((t) => t.id === this.rightTab)!.render(this.tabBody);
      this.tabBody.scrollTop = scroll;
    }
    this.renderLeft();
    this.renderViewSwitch();
    this.renderWallet();
    this.renderHint();
    this.updateNetStrip();
  }

  /** The network strip shows when pinned, or automatically while messages are travelling. */
  private updateNetStrip(): void {
    const auto = performance.now() < this.netActiveUntil && this.mode !== 'maintenance' && this.mode !== 'reconciliation';
    this.netStrip.style.display = (this.showNet || auto) && this.mode !== 'network' ? '' : 'none';
  }

  private renderViewSwitch(): void {
    const v = this.ctx.views.mode;
    mount(
      this.viewSwitch,
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'View mode' },
        VIEW_MODES.map((m) => h('button', { class: v === m.id ? 'active' : '', 'data-view': m.id, title: m.tip, onclick: () => { this.ctx.views.setMode(m.id); this.renderAll(); } }, m.label)),
      ),
      h('button', { class: 'btn small' + (this.ctx.arrows.visible ? ' primary' : ''), title: 'Show the banknote path through the machine', onclick: () => { this.ctx.arrows.toggleAll(); this.renderAll(); } }, '➜ Note path'),
      h('button', { class: 'btn small' + (this.showNet ? ' primary' : ''), title: 'Show the banking network strip', onclick: () => { this.showNet = !this.showNet; this.renderAll(); } }, '⇄ Network'),
      h('button', { class: 'btn small', title: 'Reset camera to the front of the ATM', onclick: () => { const f = this.ctx.model.anchors.focus.front; void this.ctx.stage.focus(f.position, f.target); } }, '⌂'),
      h('button', { class: 'btn small menu-toggle', onclick: () => document.body.classList.toggle('show-left') }, '☰'),
    );
  }

  private leftKey = '';

  private renderLeft(): void {
    const c = this.ctx;
    const faults = c.sys.faults;
    // Only rebuild when something the panel shows has changed, and keep the scroll position.
    const key = [this.mode, this.selected, this.tours?.active?.id, faults.armed.join(',')].join('|');
    if (key === this.leftKey) return;
    this.leftKey = key;
    const left = document.getElementById('left-panel')!;
    const scroll = left.scrollTop;
    const open = new Set([...left.querySelectorAll('details[open] > summary')].map((x) => x.textContent));
    mount(
      left,
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Simulator mode'),
        h('div', { class: 'list' }, MODES.map((m) => h('button', { class: 'item' + (this.mode === m.id ? ' active' : ''), title: m.tip, onclick: () => this.setMode(m.id) }, h('span', { class: 'grow' }, m.label, h('div', { class: 'sub' }, m.tip))))),
      ),
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Guided tours'),
        h(
          'div',
          { class: 'list' },
          TOURS.map((t, i) =>
            h('button', { class: 'item' + (this.tours.active?.id === t.id ? ' active' : ''), 'data-tour': t.id, title: t.summary, onclick: () => void this.tours.start(t.id) }, h('span', { class: 'ico' }, String(i + 1)), h('span', { class: 'grow' }, t.title, h('div', { class: 'sub' }, `${t.steps.length} steps`))),
          ),
        ),
      ),
      h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'ATM components'), componentList(c)),
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, 'Transaction scenarios'),
        h(
          'div',
          { class: 'list' },
          FAULTS.map((f) =>
            h(
              'button',
              { class: 'item' + (faults.isArmed(f.id) ? ' active' : ''), 'data-scenario': f.id, title: f.explanation, onclick: () => { this.setMode('troubleshoot'); c.troubleshoot.select(f.id); } },
              h('span', { class: 'grow' }, f.title, h('div', { class: 'sub' }, f.category.toLowerCase() + (faults.isArmed(f.id) ? ' · ARMED' : ''))),
            ),
          ),
        ),
      ),
    );
    if (open.size) left.querySelectorAll('details').forEach((d) => (d.open = open.has(d.querySelector('summary')?.textContent ?? '')));
    left.scrollTop = scroll;
  }

  private renderWallet(): void {
    if (!this.ctx) return;
    const cards = [...this.ctx.sys.ledger.cards.values()] as Card[];
    const usable = this.cardUsable();
    const wallet = this.ctx.sys.inventory.countByDenom('customer');
    const walletText = DENOMINATIONS.filter((d) => (wallet[d] ?? 0) > 0).map((d) => `${wallet[d]}×$${d}`).join(' ');
    const walletValue = DENOMINATIONS.reduce((s, d) => s + (wallet[d] ?? 0) * d * 100, 0);
    mount(
      this.walletEl,
      h('h4', null, h('span', null, 'Training wallet'), h('span', { class: 'muted', style: 'text-transform:none;letter-spacing:0' }, 'fictional cards')),
      h(
        'div',
        { class: 'cards' },
        cards.map((card) => {
          const col = '#' + (CARD_COLORS[card.id] ?? 0x1f6feb).toString(16).padStart(6, '0');
          return h(
            'button',
            { class: 'wcard' + (card.id === this.activeCardId ? ' active' : ''), 'data-card': card.id, title: card.persona, onclick: () => this.setActiveCard(card.id) },
            h('span', { class: 'chipico', style: `background:linear-gradient(135deg, ${col}, #0b1220)` }),
            h('span', null, card.holderName, card.status !== 'ACTIVE' ? h('span', { class: 'muted', style: 'font-size:11px' }, ` · ${card.status.toLowerCase()}`) : null),
            h('span', { class: 'pin', title: 'Demo PIN (fictional)' }, `PIN ${card.demoPin}`),
          );
        }),
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', id: 'btn-insert', disabled: !usable, title: 'Insert the selected card into the card reader (or drag the 3D card)', onclick: () => this.insertCard('chip') }, '▣ Insert card'),
        h('button', { class: 'btn', id: 'btn-tap', disabled: !usable, title: 'Tap the selected card on the contactless reader', onclick: () => this.insertCard('contactless') }, '))) Tap'),
      ),
      h('div', { class: 'cash' }, `Wallet cash: ${formatWhole(walletValue)} ${walletText ? '(' + walletText + ')' : ''}`),
    );
  }

  private renderHint(): void {
    const c = this.ctx;
    if (!c) return;
    let text = '';
    const s = c.sys.app.screen;
    const card = c.sys.ledger.cards.get(this.activeCardId);
    if (this.tours?.active) text = '';
    else if (c.port.waitingForCash) text = '💵 Click the cash in the dispenser slot to take it';
    else if (c.port.waitingForCard) text = '💳 Click your card in the card slot to take it';
    else if (this.mode === 'customer') {
      if (s.id === 'WELCOME' && this.cardUsable()) text = '💳 Drag the training card into the card slot (right of the screen), click it, or use “Insert card”';
      else if (s.id === 'PIN_ENTRY') text = `🔢 Enter PIN ${card?.demoPin ?? ''} on the 3D keypad (or your keyboard), then press the green ENTER key`;
      else if (s.id === 'AMOUNT_ENTRY') text = 'Choose an amount on the screen, or type it on the keypad and press ENTER';
      else if (s.id === 'MAIN_MENU' || s.id === 'ACCOUNT_SELECT') text = 'Touch a button on the ATM screen';
    }
    if (c.mech.getInteractive().some((o) => o.userData.prop === 'receipt') && !text) text = '🧾 Click the receipt to take it';
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('hidden', !text);
  }
}
