import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import gsap from 'gsap';

export type Quality = 'high' | 'medium' | 'low';

/**
 * Owns the WebGL renderer, scene, camera, orbit controls, post-processing (selection outlines)
 * and the render loop. Everything time-based in the simulation is driven from `onFrame` callbacks.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  readonly hoverOutline: OutlinePass;
  readonly selectOutline: OutlinePass;
  readonly alertOutline: OutlinePass;
  private frameCallbacks: Array<(dtMs: number) => void> = [];
  private last = performance.now();
  private envTex: THREE.Texture;
  quality: Quality = 'high';
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private cameraTween?: gsap.core.Tween;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;

    this.scene.background = new THREE.Color(0x10141c);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.02, 60);
    this.camera.position.set(0.55, 1.5, 2.6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 1.1, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.screenSpacePanning = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const size = new THREE.Vector2(512, 512);
    this.hoverOutline = makeOutline(size, this.scene, this.camera, 0xffffff, 0x666666, 1.2);
    this.selectOutline = makeOutline(size, this.scene, this.camera, 0x34e0cc, 0x135c55, 2.6);
    this.alertOutline = makeOutline(size, this.scene, this.camera, 0xff4d5e, 0x5c1018, 2.4);
    this.alertOutline.pulsePeriod = 1.2;
    this.composer.addPass(this.hoverOutline);
    this.composer.addPass(this.selectOutline);
    this.composer.addPass(this.alertOutline);
    this.composer.addPass(new OutputPass());

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
  }

  resize(): void {
    const el = this.canvas.parentElement!;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.25) : 0.85);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
    this.resize();
  }

  onFrame(cb: (dtMs: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = now - this.last;
      this.last = now;
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 1000) {
        this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAcc);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      for (const cb of this.frameCallbacks) cb(dt);
      this.controls.update();
      const anyOutline =
        this.hoverOutline.selectedObjects.length + this.selectOutline.selectedObjects.length + this.alertOutline.selectedObjects.length > 0;
      if (anyOutline && this.quality !== 'low') this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  /** Smooth camera move (real time, independent of simulation speed). */
  focus(position: THREE.Vector3, target: THREE.Vector3, durationSec = 1.2): Promise<void> {
    this.cameraTween?.kill();
    const from = { px: this.camera.position.x, py: this.camera.position.y, pz: this.camera.position.z, tx: this.controls.target.x, ty: this.controls.target.y, tz: this.controls.target.z };
    const to = { px: position.x, py: position.y, pz: position.z, tx: target.x, ty: target.y, tz: target.z };
    return new Promise((resolve) => {
      this.cameraTween = gsap.to(from, {
        ...to,
        duration: durationSec,
        ease: 'power2.inOut',
        onUpdate: () => {
          this.camera.position.set(from.px, from.py, from.pz);
          this.controls.target.set(from.tx, from.ty, from.tz);
        },
        onComplete: () => resolve(),
        onInterrupt: () => resolve(),
      });
    });
  }

  /** Frame an object: orbit to a pleasant 3/4 view at a distance based on its bounding sphere. */
  focusObject(obj: THREE.Object3D, durationSec = 1.0): Promise<void> {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return Promise.resolve();
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (dir.z < 0.2) dir.z = 0.6;
    dir.normalize();
    const dist = Math.max(0.45, sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15);
    return this.focus(sphere.center.clone().add(dir.multiplyScalar(dist)), sphere.center, durationSec);
  }
}

function makeOutline(size: THREE.Vector2, scene: THREE.Scene, camera: THREE.Camera, visible: number, hidden: number, strength: number): OutlinePass {
  const p = new OutlinePass(size, scene, camera);
  p.visibleEdgeColor.set(visible);
  p.hiddenEdgeColor.set(hidden);
  p.edgeStrength = strength;
  p.edgeThickness = 1.0;
  p.edgeGlow = 0.0;
  return p;
}
