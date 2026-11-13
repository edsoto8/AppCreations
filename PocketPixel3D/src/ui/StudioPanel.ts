import { LIGHTING_PRESETS, type LightingPresetId } from '../scene/LightingManager';
import { h } from './dom';
import { Popover } from './Popover';

export interface StudioToggles {
  pixelGrid: boolean;
  ghosting: boolean;
  reflection: boolean;
  idleMotion: boolean;
  slowMotion: boolean;
  showFps: boolean;
}

export interface StudioCallbacks {
  lighting(id: LightingPresetId): void;
  toggle<K extends keyof StudioToggles>(key: K, value: boolean): void;
  volume(value: number): void;
  contrast(value: number): void;
}

const TOGGLE_LABELS: Record<keyof StudioToggles, string> = {
  pixelGrid: 'LCD pixel grid',
  ghosting: 'LCD ghosting',
  reflection: 'Screen glass reflection',
  idleMotion: 'Handheld idle motion',
  slowMotion: 'Slow-motion assembly',
  showFps: 'Show frame rate',
};

/** Lighting presets plus display / motion options and mirrors of the two thumb wheels. */
export class StudioPanel {
  readonly popover: Popover;
  private readonly presetButtons = new Map<LightingPresetId, HTMLButtonElement>();
  private readonly checks = new Map<keyof StudioToggles, HTMLInputElement>();
  private readonly volume: HTMLInputElement;
  private readonly contrast: HTMLInputElement;

  constructor(parent: HTMLElement, toggles: StudioToggles, cb: StudioCallbacks) {
    this.popover = new Popover(parent, 'Studio', 'studio');
    const presets = h('div', { class: 'preset-row', role: 'radiogroup', 'aria-label': 'Lighting preset' });
    for (const [id, p] of Object.entries(LIGHTING_PRESETS) as [LightingPresetId, (typeof LIGHTING_PRESETS)[LightingPresetId]][]) {
      const btn = h(
        'button',
        { class: 'preset', type: 'button', role: 'radio', 'data-preset': id, onclick: () => cb.lighting(id) },
        h('span', { class: 'preset-swatch', style: `background:${p.background}` }),
        p.label,
      );
      this.presetButtons.set(id, btn);
      presets.append(btn);
    }
    const options = h('div', { class: 'toggle-list' });
    for (const key of Object.keys(TOGGLE_LABELS) as (keyof StudioToggles)[]) {
      const input = h('input', { type: 'checkbox', 'data-toggle': key, onchange: (e: Event) => cb.toggle(key, (e.target as HTMLInputElement).checked) });
      input.checked = toggles[key];
      this.checks.set(key, input);
      options.append(h('label', { class: 'toggle' }, input, h('span', {}, TOGGLE_LABELS[key])));
    }
    this.volume = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume', oninput: (e: Event) => cb.volume(Number((e.target as HTMLInputElement).value)) });
    this.contrast = h('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Contrast', oninput: (e: Event) => cb.contrast(Number((e.target as HTMLInputElement).value)) });
    this.popover.body.append(
      h('h3', {}, 'Lighting'),
      presets,
      h('h3', {}, 'Display & motion'),
      options,
      h('h3', {}, 'Wheels'),
      h('label', { class: 'slider' }, h('span', {}, 'Volume'), this.volume),
      h('label', { class: 'slider' }, h('span', {}, 'Contrast'), this.contrast),
    );
  }

  setPreset(id: LightingPresetId): void {
    for (const [pid, btn] of this.presetButtons) btn.setAttribute('aria-checked', String(pid === id));
  }

  setToggle(key: keyof StudioToggles, value: boolean): void {
    const c = this.checks.get(key);
    if (c) c.checked = value;
  }

  setDials(volume: number, contrast: number): void {
    if (document.activeElement !== this.volume) this.volume.value = String(volume);
    if (document.activeElement !== this.contrast) this.contrast.value = String(contrast);
  }
}
