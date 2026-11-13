import * as THREE from 'three';
import type { ButtonId } from '../games/GameInterface';
import type { PartId } from '../models/GameBoyModel';

export type PickId = PartId | 'cartridge';

export interface Pick {
  part: PickId;
  object: THREE.Object3D;
  /** Set when a cartridge was picked. */
  cartridgeId?: string;
  point: THREE.Vector3;
}

export interface InteractionHandlers {
  pressButton(button: ButtonId, down: boolean): void;
  togglePower(): void;
  /** Wheel drag/scroll: delta in wheel detents (positive = up/increase). */
  turnDial(which: 'volume' | 'contrast', detents: number, continuous: boolean): void;
  toggleBatteryCover(): void;
  clickCartridge(id: string): void;
  select(pick: Pick | null): void;
  focus(pick: Pick): void;
  hover(pick: Pick | null, clientX: number, clientY: number): void;
}

const BUTTON_PARTS: Partial<Record<PickId, ButtonId>> = {
  'button-a': 'a',
  'button-b': 'b',
  'button-start': 'start',
  'button-select': 'select',
};
const CLICK_SLOP_PX = 6;
const DIAL_PIXELS_PER_DETENT = 14;
/** A second click on the same part within this window is half of a double-click (focus), not a toggle. */
const DOUBLE_CLICK_MS = 400;

/**
 * Mouse/touch interaction with the 3D model: hover, click-to-press (held while the pointer is
 * down), D-pad direction from the hit point, thumb-wheel dragging and scrolling, double-click focus.
 *
 * Listeners are attached before OrbitControls is created, so a press on a control can disable
 * orbiting for that gesture and wheel events over a thumb wheel never zoom the camera.
 */
export class InteractionController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly local = new THREE.Vector3();
  private pointerDown: { id: number; x: number; y: number; pick: Pick | null; moved: boolean } | null = null;
  private heldButtons: ButtonId[] = [];
  private dial: { which: 'volume' | 'contrast'; lastY: number; acc: number } | null = null;
  private hoverQueued = false;
  private lastMove = { x: 0, y: 0 };
  private lastHoverPart: PickId | null = null;
  private lastAction: { part: PickId; time: number } | null = null;
  /** Called by the owner so orbiting can be suspended during control gestures. */
  setOrbitEnabled: (enabled: boolean) => void = () => undefined;

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly targets: THREE.Object3D[],
    private readonly handlers: InteractionHandlers,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('dblclick', this.onDoubleClick);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('lostpointercapture', this.onLostCapture);
    window.addEventListener('blur', this.cancelGesture);
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('dblclick', this.onDoubleClick);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('lostpointercapture', this.onLostCapture);
    window.removeEventListener('blur', this.cancelGesture);
  }

  /** Raycast at client coordinates; returns the nearest interactive part. */
  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.targets, true, this.hits);
    for (const hit of this.hits) {
      if (!isVisible(hit.object)) continue;
      const mat = (hit.object as THREE.Mesh).material as THREE.Material | undefined;
      // Skip nearly invisible surfaces (e.g. the shell in X-ray mode) so you can click through them.
      if (mat && !Array.isArray(mat) && mat.transparent && mat.opacity < 0.3 && mat.blending === THREE.NormalBlending) continue;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.part === undefined) o = o.parent;
      if (!o) continue;
      const part = o.userData.part as PickId;
      const pick: Pick = { part, object: this.partRoot(o, part), point: hit.point.clone() };
      const cid = o.userData.cartridgeId as string | undefined;
      if (cid) pick.cartridgeId = cid;
      return pick;
    }
    return null;
  }

  private partRoot(o: THREE.Object3D, part: PickId): THREE.Object3D {
    let root = o;
    while (root.parent && root.parent.userData.part === part) root = root.parent;
    return root;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.pointerDown) {
      // A mouse has one pointer: a new press means we missed the last release (e.g. outside the window).
      if (e.pointerType !== 'mouse') return;
      this.cancelGesture();
    }
    const pick = this.pick(e.clientX, e.clientY);
    this.pointerDown = { id: e.pointerId, x: e.clientX, y: e.clientY, pick, moved: false };
    if (!pick) return;
    const button = BUTTON_PARTS[pick.part];
    if (button) {
      this.hold([button], e.pointerId);
    } else if (pick.part === 'dpad') {
      this.hold(this.dpadDirections(pick), e.pointerId);
    } else if (pick.part === 'volume-wheel' || pick.part === 'contrast-wheel') {
      this.dial = { which: pick.part === 'volume-wheel' ? 'volume' : 'contrast', lastY: e.clientY, acc: 0 };
      this.capture(e.pointerId);
      this.setOrbitEnabled(false);
    }
  };

  private capture(pointerId: number): void {
    try {
      this.dom.setPointerCapture(pointerId);
    } catch {
      // Pointer already gone; the release path still cleans up.
    }
  }

  /** Ends the current gesture without treating it as a click (focus loss, lost capture). */
  private readonly cancelGesture = (): void => {
    for (const b of this.heldButtons) this.handlers.pressButton(b, false);
    this.heldButtons = [];
    this.dial = null;
    this.pointerDown = null;
    this.setOrbitEnabled(true);
  };

  private readonly onLostCapture = (e: PointerEvent): void => {
    if (this.pointerDown?.id === e.pointerId) this.cancelGesture();
  };

  private hold(buttons: ButtonId[], pointerId: number): void {
    this.capture(pointerId);
    this.setOrbitEnabled(false);
    this.heldButtons = buttons;
    for (const b of buttons) this.handlers.pressButton(b, true);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const pd = this.pointerDown;
    if (pd && pd.id === e.pointerId) {
      if (Math.hypot(e.clientX - pd.x, e.clientY - pd.y) > CLICK_SLOP_PX) pd.moved = true;
      if (this.dial) {
        this.dial.acc += this.dial.lastY - e.clientY;
        this.dial.lastY = e.clientY;
        const detents = Math.trunc(this.dial.acc / DIAL_PIXELS_PER_DETENT);
        if (detents !== 0) {
          this.dial.acc -= detents * DIAL_PIXELS_PER_DETENT;
          this.handlers.turnDial(this.dial.which, detents, true);
        }
        return;
      }
      // Sliding a finger across the D-pad changes direction like the real thing.
      if (pd.pick?.part === 'dpad' && this.heldButtons.length > 0) {
        const pick = this.pick(e.clientX, e.clientY);
        if (pick?.part === 'dpad') {
          const next = this.dpadDirections(pick);
          if (next.join() !== this.heldButtons.join()) {
            for (const b of this.heldButtons) if (!next.includes(b)) this.handlers.pressButton(b, false);
            for (const b of next) if (!this.heldButtons.includes(b)) this.handlers.pressButton(b, true);
            this.heldButtons = next;
          }
        }
      }
    }
    this.lastMove.x = e.clientX;
    this.lastMove.y = e.clientY;
    if (!this.hoverQueued && e.pointerType === 'mouse') {
      this.hoverQueued = true;
      requestAnimationFrame(this.updateHover);
    }
  };

  private readonly updateHover = (): void => {
    this.hoverQueued = false;
    if (this.pointerDown?.moved) return;
    const pick = this.pick(this.lastMove.x, this.lastMove.y);
    const part = pick?.part ?? null;
    this.dom.style.cursor = pick ? (isActionable(pick.part) ? 'pointer' : 'help') : 'grab';
    if (part !== this.lastHoverPart || pick) {
      this.lastHoverPart = part;
      this.handlers.hover(pick, this.lastMove.x, this.lastMove.y);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.lastHoverPart = null;
    this.handlers.hover(null, 0, 0);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const pd = this.pointerDown;
    if (!pd || pd.id !== e.pointerId) return;
    this.pointerDown = null;
    for (const b of this.heldButtons) this.handlers.pressButton(b, false);
    const wasHolding = this.heldButtons.length > 0;
    this.heldButtons = [];
    const wasDial = this.dial !== null;
    this.dial = null;
    this.setOrbitEnabled(true);
    if (pd.moved || e.type === 'pointercancel') return;
    const pick = pd.pick;
    if (!pick) {
      this.handlers.select(null);
      return;
    }
    // A plain click: act on the part, then show its info. The second click of a double-click only
    // focuses the camera (see onDoubleClick), so it must not toggle the part back.
    const isSecondClick = this.lastAction !== null && this.lastAction.part === pick.part && e.timeStamp - this.lastAction.time < DOUBLE_CLICK_MS;
    this.lastAction = isSecondClick ? null : { part: pick.part, time: e.timeStamp };
    if (!wasHolding && !wasDial && !isSecondClick) {
      switch (pick.part) {
        case 'power-switch':
          this.handlers.togglePower();
          break;
        case 'battery-cover':
          this.handlers.toggleBatteryCover();
          break;
        case 'cartridge':
          if (pick.cartridgeId) this.handlers.clickCartridge(pick.cartridgeId);
          break;
        default:
          break;
      }
    }
    this.handlers.select(pick);
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    const pick = this.pick(e.clientX, e.clientY);
    if (pick) this.handlers.focus(pick);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    const pick = this.pick(e.clientX, e.clientY);
    if (pick?.part !== 'volume-wheel' && pick?.part !== 'contrast-wheel') return;
    // Scroll over a thumb wheel turns it instead of zooming.
    e.preventDefault();
    e.stopImmediatePropagation();
    const detents = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0;
    if (detents) this.handlers.turnDial(pick.part === 'volume-wheel' ? 'volume' : 'contrast', detents, false);
  };

  /** Which D-pad directions a hit point presses (diagonals when near a corner). */
  private dpadDirections(pick: Pick): ButtonId[] {
    this.local.copy(pick.point);
    pick.object.worldToLocal(this.local);
    const { x, y } = this.local;
    const dead = 1.6;
    const out: ButtonId[] = [];
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax < dead && ay < dead) return out.length ? out : [ax > ay ? (x > 0 ? 'right' : 'left') : y > 0 ? 'up' : 'down'];
    if (ax > dead && ax > ay * 0.45) out.push(x > 0 ? 'right' : 'left');
    if (ay > dead && ay > ax * 0.45) out.push(y > 0 ? 'up' : 'down');
    return out;
  }
}

function isVisible(o: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return true;
}

function isActionable(part: PickId): boolean {
  return (
    part in BUTTON_PARTS ||
    part === 'dpad' ||
    part === 'power-switch' ||
    part === 'volume-wheel' ||
    part === 'contrast-wheel' ||
    part === 'battery-cover' ||
    part === 'cartridge' ||
    part === 'screen'
  );
}
