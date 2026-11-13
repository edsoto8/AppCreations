import type { CartridgeDefinition } from '../games/GameInterface';

export type SlotResult = { ok: true } | { ok: false; reason: string };

/**
 * The cartridge connector. While powered, the power switch's lock tab holds the cartridge, so
 * inserting or ejecting is refused until the console is switched off.
 */
export class CartridgeSlot {
  private cart: CartridgeDefinition | null = null;
  private lockedFlag = false;
  private readonly listeners = new Set<(cart: CartridgeDefinition | null) => void>();

  get cartridge(): CartridgeDefinition | null {
    return this.cart;
  }

  get locked(): boolean {
    return this.lockedFlag;
  }

  setLocked(locked: boolean): void {
    this.lockedFlag = locked;
  }

  onChange(listener: (cart: CartridgeDefinition | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  insert(cart: CartridgeDefinition): SlotResult {
    if (this.lockedFlag) return { ok: false, reason: 'Switch the power off before changing cartridges.' };
    if (this.cart?.id === cart.id) return { ok: true };
    if (this.cart) return { ok: false, reason: `Remove ${this.cart.title} first.` };
    this.cart = cart;
    this.notify();
    return { ok: true };
  }

  eject(): SlotResult {
    if (this.lockedFlag) return { ok: false, reason: 'The power switch locks the cartridge while the console is on.' };
    if (!this.cart) return { ok: false, reason: 'No cartridge inserted.' };
    this.cart = null;
    this.notify();
    return { ok: true };
  }

  private notify(): void {
    for (const l of this.listeners) l(this.cart);
  }
}
