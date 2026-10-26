/**
 * Studio presentation: gradient backdrop, soft ground that fades into fog, three-point lighting
 * with a shadow-casting key, an image-based environment for reflections, and contact shadows.
 */
import {
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ContactShadows } from './ContactShadows';
import { Forest } from './Forest';
import { LIGHTING_PRESETS, type LightingPreset } from './LightingPresets';

const GROUND_SIZE = 160;
const GROUND_REPEAT = 64;
/** Point the lights aim at (roughly the fox's centre of mass). */
const FOCUS = new Vector3(0, 0.28, -0.12);

export class Studio {
  readonly group = new Group();
  readonly key = new DirectionalLight();
  readonly rim = new DirectionalLight();
  readonly fill = new DirectionalLight();
  readonly hemi = new HemisphereLight();
  readonly contact = new ContactShadows();
  readonly forest: Forest;
  preset: LightingPreset = LIGHTING_PRESETS[0];

  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly studioTex: CanvasTexture;
  private readonly forestTex: CanvasTexture;
  private readonly envMap: Texture;
  private readonly fog = new Fog(0x000000, 3, 11);
  private forestOn = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
  ) {
    this.group.name = 'Studio';

    this.dome = new Mesh(
      new SphereGeometry(90, 48, 24),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new Color() },
          horizon: { value: new Color() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w; // keep at the far plane
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon;
          varying vec3 vDir;
          void main() {
            float y = vDir.y;
            vec3 c = y > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, y), 0.7))
                             : horizon;
            // Soft glow behind the subject and gentle dithering against banding.
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            gl_FragColor = vec4(c + (n - 0.5) / 255.0, 1.0);
            // No tone mapping: three.js applies fog after tone mapping, so skipping it here keeps
            // the horizon identical to the fog colour and the ground melts into the backdrop.
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.studioTex = makeGroundTexture('studio');
    this.forestTex = makeGroundTexture('forest');
    this.ground = new Mesh(
      new PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ map: this.studioTex, roughness: 0.96, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.ground.name = 'Ground';
    this.group.add(this.ground);
    this.group.add(this.contact.group);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const cam = this.key.shadow.camera;
    cam.left = -0.85;
    cam.right = 0.85;
    cam.top = 0.85;
    cam.bottom = -0.85;
    cam.near = 0.5;
    cam.far = 6;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.008;
    this.key.target.position.copy(FOCUS);
    this.rim.target.position.copy(FOCUS);
    this.fill.target.position.copy(FOCUS);
    this.group.add(this.key, this.key.target, this.rim, this.rim.target, this.fill, this.fill.target, this.hemi);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    scene.environment = this.envMap;
    scene.fog = this.fog;

    this.forest = new Forest();
    this.forest.group.visible = false;
    this.group.add(this.forest.group);

    scene.add(this.group);
    this.applyPreset(LIGHTING_PRESETS[0]);
  }

  applyPreset(p: LightingPreset): void {
    this.preset = p;
    const u = this.dome.material.uniforms;
    const forestTint = this.forestOn ? 0.55 : 0;
    const tint = new Color(0x2f4a3a);
    (u.top.value as Color).setHex(p.sky.top).lerp(tint, forestTint * 0.4);
    (u.horizon.value as Color).setHex(p.sky.horizon).lerp(tint, forestTint);
    this.fog.color.copy(u.horizon.value as Color);
    this.fog.near = this.forestOn ? p.fog.near * 1.2 : p.fog.near;
    this.fog.far = this.forestOn ? p.fog.far * 1.25 : p.fog.far;

    const groundColor = new Color(p.ground);
    if (this.forestOn) groundColor.lerp(new Color(0x5e5646), 0.75);
    this.ground.material.color.copy(groundColor);
    this.ground.material.map = this.forestOn ? this.forestTex : this.studioTex;
    this.ground.material.needsUpdate = true;

    this.hemi.color.setHex(p.hemi.sky);
    this.hemi.groundColor.setHex(p.hemi.ground);
    this.hemi.intensity = p.hemi.intensity;
    setDirectional(this.key, p.key.color, p.key.intensity, p.key.dir, 3.5);
    this.key.shadow.radius = p.key.shadowRadius;
    setDirectional(this.rim, p.rim.color, p.rim.intensity, p.rim.dir, 3);
    setDirectional(this.fill, p.fill.color, p.fill.intensity, p.fill.dir, 3);

    this.scene.environmentIntensity = p.envIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.contact.opacity = p.contactOpacity;
    this.forest.setTint(new Color(p.hemi.sky), p.hemi.intensity);
  }

  setForest(on: boolean): void {
    this.forestOn = on;
    this.forest.group.visible = on;
    this.applyPreset(this.preset);
  }

  /** Scrolls the ground (and forest) by the distance the fox travelled this frame. */
  update(travel: number): void {
    if (travel === 0) return;
    const map = this.ground.material.map;
    if (map) map.offset.y -= (travel * GROUND_REPEAT) / GROUND_SIZE;
    this.forest.scroll(travel);
  }

  beforeRender(): void {
    this.contact.render(this.renderer, this.scene);
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.studioTex.dispose();
    this.forestTex.dispose();
    this.envMap.dispose();
    this.contact.dispose();
    this.forest.dispose();
    this.key.shadow.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
    this.group.removeFromParent();
  }
}

function setDirectional(l: DirectionalLight, color: number, intensity: number, dir: [number, number, number], dist: number): void {
  l.color.setHex(color);
  l.intensity = intensity;
  l.position.set(...dir).normalize().multiplyScalar(dist).add(FOCUS);
}

/** Tileable procedural ground texture: soft concrete for the studio, leaf litter for the forest. */
function makeGroundTexture(kind: 'studio' | 'forest'): CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  // Periodic value noise so the texture tiles seamlessly.
  const grid = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return (x: number, y: number) => {
      const fx = (x / S) * period, fy = (y / S) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => g[((j % period) + period) % period * period + (((i % period) + period) % period)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const n1 = grid(8, 11), n2 = grid(32, 23), n3 = grid(128, 37);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n1(x, y) * 0.5 + n2(x, y) * 0.3 + n3(x, y) * 0.2;
      const o = (y * S + x) * 4;
      const base = kind === 'studio' ? 0.82 + v * 0.22 : 0.55 + v * 0.5;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, base * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (kind === 'forest') {
    // Scatter fallen leaves and twigs (drawn with wrap-around so the tile stays seamless).
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const leafColors = ['#7a4a2a', '#6b4a2a', '#8a6a3a', '#5a3f22', '#6e5a36', '#4f3a24', '#8d5a34'];
    for (let i = 0; i < 1600; i++) {
      const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 4, a = rnd() * Math.PI;
      ctx.fillStyle = leafColors[Math.floor(rnd() * leafColors.length)];
      ctx.globalAlpha = 0.35 + rnd() * 0.35;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.45, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#3e2a18';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S, l = 10 + rnd() * 30, a = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(GROUND_REPEAT, GROUND_REPEAT);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
