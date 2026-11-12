import * as THREE from 'three';
import type { ComponentId, KeypadKey } from '../core/types';
import type { AtmModel } from '../models/types';
import type { SceneManager } from '../scene/SceneManager';

export interface InteractionHandlers {
  onKey(key: KeypadKey): void;
  onScreenUv(uv: THREE.Vector2): void;
  onSelect(id: ComponentId | null): void;
  /** Card dropped on (or clicked toward) a reader. */
  onCard(method: 'chip' | 'contactless'): void;
  onProp(prop: 'cash' | 'card-ejected' | 'receipt'): void;
  /** Tooltip text for a hovered component. */
  describe(id: ComponentId): string;
  /** Whether the customer card may be used right now. */
  cardUsable(): boolean;
}

interface Hit {
  object: THREE.Object3D;
  point: THREE.Vector3;
  uv?: THREE.Vector2;
  componentId?: ComponentId;
  key?: KeypadKey;
  prop?: string;
  screen?: boolean;
}

/**
 * Raycast-based interaction with the 3D ATM: hover outlines + tooltips, clicking keys, screen
 * buttons and parts, collecting cash/card/receipt, and dragging the training card to a reader.
 */
export class Interaction {
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down?: { x: number; y: number; t: number };
  private hoverObj?: THREE.Object3D;
  private pendingMove?: PointerEvent;
  private drag?: { plane: THREE.Plane; offset: THREE.Vector3; start: THREE.Matrix4; startParent: THREE.Object3D };
  private tooltip = document.getElementById('tooltip')!;
  /** Extra transient targets (presented cash, ejected card, receipt). */
  getTransient: () => THREE.Object3D[] = () => [];
  enabled = true;

  constructor(private stage: SceneManager, private model: AtmModel, private h: InteractionHandlers) {
    const el = stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => (this.pendingMove = e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => this.clearHover());
    this.raycaster.params.Line = { threshold: 0.005 };
  }

  /** Called once per frame: processes the latest pointer move (keeps raycasting to ≤1 per frame). */
  update(): void {
    const e = this.pendingMove;
    this.pendingMove = undefined;
    if (!e || !this.enabled) return;
    if (this.drag) {
      this.dragMove(e);
      return;
    }
    if (e.buttons) return; // orbiting
    const hit = this.pick(e);
    this.setHover(hit, e);
  }

  private setNdc(e: PointerEvent): void {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: PointerEvent): Hit | undefined {
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const targets = [this.model.root, ...this.getTransient()];
    const card = this.model.props.card;
    if (!this.isDescendant(card, this.model.root)) targets.push(card);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const it of hits) {
      if (!it.object.visible || !isVisibleChain(it.object)) continue;
      const mat = (it.object as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && !Array.isArray(mat) && mat.transparent && mat.opacity < 0.25) continue; // see through X-ray shell
      if (it.object.userData.noPick) continue;
      const res: Hit = { object: it.object, point: it.point, uv: it.uv ?? undefined };
      let o: THREE.Object3D | null = it.object;
      while (o) {
        const ud = o.userData;
        if (ud.prop && !res.prop) res.prop = ud.prop;
        if (ud.key && !res.key) res.key = ud.key;
        if (ud.componentId && !res.componentId) res.componentId = ud.componentId;
        if (o === this.model.screenMesh) res.screen = true;
        o = o.parent;
      }
      return res;
    }
    return undefined;
  }

  private isDescendant(o: THREE.Object3D, root: THREE.Object3D): boolean {
    let p: THREE.Object3D | null = o;
    while (p) {
      if (p === root) return true;
      p = p.parent;
    }
    return false;
  }

  private outlineTarget(hit: Hit): THREE.Object3D {
    if (hit.prop) {
      let o: THREE.Object3D = hit.object;
      while (o.parent && !o.userData.prop) o = o.parent;
      return o;
    }
    if (hit.key) return hit.object;
    if (hit.componentId) return this.model.parts.get(hit.componentId) ?? hit.object;
    return hit.object;
  }

  private setHover(hit: Hit | undefined, e: PointerEvent): void {
    const target = hit ? this.outlineTarget(hit) : undefined;
    const el = this.stage.renderer.domElement;
    if (target !== this.hoverObj) {
      this.hoverObj = target;
      this.stage.hoverOutline.selectedObjects = target && !hit?.screen ? [target] : [];
    }
    if (!hit) {
      this.tooltip.style.display = 'none';
      el.style.cursor = 'default';
      return;
    }
    let text = '';
    if (hit.prop === 'cash') text = '<b>Presented cash</b><br>Click to take your cash';
    else if (hit.prop === 'card-ejected') text = '<b>Your card</b><br>Click to take your card';
    else if (hit.prop === 'receipt') text = '<b>Receipt</b><br>Click to take the receipt';
    else if (hit.prop === 'card') text = this.h.cardUsable() ? '<b>Training card</b><br>Drag to the card slot or contactless reader — or click to insert' : '<b>Training card</b><br>Not available right now';
    else if (hit.key) text = `<b>Keypad</b> · ${hit.key}`;
    else if (hit.screen) text = '<b>Touch screen</b> · click a button';
    else if (hit.componentId) text = this.h.describe(hit.componentId);
    if (text) {
      this.tooltip.innerHTML = text;
      this.tooltip.style.display = 'block';
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY + 14}px`;
    } else this.tooltip.style.display = 'none';
    el.style.cursor = hit.prop || hit.key || hit.screen ? 'pointer' : hit.componentId ? 'help' : 'default';
  }

  private clearHover(): void {
    this.hoverObj = undefined;
    this.stage.hoverOutline.selectedObjects = [];
    this.tooltip.style.display = 'none';
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    const hit = this.pick(e);
    if (hit?.prop === 'card' && this.h.cardUsable()) {
      // Start dragging the card on a plane facing the camera through the card's position.
      const card = this.model.props.card;
      const wp = card.getWorldPosition(new THREE.Vector3());
      const n = this.stage.camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, wp);
      const p = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, p);
      this.drag = { plane, offset: wp.clone().sub(p), start: card.matrix.clone(), startParent: card.parent! };
      this.stage.controls.enabled = false;
      this.stage.renderer.domElement.setPointerCapture(e.pointerId);
    }
  }

  private dragMove(e: PointerEvent): void {
    if (!this.drag) return;
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.drag.plane, p)) return;
    const card = this.model.props.card;
    const world = p.add(this.drag.offset);
    card.parent!.worldToLocal(world);
    card.position.copy(world);
    // Glow the reader the card is near.
    const near = this.nearestReader();
    this.stage.hoverOutline.selectedObjects = near ? [this.model.parts.get(near === 'chip' ? 'card-reader' : 'contactless-reader')!].filter(Boolean) : [card];
  }

  private nearestReader(): 'chip' | 'contactless' | undefined {
    const cp = this.model.props.card.getWorldPosition(new THREE.Vector3());
    const slot = this.model.anchors.cardSlot.getWorldPosition(new THREE.Vector3());
    const cl = this.model.anchors.contactless.getWorldPosition(new THREE.Vector3());
    const ds = cp.distanceTo(slot);
    const dc = cp.distanceTo(cl);
    if (ds < 0.12 && ds <= dc) return 'chip';
    if (dc < 0.12) return 'contactless';
    return undefined;
  }

  private onUp(e: PointerEvent): void {
    if (this.drag) {
      const moved = this.down ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) : 0;
      const near = this.nearestReader();
      const card = this.model.props.card;
      this.stage.controls.enabled = true;
      const start = this.drag.start;
      this.drag = undefined;
      this.stage.hoverOutline.selectedObjects = [];
      if (moved < 5) {
        start.decompose(card.position, card.quaternion, card.scale);
        this.h.onCard('chip');
      } else if (near) this.h.onCard(near);
      else start.decompose(card.position, card.quaternion, card.scale); // snap back to the shelf
      this.down = undefined;
      return;
    }
    if (!this.down || !this.enabled) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = undefined;
    if (moved > 5) return; // it was an orbit drag
    const hit = this.pick(e);
    if (!hit) {
      this.h.onSelect(null);
      return;
    }
    if (hit.prop === 'cash' || hit.prop === 'card-ejected' || hit.prop === 'receipt') this.h.onProp(hit.prop);
    else if (hit.key) {
      this.pressKey(hit.object);
      this.h.onKey(hit.key);
    } else if (hit.screen && hit.uv) this.h.onScreenUv(hit.uv);
    else if (hit.componentId) this.h.onSelect(hit.componentId);
  }

  /** Visual key travel: the key dips 2 mm into the keypad and springs back. */
  pressKey(mesh: THREE.Object3D): void {
    if (mesh.userData.pressing) return;
    mesh.userData.pressing = true;
    const dir = new THREE.Vector3(0, 0, -0.002);
    mesh.position.add(dir);
    setTimeout(() => {
      mesh.position.sub(dir);
      mesh.userData.pressing = false;
    }, 120);
  }
}

function isVisibleChain(o: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}
