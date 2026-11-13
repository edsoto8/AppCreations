import * as THREE from 'three';

export type FrameCallback = (dt: number, elapsed: number) => void;

/**
 * Owns the renderer, scene, camera and the animation loop. Rendering is continuous (the LCD and
 * idle motion change every frame); the loop pauses automatically while the tab is hidden.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly callbacks: FrameCallback[] = [];
  private readonly timer = new THREE.Timer();
  private readonly resizeObserver: ResizeObserver;
  private elapsed = 0;
  private frames = 0;
  private fpsTime = 0;
  /** Smoothed frames per second (for the debug readout). */
  fps = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'scene-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 1, 5, 4000);
    this.camera.position.set(170, 90, 430);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.timer.connect(document);
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb);
  }

  start(): void {
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the console comfortably framed on tall (phone) screens.
    this.camera.fov = w / h < 0.8 ? 46 : 32;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.timer.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(time: number): void {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }
    for (const cb of this.callbacks) cb(dt, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }
}
