import * as THREE from 'three';
import type { Ctx, AppMode } from '../ui/context';
import type { ComponentId } from '../core/types';
import type { ViewMode } from '../scene/ViewModes';
import type { AtmAnchors } from '../models/types';
import { h, mount } from '../ui/dom';
import { TOURS } from './tours';

export type CameraSpec = keyof AtmAnchors['focus'] | { part: ComponentId } | { position: [number, number, number]; target: [number, number, number] };

export interface TourStep {
  title: string;
  text: string;
  mode?: AppMode;
  view?: ViewMode;
  camera?: CameraSpec;
  /** Parts outlined (pulsing) during this step. */
  highlight?: ComponentId[];
  /** Part shown in the details tab. */
  select?: ComponentId;
  arrows?: boolean;
  /** Right-panel tab to show. */
  tab?: string;
  /** Drives the simulator when the step is entered. Should resolve when the step's demonstration is done. */
  action?: (ctx: Ctx, run: TourRun) => Promise<void>;
}

export interface Tour {
  id: string;
  title: string;
  summary: string;
  steps: TourStep[];
}

/** Lets an action know that the user left the step (so it can stop driving). */
export interface TourRun {
  readonly cancelled: boolean;
  status(text: string): void;
}

/** Plays a guided tour: camera moves, view modes, highlights, explanations and step controls. */
export class TourRunner {
  active?: Tour;
  private index = 0;
  private run?: { cancelled: boolean };
  private busy = false;
  private statusText = '';

  constructor(private ctx: Ctx, private el: HTMLElement) {}

  async start(id: string): Promise<void> {
    const t = TOURS.find((x) => x.id === id);
    if (!t) return;
    this.ctx.sfx.unlock();
    this.stop(false);
    this.active = t;
    this.index = 0;
    this.el.style.display = '';
    this.ctx.ui.refresh();
    await this.enter();
  }

  stop(refresh = true): void {
    if (this.run) this.run.cancelled = true;
    this.run = undefined;
    this.active = undefined;
    this.busy = false;
    this.el.style.display = 'none';
    this.ctx.stage.alertOutline.selectedObjects = [];
    if (refresh) this.ctx.ui.refresh();
  }

  async next(): Promise<void> {
    if (!this.active) return;
    if (this.index >= this.active.steps.length - 1) {
      this.ctx.ui.toast(`Tour complete: ${this.active.title}`, 'ok');
      this.stop();
      return;
    }
    this.index++;
    await this.enter();
  }

  async prev(): Promise<void> {
    if (!this.active || this.index === 0) return;
    this.index--;
    await this.enter();
  }

  private async enter(): Promise<void> {
    const tour = this.active!;
    const step = tour.steps[this.index];
    if (this.run) this.run.cancelled = true;
    const run = { cancelled: false };
    this.run = run;
    this.statusText = '';
    const c = this.ctx;
    if (step.mode && c.ui.mode !== step.mode) c.ui.setMode(step.mode);
    if (step.view && c.views.mode !== step.view) c.views.setMode(step.view, { moveCamera: false });
    if (step.arrows !== undefined) c.arrows.setVisible(step.arrows);
    if (step.select) c.ui.select(step.select);
    if (step.tab) c.ui.showTab(step.tab);
    c.stage.alertOutline.selectedObjects = (step.highlight ?? []).map((id) => c.model.parts.get(id)).filter((o): o is THREE.Object3D => !!o);
    if (step.camera) void this.moveCamera(step.camera);
    this.busy = !!step.action;
    this.render();
    if (step.action) {
      try {
        await step.action(c, {
          get cancelled() {
            return run.cancelled;
          },
          status: (t: string) => {
            if (run.cancelled) return;
            this.statusText = t;
            this.render();
          },
        });
      } catch (err) {
        console.warn('[tour] action failed', err);
        this.statusText = 'This step could not complete automatically — use the ATM directly or press Next.';
      }
      if (run.cancelled) return;
      this.busy = false;
      this.render();
    }
  }

  private moveCamera(spec: CameraSpec): Promise<void> {
    const c = this.ctx;
    if (typeof spec === 'string') {
      const f = c.model.anchors.focus[spec];
      return c.stage.focus(f.position, f.target, 1.4);
    }
    if ('part' in spec) {
      const o = c.model.parts.get(spec.part);
      return o ? c.stage.focusObject(o, 1.4) : Promise.resolve();
    }
    return c.stage.focus(new THREE.Vector3(...spec.position), new THREE.Vector3(...spec.target), 1.4);
  }

  private render(): void {
    const tour = this.active;
    if (!tour) return;
    const step = tour.steps[this.index];
    const n = tour.steps.length;
    mount(
      this.el,
      h('div', { class: 'step' }, `${tour.title} · step ${this.index + 1} of ${n}`),
      h('h3', null, step.title),
      h('p', { html: step.text }),
      this.statusText || this.busy ? h('p', { class: 'muted', style: 'margin-top:-4px', id: 'tour-status' }, (this.busy ? '⏳ ' : '✓ ') + (this.statusText || 'Demonstrating…')) : null,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small', onclick: () => this.stop() }, 'Exit tour'),
        h(
          'div',
          { style: 'display:flex;gap:6px' },
          h('button', { class: 'btn', disabled: this.index === 0, onclick: () => void this.prev() }, '◀ Back'),
          h('button', { class: 'btn primary', id: 'tour-next', onclick: () => void this.next() }, this.index === n - 1 ? 'Finish ✓' : this.busy ? 'Skip ▶' : 'Next ▶'),
        ),
      ),
      h('div', { class: 'progress' }, h('i', { style: `width:${((this.index + 1) / n) * 100}%` })),
    );
  }
}
