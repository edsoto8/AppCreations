import * as THREE from 'three';
import type { LCDRenderer } from '../display/LCDRenderer';
import type { ButtonId } from '../games/GameInterface';
import type { ConsoleSystem } from '../hardware/ConsoleSystem';
import type { CartridgeRig } from '../models/CartridgeRig';
import type { GameBoyModel, PartId } from '../models/GameBoyModel';
import type { CameraController, ViewName } from '../scene/CameraController';
import type { LightingPresetId } from '../scene/LightingManager';
import type { SceneManager } from '../scene/SceneManager';

export interface DebugDeps {
  machine: ConsoleSystem;
  lcd: LCDRenderer;
  camera: CameraController;
  model: GameBoyModel;
  rig: CartridgeRig;
  sceneMgr: SceneManager;
  actions: {
    togglePower(): void;
    toggleCartridge(id: string): void;
    setExploded(on: boolean): void;
    setTransparent(on: boolean): void;
    setScreenFocus(on: boolean): void;
    setOverlay(on: boolean): void;
    setLighting(id: LightingPresetId): void;
    tap(b: ButtonId): void;
  };
  state(): Record<string, boolean>;
}

/**
 * `window.pocketPixel`: a small console API for tinkering and for the Playwright tests. It only
 * drives the same public actions the UI uses.
 */
export function installDebugApi(d: DebugDeps): void {
  const api = {
    state: () => ({
      mode: d.machine.mode,
      power: d.machine.isOn,
      cartridge: d.machine.cartridge?.id ?? null,
      bootPhase: d.machine.bootPhase,
      ticks: d.machine.ticks,
      volume: d.machine.volume.value,
      contrast: d.machine.contrast.value,
      batteryCoverOpen: d.machine.batteryCoverOpen,
      cartridgeMoving: d.rig.busy,
      explodeProgress: d.model.explodeProgress,
      lcdAverage: d.lcd.averageIntensity(),
      fps: d.sceneMgr.fps,
      drawCalls: d.sceneMgr.renderer.info.render.calls,
      ...d.state(),
    }),
    /** Hash of the framebuffer, to detect that the picture changed. */
    frameHash: (): number => {
      let h = 2166136261;
      for (const v of d.machine.framebuffer.data) h = Math.imul(h ^ v, 16777619);
      return h >>> 0;
    },
    /** Runs n fixed 60 Hz ticks immediately (deterministic, independent of frame rate). */
    step: (n = 1) => {
      for (let i = 0; i < n; i++) d.machine.step();
    },
    /** Client (CSS pixel) coordinates of a part's visual centre, for real pointer tests. */
    screenPoint: (part: PartId): { x: number; y: number } | null => {
      const obj = d.model.parts.get(part);
      if (!obj) return null;
      const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      center.project(d.sceneMgr.camera);
      const rect = d.sceneMgr.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((center.x + 1) / 2) * rect.width, y: rect.top + ((1 - center.y) / 2) * rect.height };
    },
    held: (b: ButtonId) => d.machine.buttons.isHeld(b),
    press: (b: ButtonId) => d.machine.buttons.press(b, 'test'),
    release: (b: ButtonId) => d.machine.buttons.release(b, 'test'),
    tap: d.actions.tap,
    power: d.actions.togglePower,
    cartridge: d.actions.toggleCartridge,
    exploded: d.actions.setExploded,
    xray: d.actions.setTransparent,
    screenFocus: d.actions.setScreenFocus,
    overlay: d.actions.setOverlay,
    lighting: d.actions.setLighting,
    view: (name: ViewName) => d.camera.view(name, 0.01),
    cover: (open: boolean) => d.machine.setBatteryCover(open),
  };
  (window as unknown as { pocketPixel: typeof api }).pocketPixel = api;
}
