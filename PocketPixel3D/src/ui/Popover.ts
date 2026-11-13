import { h } from './dom';
import { ICONS } from './icons';

/** A titled floating card above the toolbar. Only one popover is open at a time. */
export class Popover {
  private static open: Popover | null = null;
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private onCloseCb: (() => void) | null = null;

  constructor(parent: HTMLElement, title: string, className: string) {
    this.body = h('div', { class: 'popover-body' });
    this.root = h(
      'section',
      { class: `panel popover ${className}`, hidden: true, role: 'dialog', 'aria-label': title },
      h(
        'header',
        { class: 'popover-head' },
        h('h2', {}, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: ICONS.close, onclick: () => this.close() }),
      ),
      this.body,
    );
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  toggle(): boolean {
    if (this.isOpen) this.close();
    else this.openPanel();
    return this.isOpen;
  }

  openPanel(): void {
    if (Popover.open && Popover.open !== this) Popover.open.close();
    Popover.open = this;
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    if (Popover.open === this) Popover.open = null;
    this.onCloseCb?.();
  }

  static closeAll(): void {
    Popover.open?.close();
  }
}
