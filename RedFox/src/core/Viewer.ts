/**
 * Renderer, camera, orbit controls and the frame loop.
 */
import {
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  Timer,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const DEFAULT_CAMERA = {
  position: new Vector3(0.95, 0.5, 1.05),
  target: new Vector3(0, 0.27, -0.12),
};

export type FrameCallback = (dt: number, elapsed: number) => void;

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Smoothed frames per second. */
  fps = 60;
  /** Horizontal shift (CSS px) of the projection centre, so the subject centres beside a side panel. */
  private viewShift = 0;

  private readonly timer = new Timer();
  private readonly callbacks: FrameCallback[] = [];
  private readonly beforeRender: (() => void)[] = [];
  private readonly afterRender: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  private running = false;
  private frame = 0;
  private cameraTween: { from: Vector3; to: Vector3; tFrom: Vector3; tTo: Vector3; t: number } | null = null;

  constructor(private readonly container: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.75 : 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'viewport';
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(32, 1, 0.02, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    // Pause timekeeping while the tab is hidden so the fox doesn't jump on return.
    this.timer.connect(document);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const home = this.homeView();
    this.camera.position.copy(home.position);
    this.controls.target.copy(home.target);
    this.controls.update();
  }

  /**
   * Default framing, pulled back on narrow (portrait) screens so the whole fox fits, and lifted
   * so it sits above the mobile control sheet.
   */
  homeView(): { position: Vector3; target: Vector3 } {
    const aspect = this.camera.aspect;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const fit = Math.max(1, 0.44 / (halfH * aspect));
    const target = DEFAULT_CAMERA.target.clone();
    if (aspect < 0.8) target.y -= 0.12;
    const position = DEFAULT_CAMERA.position.clone().sub(DEFAULT_CAMERA.target).multiplyScalar(fit).add(target);
    return { position, target };
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb);
  }

  onBeforeRender(cb: () => void): void {
    this.beforeRender.push(cb);
  }

  onAfterRender(cb: () => void): void {
    this.afterRender.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    const loop = () => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Advances one frame. Exposed so tests and screenshots can step deterministically. */
  tick(fixedDt?: number): void {
    this.timer.update();
    const raw = this.timer.getDelta();
    // Clamp long frames (tab switches, hitches) so the animation never jumps.
    const dt = fixedDt ?? Math.min(raw, 1 / 20);
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    for (const cb of this.callbacks) cb(dt, this.timer.getElapsed());
    this.updateCameraTween(dt);
    this.controls.update(dt);
    // Count every pass of the frame (contact shadows + main view) in renderer.info.
    this.renderer.info.reset();
    for (const cb of this.beforeRender) cb();
    this.renderer.render(this.scene, this.camera);
    for (const cb of this.afterRender) cb();
  }

  /** Smoothly flies the camera back to its default framing. */
  resetCamera(): void {
    const home = this.homeView();
    this.cameraTween = {
      from: this.camera.position.clone(),
      to: home.position,
      tFrom: this.controls.target.clone(),
      tTo: home.target,
      t: 0,
    };
  }

  private updateCameraTween(dt: number): void {
    const tw = this.cameraTween;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + dt / 0.8);
    const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(tw.from, tw.to, e);
    this.controls.target.lerpVectors(tw.tFrom, tw.tTo, e);
    if (tw.t >= 1) this.cameraTween = null;
  }

  async toggleFullscreen(): Promise<void> {
    const root = document.documentElement;
    if (!document.fullscreenElement) await root.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  setViewShift(px: number): void {
    this.viewShift = px;
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back a little on portrait screens so the whole fox stays in frame.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    const shift = w > 720 ? this.viewShift : 0;
    if (shift) this.camera.setViewOffset(w, h, shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

