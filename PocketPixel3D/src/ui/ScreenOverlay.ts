import type { ButtonId } from '../games/GameInterface';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../games/GameInterface';
import { h } from './dom';
import { ICONS } from './icons';

/**
 * Enlarged pixel-perfect 2D view of the LCD, copied each frame from the same LCD canvas the 3D
 * screen texture uses, plus on-screen buttons for touch play.
 */
export class ScreenOverlay {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private drawn = -1;

  constructor(
    parent: HTMLElement,
    private readonly source: HTMLCanvasElement,
    press: (b: ButtonId, down: boolean) => void,
    onClose: () => void,
  ) {
    this.canvas = h('canvas', { class: 'overlay-lcd', width: String(SCREEN_WIDTH), height: String(SCREEN_HEIGHT), 'aria-label': 'Enlarged console display' });
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    const pad = (b: ButtonId, label: string, cls: string): HTMLElement => {
      const el = h('button', { class: `vbtn ${cls}`, type: 'button', 'aria-label': label, 'data-vbtn': b }, cls.includes('dir') ? '' : label);
      let active = false;
      const down = (e: PointerEvent): void => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        if (!active) press(b, true);
        active = true;
        el.classList.add('is-down');
      };
      const up = (): void => {
        if (active) press(b, false);
        active = false;
        el.classList.remove('is-down');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      return el;
    };
    this.root = h(
      'section',
      { class: 'overlay', hidden: true, 'aria-label': 'Enlarged display' },
      h(
        'div',
        { class: 'overlay-bezel' },
        h('button', { class: 'icon-btn overlay-close', type: 'button', 'aria-label': 'Close enlarged display', html: ICONS.close, onclick: onClose }),
        h('div', { class: 'overlay-screen' }, this.canvas, h('div', { class: 'overlay-glare' })),
      ),
      h(
        'div',
        { class: 'vpad' },
        h('div', { class: 'vpad-dirs' }, pad('up', 'Up', 'dir up'), pad('left', 'Left', 'dir left'), pad('right', 'Right', 'dir right'), pad('down', 'Down', 'dir down')),
        h('div', { class: 'vpad-mid' }, pad('select', 'SELECT', 'pill'), pad('start', 'START', 'pill')),
        h('div', { class: 'vpad-ab' }, pad('b', 'B', 'round b'), pad('a', 'A', 'round a')),
      ),
    );
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
    this.drawn = -1;
  }

  setReflection(on: boolean): void {
    this.root.classList.toggle('no-glare', !on);
  }

  /** Copies the LCD canvas when it changed. */
  draw(version: number): void {
    if (this.root.hidden || version === this.drawn) return;
    this.drawn = version;
    this.ctx.drawImage(this.source, 0, 0);
  }
}
