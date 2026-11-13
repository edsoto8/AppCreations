import { h } from './dom';
import { ICONS } from './icons';
import type { PartInfo } from './PartInfo';

export interface InfoAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

/** Side card describing the selected component, with context actions. */
export class InfoPanel {
  private readonly root: HTMLElement;
  private readonly title = h('h2', { class: 'info-title' });
  private readonly kicker = h('div', { class: 'info-kicker' }, 'Component');
  private readonly desc = h('p', { class: 'info-desc' });
  private readonly func = h('p', { class: 'info-func' });
  private readonly extra = h('div', { class: 'info-extra' });
  private readonly actions = h('div', { class: 'info-actions' });
  current: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = h(
      'aside',
      { class: 'panel info-panel', 'aria-label': 'Component information', hidden: true },
      h('button', { class: 'icon-btn panel-close', type: 'button', 'aria-label': 'Close', html: ICONS.close, onclick: () => this.hide() }),
      this.kicker,
      this.title,
      this.desc,
      h('div', { class: 'info-label' }, 'Function'),
      this.func,
      this.extra,
      this.actions,
    );
    parent.append(this.root);
  }

  show(key: string, info: PartInfo, actions: InfoAction[], extra?: Node, kicker = 'Component'): void {
    this.current = key;
    this.kicker.textContent = kicker;
    this.title.textContent = info.name;
    this.desc.textContent = info.description;
    this.func.textContent = info.function;
    this.extra.replaceChildren(...(extra ? [extra] : []));
    this.actions.replaceChildren(
      ...actions.map((a) =>
        h('button', { class: a.primary ? 'btn btn-primary' : 'btn', type: 'button', disabled: a.disabled, onclick: a.onClick }, a.label),
      ),
    );
    this.root.hidden = false;
  }

  hide(): void {
    this.current = null;
    this.root.hidden = true;
  }
}
