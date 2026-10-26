/**
 * Dark, glassy control panel built with plain DOM. It only emits intents through callbacks and
 * reflects state passed back in; it holds no 3D logic.
 */
import type { StateId } from '../animation/states';
import type { LightingPreset } from '../environment/LightingPresets';

export type FurQuality = 'low' | 'medium' | 'high';

export interface PanelState {
  animation: StateId;
  playing: boolean;
  speed: number;
  wagLayer: boolean;
  fur: boolean;
  wireframe: boolean;
  skeleton: boolean;
  forest: boolean;
  autoRotate: boolean;
  quality: FurQuality;
  preset: string;
}

export interface PanelActions {
  onAnimation(id: StateId): void;
  onPlayPause(): void;
  onSpeed(v: number): void;
  onToggle(key: 'wagLayer' | 'fur' | 'wireframe' | 'skeleton' | 'forest' | 'autoRotate', on: boolean): void;
  onQuality(q: FurQuality): void;
  onPreset(id: string): void;
  onResetCamera(): void;
  onFullscreen(): void;
}

const ICONS: Record<string, string> = {
  idle: '<path d="M4 15c3-1 5-4 8-4s5 3 8 4M12 11V5"/><circle cx="12" cy="4" r="1.5"/>',
  walk: '<circle cx="13" cy="4" r="1.6"/><path d="M11 21l2-6-2-3 1-5 3 3 3 1M9 12l-2 3M13 15l3 6"/>',
  run: '<circle cx="15" cy="4" r="1.6"/><path d="M5 20l4-4 2-4-2-2 4-3 3 3 3 1M11 12l4 3-1 6M7 9l3-2"/>',
  sit: '<path d="M7 20h10M9 20v-6l-2-5 3-4 4 2 1 4-2 3v6M14 9h3"/>',
  look: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  wag: '<path d="M4 18c4 0 6-3 7-6s3-6 8-6M15 3l4 3-4 3"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  reset: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  collapse: '<path d="M6 9l6 6 6-6"/>',
};

const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

export class ControlPanel {
  readonly root: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly hint: HTMLElement;
  private state: PanelState;
  private readonly abort = new AbortController();

  constructor(
    host: HTMLElement,
    initial: PanelState,
    animations: { id: StateId; label: string }[],
    presets: LightingPreset[],
    private readonly actions: PanelActions,
  ) {
    this.state = { ...initial };
    const header = document.createElement('header');
    header.className = 'brand';
    header.innerHTML = `
      <div class="brand-mark" aria-hidden="true"></div>
      <div>
        <h1>Red Fox</h1>
        <p>Procedural 3D character</p>
      </div>
      <div class="stats" id="stats"></div>`;
    host.appendChild(header);
    this.stats = header.querySelector('#stats')!;

    this.root = document.createElement('aside');
    this.root.className = 'panel';
    this.root.setAttribute('aria-label', 'Viewer controls');
    this.root.innerHTML = `
      <button class="panel-handle" data-action="collapse" aria-label="Toggle controls" aria-expanded="true">${svg('collapse')}</button>
      <section>
        <h2>Animation</h2>
        <div class="anim-grid" role="radiogroup" aria-label="Animation">
          ${animations
            .map(
              (a, i) => `<button class="anim" role="radio" data-anim="${a.id}" title="${a.label} (${i + 1})">${svg(a.id)}<span>${a.label}</span></button>`,
            )
            .join('')}
        </div>
        <div class="row playback">
          <button class="icon-btn primary" data-action="play" aria-label="Play or pause (Space)"></button>
          <label class="slider">
            <span>Speed</span>
            <input type="range" min="0.1" max="2" step="0.05" data-input="speed" aria-label="Animation speed" />
            <output data-out="speed"></output>
          </label>
        </div>
        ${this.toggle('wagLayer', 'Tail wag layer', 'Adds wagging on top of any animation')}
      </section>
      <section>
        <h2>Display</h2>
        ${this.toggle('fur', 'Fur', 'H')}
        ${this.toggle('wireframe', 'Wireframe', 'W')}
        ${this.toggle('skeleton', 'Skeleton', 'K')}
        ${this.toggle('forest', 'Forest environment', 'E')}
        ${this.toggle('autoRotate', 'Auto-rotate', 'A')}
        <div class="row">
          <span class="label">Fur quality</span>
          <div class="segmented" role="radiogroup" aria-label="Fur quality">
            ${(['low', 'medium', 'high'] as const).map((q) => `<button role="radio" data-quality="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
          </div>
        </div>
      </section>
      <section>
        <h2>Lighting</h2>
        <div class="chips" role="radiogroup" aria-label="Lighting preset">
          ${presets.map((p) => `<button class="chip" role="radio" data-preset="${p.id}">${p.label}</button>`).join('')}
        </div>
      </section>
      <section class="row buttons">
        <button class="btn" data-action="reset">${svg('reset')}<span>Reset camera</span></button>
        <button class="btn" data-action="fullscreen">${svg('fullscreen')}<span>Fullscreen</span></button>
      </section>`;
    host.appendChild(this.root);

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.textContent = matchMedia('(pointer: coarse)').matches
      ? 'Drag to orbit · Pinch to zoom · Two fingers to pan'
      : 'Drag to orbit · Scroll to zoom · Right-drag to pan · Keys 1–6 switch animations';
    host.appendChild(this.hint);
    setTimeout(() => this.hint.classList.add('fade'), 6000);

    this.bind();
    if (matchMedia('(max-width: 720px)').matches) this.setCollapsed(true);
    this.sync();
  }

  private toggle(key: string, label: string, hint: string): string {
    return `<label class="toggle" title="${hint}">
      <span>${label}</span>
      <input type="checkbox" role="switch" data-toggle="${key}" />
      <span class="switch" aria-hidden="true"></span>
    </label>`;
  }

  private bind(): void {
    const signal = this.abort.signal;
    this.root.addEventListener(
      'click',
      (e) => {
        const el = (e.target as HTMLElement).closest('button');
        if (!el) return;
        const d = el.dataset;
        if (d.anim) this.actions.onAnimation(d.anim as StateId);
        else if (d.quality) this.actions.onQuality(d.quality as FurQuality);
        else if (d.preset) this.actions.onPreset(d.preset);
        else if (d.action === 'play') this.actions.onPlayPause();
        else if (d.action === 'reset') this.actions.onResetCamera();
        else if (d.action === 'fullscreen') this.actions.onFullscreen();
        else if (d.action === 'collapse') this.setCollapsed(!this.root.classList.contains('collapsed'));
      },
      { signal },
    );
    this.root.addEventListener(
      'input',
      (e) => {
        const el = e.target as HTMLInputElement;
        if (el.dataset.input === 'speed') this.actions.onSpeed(parseFloat(el.value));
        if (el.dataset.toggle) this.actions.onToggle(el.dataset.toggle as Parameters<PanelActions['onToggle']>[0], el.checked);
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const animIds = Array.from(this.root.querySelectorAll<HTMLElement>('[data-anim]')).map((b) => b.dataset.anim as StateId);
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= animIds.length) this.actions.onAnimation(animIds[n - 1]);
        else if (e.key === ' ') {
          e.preventDefault();
          this.actions.onPlayPause();
        } else if (e.key === 'f' || e.key === 'F') this.actions.onFullscreen();
        else if (e.key === 'r' || e.key === 'R') this.actions.onResetCamera();
        else if (e.key === 'w' || e.key === 'W') this.actions.onToggle('wireframe', !this.state.wireframe);
        else if (e.key === 'h' || e.key === 'H') this.actions.onToggle('fur', !this.state.fur);
        else if (e.key === 'k' || e.key === 'K') this.actions.onToggle('skeleton', !this.state.skeleton);
        else if (e.key === 'e' || e.key === 'E') this.actions.onToggle('forest', !this.state.forest);
        else if (e.key === 'a' || e.key === 'A') this.actions.onToggle('autoRotate', !this.state.autoRotate);
      },
      { signal },
    );
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
    this.root.querySelector('.panel-handle')!.setAttribute('aria-expanded', String(!collapsed));
  }

  update(patch: Partial<PanelState>): void {
    this.state = { ...this.state, ...patch };
    this.sync();
  }

  get current(): PanelState {
    return this.state;
  }

  private sync(): void {
    const s = this.state;
    this.root.querySelectorAll<HTMLElement>('[data-anim]').forEach((b) => {
      const on = b.dataset.anim === s.animation;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.root.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => {
      const on = b.dataset.quality === s.quality;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => {
      const on = b.dataset.preset === s.preset;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    const play = this.root.querySelector<HTMLElement>('[data-action="play"]')!;
    play.innerHTML = svg(s.playing ? 'pause' : 'play');
    play.title = s.playing ? 'Pause (Space)' : 'Play (Space)';
    const speed = this.root.querySelector<HTMLInputElement>('[data-input="speed"]')!;
    if (document.activeElement !== speed) speed.value = String(s.speed);
    this.root.querySelector<HTMLOutputElement>('[data-out="speed"]')!.textContent = `${s.speed.toFixed(2)}×`;
    for (const key of ['wagLayer', 'fur', 'wireframe', 'skeleton', 'forest', 'autoRotate'] as const) {
      const input = this.root.querySelector<HTMLInputElement>(`[data-toggle="${key}"]`)!;
      input.checked = s[key];
    }
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }

  dispose(): void {
    this.abort.abort();
    this.root.remove();
    this.hint.remove();
    document.querySelector('header.brand')?.remove();
  }
}
