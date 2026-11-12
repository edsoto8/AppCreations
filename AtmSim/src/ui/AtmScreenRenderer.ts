import * as THREE from 'three';
import type { ScreenState } from '../core/types';

const W = 1024;
const H = 768;

interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

const TONE: Record<ScreenState['tone'], { a: string; b: string; accent: string }> = {
  normal: { a: '#0b2a4a', b: '#08182c', accent: '#35d0bf' },
  busy: { a: '#10294a', b: '#09162a', accent: '#6fb6ff' },
  warn: { a: '#3a2c0c', b: '#1c1506', accent: '#f6c04f' },
  error: { a: '#3d1218', b: '#1d080b', accent: '#ff6b78' },
  success: { a: '#0d3a2e', b: '#061c16', accent: '#4ee0a0' },
};

/**
 * Draws the headless AtmApp's ScreenState onto a canvas that is used as the texture of the
 * 3D display, and maps clicks on the 3D screen (UV coordinates) back to touch-button ids.
 */
export class AtmScreenRenderer {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private hits: HitRect[] = [];
  private screen?: ScreenState;
  private shownAt = 0;
  private pressed?: { id: string; until: number };
  private spinner = 0;
  private lastDraw = 0;
  powered = true;

  constructor(private nowSim: () => number) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  attach(mesh: THREE.Mesh): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    const old = mesh.material as THREE.Material;
    mesh.material = mat;
    old.dispose?.();
  }

  show(s: ScreenState): void {
    this.screen = s;
    this.shownAt = this.nowSim();
    this.draw();
  }

  get current(): ScreenState | undefined {
    return this.screen;
  }

  /** Map a UV hit on the screen plane to a button id (or undefined). */
  hitTest(uv: THREE.Vector2): string | undefined {
    const x = uv.x * W;
    const y = (1 - uv.y) * H;
    const h = this.hits.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (!h || !h.enabled) return undefined;
    this.pressed = { id: h.id, until: performance.now() + 160 };
    this.draw();
    return h.id;
  }

  /** Button rectangle in UV space (used by tours/tests to click a specific button). */
  buttonUv(id: string): THREE.Vector2 | undefined {
    const r = this.hits.find((h) => h.id === id);
    if (!r) return undefined;
    return new THREE.Vector2((r.x + r.w / 2) / W, 1 - (r.y + r.h / 2) / H);
  }

  /** Redraw periodically for countdowns / busy spinners. */
  tick(): void {
    const now = performance.now();
    if (!this.screen) return;
    const animated = this.screen.tone === 'busy' || this.screen.countdownMs !== undefined || (this.pressed && now > this.pressed.until);
    if (animated && now - this.lastDraw > 90) this.draw();
  }

  private draw(): void {
    this.lastDraw = performance.now();
    const c = this.ctx;
    const s = this.screen;
    this.hits = [];
    if (!this.powered || !s) {
      c.fillStyle = '#020305';
      c.fillRect(0, 0, W, H);
      this.texture.needsUpdate = true;
      return;
    }
    const tone = TONE[s.tone] ?? TONE.normal;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, tone.a);
    g.addColorStop(1, tone.b);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // subtle diagonal pattern
    c.globalAlpha = 0.05;
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    for (let i = -H; i < W; i += 46) {
      c.beginPath();
      c.moveTo(i, H);
      c.lineTo(i + H, 0);
      c.stroke();
    }
    c.globalAlpha = 1;

    // header
    c.fillStyle = '#00000055';
    c.fillRect(0, 0, W, 64);
    c.fillStyle = tone.accent;
    roundRect(c, 24, 16, 30, 32, 6);
    c.fill();
    c.fillStyle = '#0b1220';
    c.fillRect(30, 22, 18, 9);
    c.fillStyle = '#e9f2ff';
    c.font = '600 24px Inter, Segoe UI, Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText('MERIDIAN TRAINING BANK', 68, 33);
    c.font = '18px Inter, Segoe UI, Arial, sans-serif';
    c.fillStyle = '#9fb4d0';
    c.textAlign = 'right';
    c.fillText('TRAINING SIMULATOR · ' + s.id.replace(/_/g, ' '), W - 24, 33);
    c.textAlign = 'left';

    // title
    c.fillStyle = '#ffffff';
    c.font = '700 44px Inter, Segoe UI, Arial, sans-serif';
    c.textBaseline = 'alphabetic';
    let y = 132;
    for (const line of wrap(c, s.title, W - 96)) {
      c.fillText(line, 48, y);
      y += 52;
    }
    c.fillStyle = tone.accent;
    c.fillRect(48, y - 32, 90, 4);
    y += 12;

    // lines
    const mono = s.id === 'RESULT' && s.lines.some((l) => /\$\d/.test(l) && l.length > 26);
    c.font = mono ? '24px Menlo, Consolas, monospace' : '28px Inter, Segoe UI, Arial, sans-serif';
    c.fillStyle = '#d6e4f5';
    const lineH = mono ? 32 : 38;
    for (const raw of s.lines) {
      for (const line of wrap(c, raw, W - 96)) {
        if (y > H - 120) break;
        c.fillText(line, 48, y);
        y += lineH;
      }
    }

    // input field
    if (s.input) {
      y += 8;
      c.font = '22px Inter, Segoe UI, Arial, sans-serif';
      c.fillStyle = '#9fb4d0';
      c.fillText(s.input.label, 48, y);
      y += 14;
      c.fillStyle = '#00000066';
      roundRect(c, 48, y, 420, 74, 10);
      c.fill();
      c.strokeStyle = tone.accent;
      c.lineWidth = 3;
      c.stroke();
      c.fillStyle = '#ffffff';
      c.font = s.input.masked ? '700 52px Inter, Arial, sans-serif' : '600 46px Menlo, Consolas, monospace';
      const val = s.input.masked ? '•'.repeat(s.input.value.length).split('').join(' ') : s.input.value;
      c.textBaseline = 'middle';
      c.fillText(val || ' ', 70, y + 38);
      // caret
      if (Math.floor(performance.now() / 500) % 2 === 0) {
        const tw = c.measureText(val).width;
        c.fillStyle = tone.accent;
        c.fillRect(74 + tw, y + 16, 3, 42);
      }
      c.textBaseline = 'alphabetic';
      y += 96;
    }

    // busy spinner
    if (s.tone === 'busy') {
      this.spinner = performance.now() / 1000;
      const cx = W / 2;
      const cy = Math.max(y + 70, 470);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + this.spinner * 4;
        c.globalAlpha = ((i + 1) / 12) * 0.9;
        c.fillStyle = tone.accent;
        c.beginPath();
        c.arc(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38, 7, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    // buttons
    const btns = s.buttons;
    if (btns.length) {
      const cols = btns.length > 8 ? 3 : 2;
      const rows = Math.ceil(btns.length / cols);
      const gap = 14;
      const areaBottom = H - (s.countdownMs !== undefined ? 70 : 40) - (s.footer ? 26 : 0);
      const bh = Math.min(76, Math.max(54, (areaBottom - Math.max(y, 330)) / rows - gap));
      const top = areaBottom - rows * (bh + gap) + gap;
      const bw = (W - 96 - gap * (cols - 1)) / cols;
      btns.forEach((b, i) => {
        // Fill the left column first, then the right (like the side keys on an ATM).
        const col = Math.floor(i / rows);
        const row = i % rows;
        const bx = 48 + col * (bw + gap);
        const by = top + row * (bh + gap);
        const pressed = this.pressed && this.pressed.id === b.id && performance.now() < this.pressed.until;
        const primary = b.style === 'primary';
        const danger = b.style === 'danger';
        c.fillStyle = !b.enabled ? '#ffffff10' : pressed ? '#ffffff' : primary ? tone.accent : danger ? '#7a2632' : '#ffffff1f';
        roundRect(c, bx, by, bw, bh, 12);
        c.fill();
        c.strokeStyle = b.enabled ? (primary ? tone.accent : '#ffffff55') : '#ffffff22';
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = !b.enabled ? '#ffffff55' : pressed || primary ? '#06131a' : '#ffffff';
        c.font = `600 ${b.label.length > 22 ? 22 : 27}px Inter, Segoe UI, Arial, sans-serif`;
        c.textBaseline = 'middle';
        c.textAlign = col === 0 && cols === 2 ? 'left' : col === cols - 1 && cols === 2 ? 'right' : 'center';
        const tx = c.textAlign === 'left' ? bx + 24 : c.textAlign === 'right' ? bx + bw - 24 : bx + bw / 2;
        // side-key arrow marks like a real ATM
        if (cols === 2) {
          c.fillText(col === 0 ? `◀  ${b.label}` : `${b.label}  ▶`, tx, by + bh / 2 + 1);
        } else c.fillText(b.label, tx, by + bh / 2 + 1);
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        this.hits.push({ id: b.id, x: bx, y: by, w: bw, h: bh, enabled: b.enabled });
      });
    }

    // countdown
    if (s.countdownMs !== undefined) {
      const remain = Math.max(0, s.countdownMs - (this.nowSim() - this.shownAt));
      const frac = s.countdownMs > 0 ? remain / s.countdownMs : 0;
      c.fillStyle = '#00000066';
      roundRect(c, 48, H - 52, W - 96, 16, 8);
      c.fill();
      c.fillStyle = frac < 0.3 ? '#ff6b78' : tone.accent;
      roundRect(c, 48, H - 52, (W - 96) * frac, 16, 8);
      c.fill();
      c.fillStyle = '#c9d6e8';
      c.font = '18px Inter, Arial, sans-serif';
      c.textAlign = 'right';
      c.fillText(`${Math.ceil(remain / 1000)} s`, W - 48, H - 62);
      c.textAlign = 'left';
    }
    if (s.footer) {
      c.fillStyle = '#9fb4d0';
      c.font = '20px Inter, Arial, sans-serif';
      c.fillText(s.footer, 48, H - (s.countdownMs !== undefined ? 74 : 18));
    }
    this.texture.needsUpdate = true;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  if (c.measureText(text).width <= max) return [text];
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
