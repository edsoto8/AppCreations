import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { LIGHTING_PRESETS, type LightingPresetId } from './LightingPresets';

export { LIGHTING_PRESETS, type LightingPresetId };

/**
 * Three-point studio lighting, an environment map for reflections, a shadow-catching floor, and
 * switchable presets. The page backdrop is CSS (the WebGL canvas is transparent).
 */
export class LightingManager {
  readonly floorY: number;
  private readonly key = new THREE.DirectionalLight();
  private readonly fill = new THREE.DirectionalLight();
  private readonly rim = new THREE.DirectionalLight();
  private readonly hemi = new THREE.HemisphereLight();
  private readonly floor: THREE.Mesh<THREE.CircleGeometry, THREE.ShadowMaterial>;
  private readonly envMap: THREE.Texture;
  private current: LightingPresetId = 'studio';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    floorY: number,
    private readonly backdrop: HTMLElement,
  ) {
    this.floorY = floorY;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.03).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = this.envMap;

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const cam = this.key.shadow.camera;
    cam.left = -260;
    cam.right = 260;
    cam.top = 260;
    cam.bottom = -260;
    cam.near = 50;
    cam.far = 1200;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    this.key.shadow.radius = 6;
    this.key.target.position.set(0, -20, 0);
    this.fill.position.set(-300, 80, 180);
    this.rim.position.set(-120, 220, -320);
    scene.add(this.key, this.key.target, this.fill, this.rim, this.hemi);

    this.floor = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.ShadowMaterial({ opacity: 0.26 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = floorY;
    this.floor.receiveShadow = true;
    this.floor.name = 'floor';
    scene.add(this.floor);
  }

  get preset(): LightingPresetId {
    return this.current;
  }

  get theme(): 'light' | 'dark' {
    return LIGHTING_PRESETS[this.current].theme;
  }

  apply(id: LightingPresetId): void {
    const p = LIGHTING_PRESETS[id];
    this.current = id;
    this.key.color.setHex(p.key.color);
    this.key.intensity = p.key.intensity;
    this.key.position.set(...p.key.position);
    this.fill.color.setHex(p.fill.color);
    this.fill.intensity = p.fill.intensity;
    this.rim.color.setHex(p.rim.color);
    this.rim.intensity = p.rim.intensity;
    this.hemi.color.setHex(p.hemi.sky);
    this.hemi.groundColor.setHex(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    this.scene.environmentIntensity = p.environment;
    this.floor.material.opacity = p.shadowOpacity;
    this.renderer.toneMappingExposure = p.exposure;
    this.backdrop.style.background = p.background;
    document.documentElement.dataset.theme = p.theme;
  }

  dispose(): void {
    this.envMap.dispose();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.key.shadow.map?.dispose();
    this.scene.remove(this.key, this.key.target, this.fill, this.rim, this.hemi, this.floor);
  }
}
