import * as THREE from 'three';
import gsap from 'gsap';
import type { AtmModel } from '../models/types';
import type { ComponentId } from '../core/types';
import type { SceneManager } from './SceneManager';
import type { Sfx } from '../audio/sfx';

export type ViewMode = 'exterior' | 'xray' | 'cutaway' | 'exploded' | 'internal';

export const VIEW_MODES: Array<{ id: ViewMode; label: string; tip: string }> = [
  { id: 'exterior', label: 'Exterior', tip: 'The ATM as a customer sees it' },
  { id: 'xray', label: 'X-ray', tip: 'Outer shell becomes transparent so the mechanisms show through' },
  { id: 'cutaway', label: 'Cutaway', tip: 'The right half of the shell is cut away' },
  { id: 'exploded', label: 'Exploded', tip: 'Major assemblies separate while keeping their relative positions' },
  { id: 'internal', label: 'Internal', tip: 'Service door and safe open, inspection lighting on' },
];

interface MatState {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  clipping: THREE.Plane[] | null;
}

/**
 * Switches between exterior / X-ray / cutaway / exploded / internal views by manipulating the
 * model's shell materials, door hinges and part offsets. All transitions are smooth (real time).
 */
export class ViewModes {
  mode: ViewMode = 'exterior';
  private shellMats = new Map<THREE.Material, MatState>();
  private basePositions = new Map<ComponentId, THREE.Vector3>();
  private explode = { amount: 0 };
  private xray = { amount: 0 };
  private cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10);
  private cut = { x: 10 };
  private inspectionLights: THREE.Light[] = [];
  private listeners = new Set<(m: ViewMode) => void>();
  /** Doors requested open by maintenance mode / tours independent of the view mode. */
  doorsHeldOpen = false;

  constructor(private stage: SceneManager, private model: AtmModel, private sfx: Sfx) {
    for (const mesh of model.shellMeshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!this.shellMats.has(m)) {
          this.shellMats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, clipping: m.clippingPlanes });
        }
      }
    }
    for (const [id, obj] of model.parts) this.basePositions.set(id, obj.position.clone());

    // Inspection lighting: cool white lights in front of the upper module and the safe.
    const l1 = new THREE.PointLight(0xe8f4ff, 0, 2.2, 1.6);
    l1.position.set(0.15, 1.35, 0.9);
    const l2 = new THREE.PointLight(0xe8f4ff, 0, 2.2, 1.6);
    l2.position.set(-0.1, 0.55, 1.0);
    const l3 = new THREE.SpotLight(0xffffff, 0, 3, Math.PI / 5, 0.5, 1.2);
    l3.position.set(1.2, 1.6, 1.2);
    l3.target.position.set(0, 0.8, 0);
    this.inspectionLights = [l1, l2, l3];
    for (const l of this.inspectionLights) stage.scene.add(l);
    stage.scene.add(l3.target);
  }

  onChange(fn: (m: ViewMode) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setMode(mode: ViewMode, opts: { moveCamera?: boolean } = {}): void {
    const prev = this.mode;
    this.mode = mode;
    const d = 0.9;
    gsap.to(this.xray, { amount: mode === 'xray' ? 1 : 0, duration: d, onUpdate: () => this.applyXray() });
    gsap.to(this.cut, { x: mode === 'cutaway' ? 0.02 : 10, duration: mode === 'cutaway' ? d : 0.01, ease: 'power2.out', onUpdate: () => this.applyCut() });
    gsap.to(this.explode, { amount: mode === 'exploded' ? 1 : 0, duration: 1.4, ease: 'power2.inOut', onUpdate: () => this.applyExplode() });
    this.setInspectionLights(mode === 'internal' || this.doorsHeldOpen ? 1 : 0);
    const wantDoors = mode === 'internal' || this.doorsHeldOpen;
    this.setDoors(wantDoors ? 1 : 0, wantDoors ? 1 : 0);

    if (opts.moveCamera !== false && prev !== mode) {
      const f = this.model.anchors.focus;
      if (mode === 'internal') this.stage.focus(f.dispenser.position, f.dispenser.target);
      else if (mode === 'cutaway') this.stage.focus(f.side.position, f.side.target);
      else if (mode === 'exploded') this.stage.focus(new THREE.Vector3(2.5, 1.9, 3.3), new THREE.Vector3(0, 0.95, 0));
      else if (mode === 'xray') this.stage.focus(new THREE.Vector3(1.3, 1.45, 1.9), new THREE.Vector3(0, 0.9, 0));
      else this.stage.focus(f.front.position, f.front.target);
    }
    for (const l of this.listeners) l(mode);
  }

  /** Open/close doors smoothly (0..1). */
  setDoors(service: number, vault: number, durationSec = 1.2): Promise<void> {
    const s = this.model.doors.service;
    const v = this.model.doors.vault;
    if (Math.abs(s.open - service) < 0.01 && Math.abs(v.open - vault) < 0.01) return Promise.resolve();
    this.sfx.play('panel');
    const st = { s: s.open, v: v.open };
    return new Promise((resolve) => {
      gsap.to(st, {
        s: service,
        v: vault,
        duration: durationSec,
        ease: 'power2.inOut',
        onUpdate: () => {
          s.setOpen(st.s);
          v.setOpen(st.v);
        },
        onComplete: () => resolve(),
      });
    });
  }

  holdDoorsOpen(open: boolean): void {
    this.doorsHeldOpen = open;
    const want = open || this.mode === 'internal';
    this.setDoors(want ? 1 : 0, want ? 1 : 0);
    this.setInspectionLights(want ? 1 : 0);
  }

  private setInspectionLights(level: number): void {
    const targets = [2.2, 2.2, 6];
    this.inspectionLights.forEach((l, i) => gsap.to(l, { intensity: targets[i] * level, duration: 0.8 }));
  }

  private applyXray(): void {
    const a = this.xray.amount;
    for (const [m, s] of this.shellMats) {
      if (a > 0.001) {
        m.transparent = true;
        m.opacity = s.opacity * (1 - a * 0.86);
        m.depthWrite = a < 0.5;
      } else {
        m.transparent = s.transparent;
        m.opacity = s.opacity;
        m.depthWrite = s.depthWrite;
      }
      m.needsUpdate = true;
    }
  }

  private applyCut(): void {
    this.cutPlane.constant = this.cut.x;
    const active = this.cut.x < 5;
    for (const [m, s] of this.shellMats) {
      m.clippingPlanes = active ? [this.cutPlane] : s.clipping;
      m.clipShadows = active;
      m.side = active ? THREE.DoubleSide : m.side;
      m.needsUpdate = true;
    }
  }

  private applyExplode(): void {
    const a = this.explode.amount;
    for (const [id, obj] of this.model.parts) {
      const base = this.basePositions.get(id);
      const off = this.model.explodeOffsets.get(id);
      if (!base) continue;
      if (off) obj.position.copy(base).addScaledVector(off, a);
      else obj.position.copy(base);
    }
  }

  /** Called on simulator reset. */
  reset(): void {
    this.doorsHeldOpen = false;
    this.setMode('exterior');
  }
}
