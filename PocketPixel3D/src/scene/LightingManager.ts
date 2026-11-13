import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type LightingPresetId = 'studio' | 'dark' | 'warm' | 'gallery';

interface LightingPreset {
  label: string;
  /** UI theme that suits the backdrop. */
  theme: 'light' | 'dark';
  background: string;
  key: { color: number; intensity: number; position: [number, number, number] };
  fill: { color: number; intensity: number };
  rim: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  environment: number;
  shadowOpacity: number;
  exposure: number;
}

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingPreset> = {
  studio: {
    label: 'Studio',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 35%, #fbfaf7 0%, #e7e4dd 55%, #cfcbc2 100%)',
    key: { color: 0xffffff, intensity: 2.6, position: [160, 300, 260] },
    fill: { color: 0xe8eeff, intensity: 0.7 },
    rim: { color: 0xffffff, intensity: 1.7 },
    hemi: { sky: 0xffffff, ground: 0xbdb7aa, intensity: 0.55 },
    environment: 0.85,
    shadowOpacity: 0.26,
    exposure: 1.0,
  },
  dark: {
    label: 'Dark studio',
    theme: 'dark',
    background: 'radial-gradient(ellipse at 50% 35%, #30333b 0%, #16171b 55%, #08090b 100%)',
    key: { color: 0xfff4e8, intensity: 2.4, position: [140, 260, 220] },
    fill: { color: 0x6f86c9, intensity: 0.25 },
    rim: { color: 0x9fc4ff, intensity: 3.2 },
    hemi: { sky: 0x404660, ground: 0x050506, intensity: 0.25 },
    environment: 0.32,
    shadowOpacity: 0.6,
    exposure: 1.05,
  },
  warm: {
    label: 'Warm showcase',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 35%, #fbf1e4 0%, #ead2b5 55%, #cda886 100%)',
    key: { color: 0xffd9ac, intensity: 2.8, position: [220, 220, 200] },
    fill: { color: 0xa9c4ff, intensity: 0.5 },
    rim: { color: 0xffe2c2, intensity: 1.3 },
    hemi: { sky: 0xfff0dc, ground: 0xb48a62, intensity: 0.5 },
    environment: 0.7,
    shadowOpacity: 0.32,
    exposure: 1.0,
  },
  gallery: {
    label: 'Gallery spot',
    theme: 'light',
    background: 'radial-gradient(ellipse at 50% 30%, #f1f4f8 0%, #d6dce4 55%, #aeb6c2 100%)',
    key: { color: 0xffffff, intensity: 3.4, position: [20, 420, 140] },
    fill: { color: 0xffffff, intensity: 0.35 },
    rim: { color: 0xdfe8ff, intensity: 2.2 },
    hemi: { sky: 0xffffff, ground: 0x9aa3b0, intensity: 0.4 },
    environment: 0.6,
    shadowOpacity: 0.4,
    exposure: 1.0,
  },
};

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
