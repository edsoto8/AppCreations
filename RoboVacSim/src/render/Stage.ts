import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from '../app/types';
import type { Rect } from '../sim/world/types';

export const QUALITY_SETTINGS: Record<Quality, { pixelRatio: number; shadows: boolean; shadowMap: number; ao: boolean; antialias: boolean }> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMap: 1024, ao: false, antialias: false },
  medium: { pixelRatio: 1, shadows: true, shadowMap: 1024, ao: false, antialias: true },
  high: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, ao: false, antialias: true },
  ultra: { pixelRatio: 2, shadows: true, shadowMap: 4096, ao: true, antialias: true },
};

/**
 * Renderer, scene, lighting and post-processing. Lighting is a soft image-based environment
 * (RoomEnvironment PMREM) plus a shadow-casting key light fitted to the house bounds.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly ground: THREE.Mesh;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private composer: EffectComposer | null = null;
  private aoPass: GTAOPass | null = null;
  private quality: Quality = 'high';
  /** Extra pixel-ratio multiplier from the adaptive performance governor (0.5..1). */
  adaptiveScale = 1;
  private width = 1;
  private height = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Count draw calls across all passes of a frame (composer passes would otherwise reset it).
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '3D simulation viewport');
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 200);
    this.scene.background = new THREE.Color('#0a0e13');
    this.scene.fog = new THREE.Fog('#0a0e13', 30, 70);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight('#dfe8f5', '#3a3128', 0.6);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff4e6', 2.2);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight('#9fc3ff', 0.45);
    this.fill.position.set(-8, 6, -10);
    this.scene.add(this.fill);

    const groundMat = new THREE.MeshStandardMaterial({ color: '#0f1419', roughness: 0.95, metalness: 0 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -2.3; // below the stairwell shaft (~-2 m)
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.setQuality('high');
  }

  /** Fit the shadow camera and key light to the house. */
  fitBounds(b: Rect): void {
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const r = Math.hypot(b.w, b.h) / 2 + 1;
    this.key.position.set(cx + r * 0.6, r * 1.6, cz + r * 0.9);
    this.key.target.position.set(cx, 0, cz);
    const cam = this.key.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const s = QUALITY_SETTINGS[q];
    this.renderer.shadowMap.enabled = s.shadows;
    this.key.castShadow = s.shadows;
    if (this.key.shadow.mapSize.x !== s.shadowMap) {
      this.key.shadow.mapSize.set(s.shadowMap, s.shadowMap);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.setupComposer(s.ao);
    this.resize();
  }

  get qualityLevel(): Quality {
    return this.quality;
  }

  private setupComposer(ao: boolean): void {
    this.composer?.dispose();
    this.aoPass?.dispose();
    this.composer = null;
    this.aoPass = null;
    if (!ao) return;
    const composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
    composer.addPass(new RenderPass(this.scene, this.camera));
    const ao2 = new GTAOPass(this.scene, this.camera, 1, 1);
    ao2.blendIntensity = 0.85;
    ao2.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
    composer.addPass(ao2);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.aoPass = ao2;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, QUALITY_SETTINGS[this.quality].pixelRatio) * this.adaptiveScale;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(Math.max(0.5, pr));
  }

  checkResize(): void {
    if (this.container.clientWidth !== this.width || this.container.clientHeight !== this.height) this.resize();
  }

  render(): void {
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
    this.aoPass?.dispose();
    this.envTarget.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.key.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
