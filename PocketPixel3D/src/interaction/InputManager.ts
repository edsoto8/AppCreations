import type { ButtonId } from '../games/GameInterface';
import type { ButtonSystem } from '../hardware/ButtonSystem';

/** Keyboard → console buttons. Matches on `event.code` so layouts don't matter. */
export const KEY_BINDINGS: Readonly<Record<string, ButtonId>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyZ: 'a',
  KeyX: 'b',
  Enter: 'start',
  NumpadEnter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
};

export type ShortcutHandler = (code: string) => boolean;

/**
 * Feeds keyboard input into the shared {@link ButtonSystem} (the same path the clickable 3D buttons
 * use). Holding a key holds the button; games implement their own auto-repeat. Releases everything
 * when the window loses focus so no key gets stuck.
 */
export class InputManager {
  private readonly held = new Set<string>();

  constructor(
    private readonly buttons: ButtonSystem,
    private readonly shortcuts: ShortcutHandler,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return;
    const button = KEY_BINDINGS[e.code];
    if (button) {
      e.preventDefault();
      if (e.repeat || this.held.has(e.code)) return;
      this.held.add(e.code);
      this.buttons.press(button, 'keyboard');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (this.shortcuts(e.code)) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const button = KEY_BINDINGS[e.code];
    if (!button || !this.held.delete(e.code)) return;
    e.preventDefault();
    // Both Shift keys map to Select: only release once neither is held.
    for (const code of this.held) if (KEY_BINDINGS[code] === button) return;
    this.buttons.release(button, 'keyboard');
  };

  private readonly onBlur = (): void => {
    this.held.clear();
    this.buttons.releaseAll('keyboard');
  };
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
