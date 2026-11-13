import { h } from './dom';

/** Transient status messages and the hover tooltip. */
export class Toast {
  private readonly root = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
  private readonly tip = h('div', { class: 'hover-tip', hidden: true });

  constructor(parent: HTMLElement) {
    parent.append(this.root, this.tip);
  }

  show(message: string, kind: 'info' | 'warn' = 'info', ms = 2600): void {
    const el = h('div', { class: `toast toast-${kind}` }, message);
    this.root.append(el);
    while (this.root.children.length > 3) this.root.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('toast-out');
      window.setTimeout(() => el.remove(), 300);
    }, ms);
  }

  tooltip(text: string | null, x = 0, y = 0): void {
    if (!text) {
      this.tip.hidden = true;
      return;
    }
    if (this.tip.textContent !== text) this.tip.textContent = text;
    this.tip.hidden = false;
    this.tip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 16)}px)`;
  }
}
