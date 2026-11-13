import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AnimatedValue, Ease } from '../animation/Tween';

export type ViewName = 'home' | 'front' | 'back' | 'left' | 'right' | 'top' | 'exploded';

const VIEWS: Record<ViewName, { position: [number, number, number]; target: [number, number, number] }> = {
  home: { position: [170, 95, 430], target: [12, -4, 0] },
  front: { position: [0, 8, 440], target: [0, 0, 0] },
  back: { position: [0, 30, -440], target: [0, 0, 0] },
  left: { position: [-430, 30, 40], target: [0, 0, 0] },
  right: { position: [430, 30, 40], target: [0, 0, 0] },
  top: { position: [0, 470, 60], target: [0, 0, 0] },
  exploded: { position: [-520, 170, 330], target: [0, 0, 0] },
};

/**
 * Orbit/zoom/pan via OrbitControls plus smooth, interruptible camera flights. Any user drag or
 * scroll cancels a flight in progress, so the camera never fights the user.
 */
export class CameraController {
  readonly controls: OrbitControls;
  private readonly flight = new AnimatedValue(1);
  private readonly fromPos = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly box = new THREE.Box3();
  private readonly tmp = new THREE.Vector3();
  private readonly size = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60;
    this.controls.maxDistance = 1100;
    this.controls.maxPolarAngle = Math.PI * 0.6;
    this.controls.zoomToCursor = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.target.set(...VIEWS.home.target);
    camera.position.set(...VIEWS.home.position);
    this.controls.addEventListener('start', this.cancel);
    this.controls.update();
  }

  get flying(): boolean {
    return this.flight.active;
  }

  view(name: ViewName, duration = 1.1): void {
    const v = VIEWS[name];
    this.flyTo(this.tmp.set(...v.position), new THREE.Vector3(...v.target), duration);
  }

  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration = 1.1): void {
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.controls.target);
    this.toPos.copy(position);
    this.toTarget.copy(target);
    this.flight.snap(0);
    this.flight.animateTo(1, duration, Ease.inOutCubic);
  }

  /** Frames an object, approaching from the side the camera is already on (or `normal`). */
  focusObject(object: THREE.Object3D, normal?: THREE.Vector3, padding = 2.4): void {
    this.box.setFromObject(object);
    if (this.box.isEmpty()) return;
    const center = this.box.getCenter(new THREE.Vector3());
    this.box.getSize(this.size);
    const radius = Math.max(this.size.length() / 2, 8);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = Math.max(this.controls.minDistance, (radius * padding) / Math.tan(fov / 2));
    const dir = normal ? normal.clone().normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(center.clone().addScaledVector(dir, distance), center);
  }

  /** Tight framing of the LCD, square-on to the screen. */
  focusScreen(center: THREE.Vector3, normal: THREE.Vector3): void {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.max(0.5, Math.min(this.camera.aspect, 1.6));
    const distance = 42 / Math.tan(fov / 2) / Math.min(1, aspect);
    this.flyTo(center.clone().addScaledVector(normal, distance), center.clone(), 1.0);
  }

  update(dt: number): void {
    if (this.flight.active) {
      this.flight.update(dt);
      const t = this.flight.value;
      this.camera.position.lerpVectors(this.fromPos, this.toPos, t);
      this.controls.target.lerpVectors(this.fromTarget, this.toTarget, t);
    }
    this.controls.update(dt);
  }

  dispose(): void {
    this.controls.removeEventListener('start', this.cancel);
    this.controls.dispose();
  }

  private readonly cancel = (): void => {
    if (this.flight.active) this.flight.snap(this.flight.value);
  };
}
