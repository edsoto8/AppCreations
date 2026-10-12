/**
 * Pointer / wheel / keyboard input. Talks to the camera directly and reports clicks and hovers
 * through the callbacks. A press that travels more than a few pixels is a drag (camera pan) and never
 * becomes a click, whichever button is used.
 */
import type { Camera } from './camera';
import type { PointerButton } from './types';

export interface InputHandlers {
  /** Pointer moved over the canvas without dragging (css px relative to the canvas), or left it (null). */
  onHover(pos: { x: number; y: number } | null): void;
  onClick(pos: { x: number; y: number }, button: PointerButton): void;
}

interface PointerInfo {
  x: number;
  y: number;
}

const DRAG_THRESHOLD_MOUSE = 5;
const DRAG_THRESHOLD_TOUCH = 9;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Keys drive the camera only when nothing in the UI layer has focus (the canvas, body or page itself). */
export function isGameFocus(t: EventTarget | null, canvas: HTMLElement): boolean {
  if (!(t instanceof HTMLElement)) return true;
  return t === canvas || t === document.body || t === document.documentElement;
}

export class InputController {
  private readonly pointers = new Map<number, PointerInfo>();
  private press: {
    id: number;
    button: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    touch: boolean;
    samples: { t: number; x: number; y: number }[];
  } | null = null;
  private pinch: { dist: number } | null = null;
  private readonly keys = new Set<string>();
  /** Last known pointer position (css px relative to canvas), or null when outside. */
  lastPointer: { x: number; y: number } | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly handlers: InputHandlers;

  constructor(canvas: HTMLCanvasElement, camera: Camera, handlers: InputHandlers) {
    this.canvas = canvas;
    this.camera = camera;
    this.handlers = handlers;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  destroy(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerCancel);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onContextMenu = (e: Event): void => e.preventDefault();

  private readonly onPointerDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best effort */
    }
    this.camera.stopFling();
    if (this.pointers.size === 2) {
      // second finger: switch to pinch, and never produce a click
      if (this.press) this.press.moved = true;
      const [a, b] = [...this.pointers.values()] as [PointerInfo, PointerInfo];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (this.pointers.size > 2) return;
    this.press = {
      id: e.pointerId,
      button: e.button,
      startX: p.x,
      startY: p.y,
      lastX: p.x,
      lastY: p.y,
      moved: false,
      touch: e.pointerType === 'touch',
      samples: [{ t: e.timeStamp, x: p.x, y: p.y }],
    };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [PointerInfo, PointerInfo];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch.dist > 0 && dist > 0) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.camera.zoomAtScreenImmediate(dist / this.pinch.dist, mx, my);
      }
      this.pinch.dist = dist;
      return;
    }
    const pr = this.press;
    if (pr && e.pointerId === pr.id) {
      const totalX = p.x - pr.startX;
      const totalY = p.y - pr.startY;
      if (!pr.moved && Math.hypot(totalX, totalY) > (pr.touch ? DRAG_THRESHOLD_TOUCH : DRAG_THRESHOLD_MOUSE)) {
        pr.moved = true;
        this.handlers.onHover(null);
      }
      if (pr.moved) {
        this.camera.panByScreen(p.x - pr.lastX, p.y - pr.lastY);
        pr.samples.push({ t: e.timeStamp, x: p.x, y: p.y });
        if (pr.samples.length > 8) pr.samples.shift();
      }
      pr.lastX = p.x;
      pr.lastY = p.y;
      return;
    }
    if (e.pointerType === 'mouse') {
      this.lastPointer = p;
      this.handlers.onHover(p);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.press = null;
      return;
    }
    const pr = this.press;
    if (!pr || pr.id !== e.pointerId) return;
    this.press = null;
    if (pr.moved) {
      // fling from the last ~100 ms of motion
      const last = pr.samples[pr.samples.length - 1];
      const first = pr.samples.find((s) => last && last.t - s.t <= 110) ?? pr.samples[0];
      if (last && first && last.t > first.t && e.timeStamp - last.t < 60) {
        const dt = (last.t - first.t) / 1000;
        this.camera.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
      }
      return;
    }
    const button: PointerButton | null = pr.button === 0 ? 'left' : pr.button === 2 ? 'right' : null;
    if (button) this.handlers.onClick(p, button);
    if (e.pointerType === 'mouse') {
      this.lastPointer = p;
      this.handlers.onHover(p);
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.press && this.press.id === e.pointerId) this.press = null;
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.press) return;
    this.lastPointer = null;
    this.handlers.onHover(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    const k = e.ctrlKey ? 0.012 : 0.0017;
    const factor = Math.min(2, Math.max(0.5, Math.exp(-dy * k)));
    this.camera.zoomAtScreen(factor, p.x, p.y);
  };

  private updateKeys(): void {
    let dx = 0;
    let dy = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) dx -= 1;
    if (k.has('d') || k.has('arrowright')) dx += 1;
    if (k.has('w') || k.has('arrowup')) dy -= 1;
    if (k.has('s') || k.has('arrowdown')) dy += 1;
    const boost = k.has('shift') ? 1.8 : 1;
    const len = Math.hypot(dx, dy) || 1;
    this.camera.setKeyDirection((dx / len) * boost, (dy / len) * boost);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || isTypingTarget(e.target) || !isGameFocus(e.target, this.canvas) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) return;
    if (key.startsWith('arrow')) e.preventDefault();
    this.keys.add(key);
    this.updateKeys();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (this.keys.delete(key)) this.updateKeys();
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.updateKeys();
  };
}
