import { h } from './dom';
import { ICONS, type IconName } from './icons';

export interface ToolbarItem {
  id: string;
  icon: IconName;
  label: string;
  /** Keyboard shortcut shown in the tooltip. */
  key?: string;
  onClick: () => void;
}

/** Bottom toolbar of icon buttons; toggles reflect state via aria-pressed. */
export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, groups: ToolbarItem[][]) {
    this.element = h('nav', { class: 'toolbar', 'aria-label': 'Console controls' });
    groups.forEach((group, gi) => {
      if (gi > 0) this.element.append(h('span', { class: 'toolbar-sep', 'aria-hidden': 'true' }));
      for (const item of group) {
        const btn = h(
          'button',
          {
            class: 'tool',
            type: 'button',
            'data-tool': item.id,
            title: item.key ? `${item.label} (${item.key})` : item.label,
            'aria-label': item.label,
            onclick: () => item.onClick(),
          },
          h('span', { class: 'tool-icon', html: ICONS[item.icon] }),
          h('span', { class: 'tool-label' }, item.label),
        );
        this.buttons.set(item.id, btn);
        this.element.append(btn);
      }
    });
    parent.append(this.element);
  }

  setActive(id: string, active: boolean): void {
    this.buttons.get(id)?.setAttribute('aria-pressed', String(active));
  }

  setIcon(id: string, icon: IconName): void {
    const span = this.buttons.get(id)?.querySelector('.tool-icon');
    if (span) span.innerHTML = ICONS[icon];
  }

  button(id: string): HTMLButtonElement | undefined {
    return this.buttons.get(id);
  }
}
