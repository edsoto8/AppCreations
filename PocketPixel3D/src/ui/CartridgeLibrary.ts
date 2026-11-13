import type { CartridgeDefinition } from '../games/GameInterface';
import { drawCartridgeLabel } from '../models/PrintTextures';
import { h } from './dom';
import { Popover } from './Popover';

export interface LibraryState {
  insertedId: string | null;
  powerOn: boolean;
  busy: boolean;
  highScore: (id: string) => number;
}

/** Lists the cartridges with their labels and lets the user insert / remove them. */
export class CartridgeLibrary {
  readonly popover: Popover;
  private readonly cards = new Map<string, { status: HTMLElement; button: HTMLButtonElement; score: HTMLElement; card: HTMLElement }>();
  private readonly note: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly carts: readonly CartridgeDefinition[],
    private readonly onToggle: (id: string) => void,
  ) {
    this.popover = new Popover(parent, 'Cartridge library', 'library');
    this.note = h('p', { class: 'library-note' });
    const list = h('div', { class: 'library-list' });
    for (const cart of carts) {
      const thumb = drawCartridgeLabel(cart.title, cart.label, 48, 40, 5);
      thumb.className = 'library-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      const status = h('span', { class: 'library-status' });
      const score = h('span', { class: 'library-score' });
      const button = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.onToggle(cart.id) }, 'Insert');
      const controls = h(
        'ul',
        { class: 'library-controls' },
        ...cart.controls.map(([k, v]) => h('li', {}, h('kbd', {}, k), ' ', v)),
      );
      const card = h(
        'article',
        { class: 'library-card', 'data-cart': cart.id },
        thumb,
        h('div', { class: 'library-meta' }, h('h3', {}, cart.title), h('p', {}, cart.description), controls, h('div', { class: 'library-row' }, status, score, button)),
      );
      this.cards.set(cart.id, { status, button, score, card });
      list.append(card);
    }
    this.popover.body.append(this.note, list);
  }

  render(state: LibraryState): void {
    this.note.textContent = state.powerOn
      ? 'The power switch locks the cartridge. Switch off to change games.'
      : 'Choose a cartridge. It slides into the slot on the back; then switch the power on.';
    this.note.classList.toggle('warn', state.powerOn);
    for (const cart of this.carts) {
      const ui = this.cards.get(cart.id);
      if (!ui) continue;
      const inserted = state.insertedId === cart.id;
      ui.card.classList.toggle('inserted', inserted);
      ui.status.textContent = inserted ? 'In the console' : 'On the table';
      ui.score.textContent = `High score ${state.highScore(cart.id)}`;
      ui.button.textContent = inserted ? 'Remove' : state.insertedId ? 'Swap in' : 'Insert';
      ui.button.disabled = state.powerOn || state.busy;
    }
  }
}
