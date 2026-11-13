import * as THREE from 'three';
import { AnimatedValue, Ease, progressBetween } from '../animation/Tween';
import type { CartridgeDefinition } from '../games/GameInterface';
import { CartridgeGeometry, CartridgeModel } from './CartridgeModel';
import type { GameBoyModel } from './GameBoyModel';
import type { Materials } from './Materials';

/** Fraction of the insertion timeline spent travelling from the table to above the slot. */
const TRAVEL_END = 0.62;
const INSERT_SECONDS = 1.35;
const HOVER_HEIGHT = 90;

interface CartState {
  model: CartridgeModel;
  progress: AnimatedValue;
  restPosition: THREE.Vector3;
  restQuaternion: THREE.Quaternion;
}

/**
 * Places every cartridge either on the display table or in the console's slot and animates the
 * transitions (lift, travel, slide in; and the reverse). Only one cartridge can occupy the slot: an
 * insertion waits until the previous cartridge has cleared it.
 */
export class CartridgeRig {
  readonly group = new THREE.Group();
  private readonly geometry = new CartridgeGeometry();
  private readonly carts = new Map<string, CartState>();
  private pendingInsert: string | null = null;
  private seatedId: string | null = null;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly hoverPos = new THREE.Vector3();
  private readonly slotPos = new THREE.Vector3();
  private readonly slotQuat = new THREE.Quaternion();
  private readonly upWorld = new THREE.Vector3();
  private readonly explodeOffset = new THREE.Vector3();
  private readonly anchorScale = new THREE.Vector3();

  /** Called when a cartridge finishes sliding in (for the clunk sound). */
  onSeated: ((id: string) => void) | null = null;
  /** Called when a cartridge starts leaving the slot. */
  onUnseated: ((id: string) => void) | null = null;

  constructor(
    definitions: readonly CartridgeDefinition[],
    m: Materials,
    anisotropy: number,
    private readonly console: GameBoyModel,
    floorY: number,
  ) {
    this.group.name = 'cartridges';
    definitions.forEach((def, i) => {
      const model = new CartridgeModel(def, this.geometry, m, anisotropy);
      // Lying label-up on the table to the right of the console, fanned slightly.
      const restPosition = new THREE.Vector3(112, floorY + 4.3, 58 - i * 72);
      // Yaw by ~180° so the label reads upright from the default (front) camera.
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - 0.3 + i * 0.14);
      const layFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const restQuaternion = yaw.multiply(layFlat);
      model.group.position.copy(restPosition);
      model.group.quaternion.copy(restQuaternion);
      this.group.add(model.group);
      this.carts.set(def.id, { model, progress: new AnimatedValue(0), restPosition, restQuaternion });
    });
  }

  /** Id of the cartridge physically in (or moving into) the slot. */
  get occupantId(): string | null {
    for (const [id, s] of this.carts) if (s.progress.target === 1) return id;
    return null;
  }

  /** True while any cartridge is moving. */
  get busy(): boolean {
    if (this.pendingInsert) return true;
    for (const s of this.carts.values()) if (s.progress.active) return true;
    return false;
  }

  insert(id: string, immediate = false): void {
    const state = this.carts.get(id);
    if (!state) return;
    if (immediate) {
      state.progress.snap(1);
      this.seatedId = id;
      return;
    }
    const blocked = [...this.carts.entries()].some(([other, s]) => other !== id && s.progress.value > TRAVEL_END * 0.9);
    if (blocked) this.pendingInsert = id;
    else this.startInsert(state);
  }

  eject(id: string): void {
    const state = this.carts.get(id);
    if (!state) return;
    if (this.pendingInsert === id) this.pendingInsert = null;
    state.progress.animateTo(0, INSERT_SECONDS, Ease.linear);
    if (this.seatedId === id) {
      this.seatedId = null;
      this.onUnseated?.(id);
    }
  }

  /** Brief refusal wiggle (e.g. trying to pull the cartridge while the power lock is engaged). */
  nudge(id: string): void {
    const s = this.carts.get(id);
    if (!s || s.progress.value < 0.999) return;
    s.progress.snap(0.985);
    s.progress.animateTo(1, 0.18, Ease.outBack);
  }

  update(dt: number): void {
    // Start a queued insertion once the slot is clear.
    if (this.pendingInsert) {
      const clear = [...this.carts.entries()].every(([id, s]) => id === this.pendingInsert || s.progress.value <= TRAVEL_END * 0.9);
      const pending = this.carts.get(this.pendingInsert);
      if (clear && pending) {
        this.startInsert(pending);
        this.pendingInsert = null;
      }
    }

    // Slot pose in world space (follows idle sway and the exploded view).
    const anchor = this.console.cartridgeAnchor;
    anchor.updateWorldMatrix(true, false);
    anchor.matrixWorld.decompose(this.slotPos, this.slotQuat, this.anchorScale);
    const e = Ease.inOutCubic(progressBetween(this.console.explodeProgress, 0.0, 0.62));
    this.explodeOffset.set(0, 62 * e, -34 * e).applyQuaternion(this.slotQuat);
    this.slotPos.add(this.explodeOffset);
    this.upWorld.set(0, 1, 0).applyQuaternion(this.slotQuat);
    this.hoverPos.copy(this.slotPos).addScaledVector(this.upWorld, HOVER_HEIGHT);

    for (const [id, s] of this.carts) {
      s.progress.update(dt);
      const p = s.progress.value;
      const g = s.model.group;
      if (p <= 0) {
        g.position.copy(s.restPosition);
        g.quaternion.copy(s.restQuaternion);
        continue;
      }
      if (p < TRAVEL_END) {
        const t = Ease.inOutCubic(p / TRAVEL_END);
        this.tmpPos.copy(s.restPosition).lerp(this.hoverPos, t);
        this.tmpPos.y += Math.sin(t * Math.PI) * 40; // arc over the table
        g.position.copy(this.tmpPos);
        this.tmpQuat.copy(s.restQuaternion).slerp(this.slotQuat, t);
        g.quaternion.copy(this.tmpQuat);
      } else {
        const t = Ease.inOutSine((p - TRAVEL_END) / (1 - TRAVEL_END));
        g.position.copy(this.hoverPos).lerp(this.slotPos, t);
        g.quaternion.copy(this.slotQuat);
      }
      if (p >= 0.999 && s.progress.target === 1 && this.seatedId !== id) {
        this.seatedId = id;
        this.onSeated?.(id);
      }
    }
  }

  dispose(): void {
    for (const s of this.carts.values()) s.model.dispose();
    this.geometry.dispose();
    this.group.removeFromParent();
  }

  private startInsert(state: CartState): void {
    state.progress.animateTo(1, INSERT_SECONDS * (1 - state.progress.value) + 0.2, Ease.linear);
  }
}
