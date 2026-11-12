import type { EventBus } from '../core/events';
import type { AnimClock } from '../animations/AnimClock';
import type { HostRequest, HostResponse, NetworkNode } from '../core/types';
import { NETWORK_PATH } from '../core/types';
import { formatCents } from '../core/money';
import { h, mount, fmtTime } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';

const NODE_INFO: Record<NetworkNode, { label: string; sub: string; tip: string }> = {
  ATM: { label: 'ATM', sub: 'terminal', tip: 'Builds the request (card token, simulated PIN block, amount) and waits for the reply.' },
  CONTROLLER: { label: 'ATM Controller', sub: 'driving app', tip: 'Manages a fleet of ATMs: formats messages, keeps the terminal configuration, forwards to the network.' },
  SWITCH: { label: 'Network / Switch', sub: 'routing', tip: 'Routes the request to the card issuer. If the issuer cannot be reached it answers on its behalf (e.g. code 91).' },
  HOST: { label: 'Authorization Host', sub: 'issuer', tip: 'Checks card status, verifies the PIN, checks the account and available funds, approves or declines.' },
  LEDGER: { label: 'Account Ledger', sub: 'core banking', tip: 'Holds balances. Authorizations place holds; completions post debits/credits; reversals release holds.' },
};

export interface NetMessageRecord {
  time: number;
  from: NetworkNode;
  to: NetworkNode;
  direction: 'request' | 'response';
  request: HostRequest;
  response?: HostResponse;
  dropped?: boolean;
}

export function describeMessage(m: NetMessageRecord): string {
  const r = m.request;
  if (m.direction === 'request') {
    const parts = [`${r.type}`, `STAN ${r.stan}`, r.terminalId];
    if (r.accountId) parts.push(`acct ${r.accountId}`);
    if (r.toAccountId) parts.push(`to ${r.toAccountId}`);
    if (r.amountCents !== undefined) parts.push(`amt ${formatCents(r.amountCents)}`);
    if (r.pinBlock) parts.push(`pin ${r.pinBlock}`);
    if (r.originalStan) parts.push(`orig ${r.originalStan}`);
    if (r.reversalReason) parts.push(`reason: ${r.reversalReason}`);
    return parts.join('  ');
  }
  const s = m.response;
  if (!s) return `${r.type} response`;
  const parts = [`${s.type}_RESP`, `STAN ${s.stan}`, `code ${s.code}`, s.approved ? 'APPROVED' : 'DECLINED'];
  if (s.authCode) parts.push(`auth ${s.authCode}`);
  if (s.availableCents !== undefined) parts.push(`avail ${formatCents(s.availableCents)}`);
  parts.push(`“${s.text}”`);
  return parts.join('  ');
}

/** Animated architecture diagram: ATM → Controller → Switch → Host → Ledger. */
export class NetworkViz {
  readonly el: SVGSVGElement;
  private nodes = new Map<NetworkNode, SVGGElement>();
  private x = new Map<NetworkNode, number>();
  private packets: SVGElement;
  readonly log: NetMessageRecord[] = [];
  private listeners = new Set<() => void>();
  private down = new Set<NetworkNode>();

  constructor(bus: EventBus, private clock: AnimClock, private hopMs: () => number, private big = false) {
    const W = 760;
    const H = big ? 150 : 86;
    this.el = document.createElementNS(SVGNS, 'svg');
    this.el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'ATM to bank authorization path');
    const cy = big ? 70 : 40;
    const nw = 128;
    const gap = (W - 20 - nw) / (NETWORK_PATH.length - 1);
    // links
    NETWORK_PATH.forEach((n, i) => this.x.set(n, 10 + nw / 2 + i * gap));
    for (let i = 0; i < NETWORK_PATH.length - 1; i++) {
      const a = this.x.get(NETWORK_PATH[i])! + nw / 2;
      const b = this.x.get(NETWORK_PATH[i + 1])! - nw / 2;
      const line = svg('line', { x1: a, y1: cy, x2: b, y2: cy, stroke: '#2e3c59', 'stroke-width': 2, 'stroke-dasharray': '4 4' });
      this.el.appendChild(line);
    }
    for (const n of NETWORK_PATH) {
      const g = svg('g', { transform: `translate(${this.x.get(n)! - nw / 2},${cy - 22})`, style: 'cursor:help' }) as SVGGElement;
      const title = svg('title', {});
      title.textContent = `${NODE_INFO[n].label}: ${NODE_INFO[n].tip}`;
      g.appendChild(title);
      g.appendChild(svg('rect', { width: nw, height: 44, rx: 8, fill: '#16233a', stroke: '#2e3c59', 'stroke-width': 1.5, class: 'nbox' }));
      const t = svg('text', { x: nw / 2, y: 19, 'text-anchor': 'middle', fill: '#dbe4f0', 'font-size': 12.5, 'font-weight': 600 });
      t.textContent = NODE_INFO[n].label;
      const s = svg('text', { x: nw / 2, y: 34, 'text-anchor': 'middle', fill: '#8b9ab3', 'font-size': 10.5 });
      s.textContent = NODE_INFO[n].sub;
      g.append(t, s);
      this.el.appendChild(g);
      this.nodes.set(n, g);
    }
    this.packets = svg('g', {});
    this.el.appendChild(this.packets);
    if (big) {
      const lg = svg('text', { x: 10, y: H - 12, fill: '#8b9ab3', 'font-size': 11 });
      lg.textContent = '● request   ● response   ✕ lost / timed out — conceptual model, not a real payment protocol';
      this.el.appendChild(lg);
    }

    bus.on('net.message', (m) => this.onMessage({ ...m, time: clock.now() }));
    bus.on('fault.armed', ({ id }) => {
      if (id === 'host-unavailable') this.setDown('HOST', true);
    });
    bus.on('fault.cleared', ({ id }) => {
      if (id === 'host-unavailable') this.setDown('HOST', false);
    });
    bus.on('reset', () => {
      this.log.length = 0;
      this.setDown('HOST', false);
      this.packets.textContent = '';
      this.notify();
    });
  }

  onLog(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const l of this.listeners) l();
  }

  setDown(n: NetworkNode, down: boolean): void {
    if (down) this.down.add(n);
    else this.down.delete(n);
    const rect = this.nodes.get(n)?.querySelector('rect');
    rect?.setAttribute('stroke', down ? '#f0616d' : '#2e3c59');
    rect?.setAttribute('fill', down ? '#3a1820' : '#16233a');
  }

  private flash(n: NetworkNode, color: string): void {
    const rect = this.nodes.get(n)?.querySelector('rect');
    if (!rect) return;
    rect.setAttribute('stroke', color);
    rect.setAttribute('stroke-width', '2.5');
    void this.clock.wait(this.hopMs() * 0.9).then(() => {
      rect.setAttribute('stroke', this.down.has(n) ? '#f0616d' : '#2e3c59');
      rect.setAttribute('stroke-width', '1.5');
    });
  }

  private onMessage(m: NetMessageRecord): void {
    this.log.push(m);
    if (this.log.length > 200) this.log.shift();
    this.notify();
    const color = m.dropped ? '#f0616d' : m.direction === 'request' ? '#2fc4b2' : '#a68bfa';
    const x0 = this.x.get(m.from)!;
    const x1 = this.x.get(m.to)!;
    const cy = this.big ? 70 : 40;
    const yOff = m.direction === 'request' ? -6 : 6;
    const dot = svg('circle', { r: 6, cx: x0, cy: cy + yOff, fill: color, stroke: '#0b1018', 'stroke-width': 1.5 });
    const lbl = svg('text', { x: x0, y: cy + yOff - 10, 'text-anchor': 'middle', fill: color, 'font-size': 10, 'font-family': 'monospace' });
    lbl.textContent = m.direction === 'request' ? m.request.type : (m.response?.code ?? '');
    this.packets.append(dot, lbl);
    this.flash(m.from, color);
    const dur = Math.max(120, this.hopMs() * 0.9);
    void this.clock
      .tween(dur, (p) => {
        const x = x0 + (x1 - x0) * (m.dropped ? Math.min(p, 0.55) : p);
        dot.setAttribute('cx', String(x));
        lbl.setAttribute('x', String(x));
      })
      .then(() => {
        if (m.dropped) {
          const xm = x0 + (x1 - x0) * 0.55;
          const cross = svg('text', { x: xm, y: cy + yOff + 5, 'text-anchor': 'middle', fill: '#f0616d', 'font-size': 18, 'font-weight': 700 });
          cross.textContent = '✕';
          this.packets.appendChild(cross);
          void this.clock.wait(2500).then(() => cross.remove());
        } else this.flash(m.to, color);
        dot.remove();
        lbl.remove();
      });
  }
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Rendered list of messages (newest first) for the network dashboard. */
export function renderMessageLog(container: HTMLElement, log: NetMessageRecord[], max = 40): void {
  const rows = log
    .slice(-max)
    .reverse()
    .map((m) =>
      h(
        'tr',
        { class: m.dropped ? 'diff' : '' },
        h('td', { class: 'mono' }, fmtTime(m.time)),
        h('td', { class: 'mono' }, `${m.from} → ${m.to}`),
        h('td', { class: 'mono', style: `color:${m.dropped ? '#f0616d' : m.direction === 'request' ? '#2fc4b2' : '#a68bfa'}` }, (m.dropped ? '[LOST] ' : '') + describeMessage(m)),
      ),
    );
  mount(
    container,
    rows.length
      ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Time'), h('th', null, 'Hop'), h('th', null, 'Message'))), h('tbody', null, rows))
      : h('p', { class: 'muted' }, 'No messages yet. Insert the training card and enter the PIN to watch the first authorization travel through the network.'),
  );
}
