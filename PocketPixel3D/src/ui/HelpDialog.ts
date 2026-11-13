import { h } from './dom';
import { Popover } from './Popover';

const KEYS: [string, string][] = [
  ['Arrow keys', 'D-pad'],
  ['Z', 'A button'],
  ['X', 'B button'],
  ['Enter', 'START'],
  ['Shift', 'SELECT'],
];
const SHORTCUTS: [string, string][] = [
  ['P', 'Power on / off'],
  ['F', 'Screen focus'],
  ['D', 'Enlarged 2D display'],
  ['C', 'Reset camera'],
  ['E', 'Exploded view'],
  ['T', 'X-ray (transparent shell)'],
  ['L', 'Cartridge library'],
  ['M', 'Mute'],
  ['H or ?', 'This help'],
  ['Esc', 'Close panels'],
];
const MOUSE: [string, string][] = [
  ['Drag', 'Orbit around the console'],
  ['Scroll / pinch', 'Zoom (toward the cursor)'],
  ['Right-drag', 'Pan'],
  ['Click a part', 'Press it or use it, and show its details'],
  ['Hold a button', 'Hold it down in the game'],
  ['Drag / scroll a wheel', 'Volume (right side), contrast (left side)'],
  ['Double-click', 'Fly the camera to that part'],
];

/** Controls reference. */
export class HelpDialog {
  readonly popover: Popover;

  constructor(parent: HTMLElement) {
    this.popover = new Popover(parent, 'Controls', 'help');
    const table = (title: string, rows: [string, string][]): HTMLElement =>
      h('div', { class: 'help-block' }, h('h3', {}, title), h('dl', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
    this.popover.body.append(
      h('p', { class: 'help-intro' }, 'Insert a cartridge, slide the power switch on top, wait for the boot chime, then press START.'),
      h('div', { class: 'help-grid' }, table('Game keys', KEYS), table('Mouse & touch', MOUSE), table('Shortcuts', SHORTCUTS)),
    );
  }
}
