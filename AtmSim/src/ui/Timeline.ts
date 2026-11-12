import type { EventBus } from '../core/events';
import type { AnimClock } from '../animations/AnimClock';
import { SPEEDS } from '../animations/AnimClock';
import { h, mount, fmtTime, rafThrottle } from './dom';

/**
 * Bottom bar: the stages of the current mechanical / transaction sequence, play-pause, speed
 * (0.25×–2×), step-to-next-stage, and a live electronic-journal log.
 */
export class Timeline {
  private stages: string[] = [];
  private stagesEl = h('div', { class: 'tl-stages', 'aria-label': 'Animation stages' });
  private logEl = h('div', { class: 'tl-log', 'aria-live': 'polite' });
  private ctrlEl = h('div', { class: 'tl-controls' });
  private lines: HTMLElement[] = [];
  private renderStagesThrottled = rafThrottle(() => this.renderStages());

  constructor(root: HTMLElement, bus: EventBus, private clock: AnimClock) {
    mount(root, this.ctrlEl, this.stagesEl, this.logEl);
    this.renderControls();
    clock.onChange(() => this.renderControls());
    bus.on('mech.stage', ({ label }) => {
      if (this.stages[this.stages.length - 1] !== label) this.stages.push(label);
      if (this.stages.length > 40) this.stages.splice(0, this.stages.length - 40);
      this.renderStagesThrottled();
    });
    bus.on('txn.created', () => {
      this.stages = [];
      this.renderStagesThrottled();
    });
    bus.on('journal', ({ entry }) => this.addLog(`${fmtTime(entry.time)}  ${entry.kind.padEnd(8)} ${entry.txnId ? entry.txnId + '  ' : ''}${entry.text}`, entry.kind));
    bus.on('reset', () => {
      this.stages = [];
      this.lines = [];
      this.logEl.textContent = '';
      this.renderStages();
    });
    this.renderStages();
  }

  private addLog(text: string, kind: string): void {
    const atBottom = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 4;
    const line = h('div', { class: `k-${kind}`, title: text }, text);
    this.logEl.appendChild(line);
    this.lines.push(line);
    if (this.lines.length > 400) this.lines.shift()!.remove();
    if (atBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private renderControls(): void {
    const c = this.clock;
    const play = h(
      'button',
      {
        class: 'btn' + (c.paused ? ' primary' : ''),
        id: 'tl-play',
        title: c.paused ? 'Resume the simulation' : 'Pause the simulation (mechanisms, host and timeouts freeze)',
        onclick: () => c.setPaused(!c.paused),
      },
      c.paused ? '▶ Play' : '❚❚ Pause',
    );
    const step = h('button', { class: 'btn', id: 'tl-step', title: 'Run until the next stage boundary, then pause', onclick: () => c.step() }, '⏭ Step');
    const speeds = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Simulation speed' },
      SPEEDS.map((s) => h('button', { class: c.speed === s ? 'active' : '', 'data-speed': String(s), title: `${s}× speed`, onclick: () => c.setSpeed(s) }, `${s}×`)),
    );
    mount(
      this.ctrlEl,
      h('div', { class: 'row' }, play, step),
      speeds,
      h('div', { class: 'muted', style: 'font-size:11px' }, c.paused ? (c.isStepping ? 'Stepping…' : 'Paused') : `Sim speed ${c.speed}×`),
    );
  }

  private renderStages(): void {
    if (!this.stages.length) {
      mount(this.stagesEl, h('span', { class: 'empty-stages' }, 'Stages of the current transaction appear here — insert the training card to begin.'));
      return;
    }
    const items: HTMLElement[] = [];
    this.stages.forEach((s, i) => {
      if (i) items.push(h('span', { class: 'tl-arrow' }, '▶'));
      items.push(h('span', { class: 'tl-stage ' + (i === this.stages.length - 1 ? 'current' : 'done') }, s));
    });
    mount(this.stagesEl, items);
    this.stagesEl.scrollLeft = this.stagesEl.scrollWidth;
  }
}
