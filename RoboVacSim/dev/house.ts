/**
 * Standalone dev preview of the house renderer (served by Vite at /dev/house.html).
 *
 * Keys: 1/2/3 preset (apartment/family/challenge), W cycle wall mode, Q cycle quality, T top view,
 * I isometric view, J jiggle (move/rotate some items, change a floor), H highlight next item, G HUD.
 * Window hook `__house` (for automated screenshots): setPreset, setWallMode, setQuality, view,
 * setCamera, renderNow (returns draw calls), pause, capture, info, jiggle, highlight, ready.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HouseView, type HouseQuality, type WallMode } from '../src/render/house/HouseView';
import { DOCK } from '../src/sim/robot/robotSpec';
import { getPreset } from '../src/sim/world/presets';
import type { HouseLayout } from '../src/sim/world/types';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a1e24');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const hemi = new THREE.HemisphereLight('#e6eefc', '#5c5246', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun, sun.target);

const persp = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
let camera: THREE.Camera = persp;
const controls = new OrbitControls(persp, renderer.domElement);
controls.enableDamping = true;

const house = new HouseView({ quality: 'high' });
scene.add(house.root);

// Dock marker (simple stand-in for the real dock model) to check placement.
const dockMarker = new THREE.Group();
{
  const len = DOCK.towerBackX - DOCK.towerFrontX;
  const tower = new THREE.Mesh(new THREE.BoxGeometry(len, DOCK.towerHeight, DOCK.width), new THREE.MeshStandardMaterial({ color: '#30353c', roughness: 0.4 }));
  tower.position.set(DOCK.towerFrontX + len / 2, DOCK.towerHeight / 2, 0);
  tower.castShadow = true;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(DOCK.towerFrontX - DOCK.baseFrontX, DOCK.baseHeight, DOCK.width), new THREE.MeshStandardMaterial({ color: '#40464f' }));
  plate.position.set((DOCK.towerFrontX + DOCK.baseFrontX) / 2, DOCK.baseHeight / 2, 0);
  const robot = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.09, 40), new THREE.MeshStandardMaterial({ color: '#f2f3f5', roughness: 0.3 }));
  robot.position.set(0, DOCK.baseHeight + 0.045, 0);
  robot.castShadow = true;
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 20), new THREE.MeshStandardMaterial({ color: '#46e0c8', emissive: '#46e0c8', emissiveIntensity: 1 }));
  led.position.set(0.035, DOCK.baseHeight + 0.1, 0);
  dockMarker.add(tower, plate, robot, led);
}
scene.add(dockMarker);

let layout: HouseLayout = getPreset('apartment');
let presetId = 'apartment';
let mode: WallMode = 'full';
let quality: HouseQuality = 'high';
let highlightIdx = -1;

function fitShadow(): void {
  const b = layout.bounds;
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  sun.position.set(cx - 6, 14, cz + 8);
  sun.target.position.set(cx, 0, cz);
  const r = Math.hypot(b.w, b.h) / 2 + 1;
  const cam = sun.shadow.camera;
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  cam.near = 1;
  cam.far = 40;
  cam.updateProjectionMatrix();
}

function applyLayout(): void {
  house.sync(layout);
  const d = layout.dock;
  dockMarker.position.set(d.x, 0, d.y);
  dockMarker.rotation.y = -d.theta;
  fitShadow();
}

function setPreset(id: string): void {
  presetId = id;
  layout = getPreset(id);
  highlightIdx = -1;
  house.setHighlight(null);
  applyLayout();
  view('iso');
}

function view(name: 'top' | 'iso' | 'front'): void {
  const b = layout.bounds;
  const cx = b.x + b.w / 2;
  const cz = b.y + b.h / 2;
  if (name === 'top') {
    const aspect = window.innerWidth / window.innerHeight;
    const half = Math.max(b.h / 2, b.w / 2 / aspect) * 1.06;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.position.set(cx, 30, cz);
    ortho.up.set(0, 0, -1);
    ortho.lookAt(cx, 0, cz);
    ortho.updateProjectionMatrix();
    camera = ortho;
    return;
  }
  camera = persp;
  const r = Math.max(b.w, b.h);
  if (name === 'iso') persp.position.set(cx + r * 0.55, r * 0.85, cz + r * 0.75);
  else persp.position.set(cx, r * 0.45, cz + r * 0.95);
  controls.target.set(cx, 0, cz);
  persp.lookAt(controls.target);
  controls.update();
}

function setCamera(pos: [number, number, number], target: [number, number, number], fov = 45): void {
  camera = persp;
  persp.fov = fov;
  persp.updateProjectionMatrix();
  persp.position.set(...pos);
  controls.target.set(...target);
  persp.lookAt(controls.target);
  controls.update();
}

/** Simulates editor edits: move/rotate items, toggle a room floor and a rug color. */
function jiggle(step = 1): void {
  const f = layout.furniture;
  for (let i = 0; i < f.length; i += 5) {
    f[i].x += 0.01 * step;
    f[i].rotation += 0.002 * step;
  }
  const room = layout.rooms[step % layout.rooms.length];
  room.floor = room.floor === 'carpet' ? 'hardwood' : room.floor === 'hardwood' ? 'tile' : 'carpet';
  if (layout.rugs[0]) layout.rugs[0].color = step % 2 ? '#7d5a4f' : '#4f6475';
  if (f[1]) f[1].color = step % 2 ? '#aa3333' : '#3355aa';
  house.sync(layout);
}

function renderNow(): number {
  renderer.render(scene, camera);
  return renderer.info.render.calls;
}

const hud = document.getElementById('hud')!;
function updateHud(): void {
  const s = house.stats();
  hud.textContent = `${layout.name}  [1/2/3]\nwalls: ${mode} [W]   quality: ${quality} [Q]\nT top  I iso  J jiggle  H highlight  G hud\ncalls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}\nitems ${s.items} models ${s.models} materials ${s.materials}\ngeometries ${renderer.info.memory.geometries} textures ${renderer.info.memory.textures}`;
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1') setPreset('apartment');
  if (k === '2') setPreset('family');
  if (k === '3') setPreset('challenge');
  if (k === 'w') {
    const modes: WallMode[] = ['full', 'cutaway', 'hidden'];
    mode = modes[(modes.indexOf(mode) + 1) % 3];
    house.setWallMode(mode);
  }
  if (k === 'q') {
    const qs: HouseQuality[] = ['low', 'medium', 'high', 'ultra'];
    quality = qs[(qs.indexOf(quality) + 1) % 4];
    house.setQuality(quality);
  }
  if (k === 't') view('top');
  if (k === 'i') view('iso');
  if (k === 'j') jiggle();
  if (k === 'h') {
    const ids = [...layout.furniture, ...layout.obstacles].map((x) => x.id);
    highlightIdx = (highlightIdx + 1) % ids.length;
    house.setHighlight(ids[highlightIdx]);
  }
  if (k === 'g') hud.classList.toggle('hidden');
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  persp.aspect = window.innerWidth / window.innerHeight;
  persp.updateProjectionMatrix();
});

declare global {
  interface Window {
    __house: {
      setPreset(id: string): void;
      setWallMode(m: WallMode): void;
      setQuality(q: HouseQuality): void;
      view(name: 'top' | 'iso' | 'front'): void;
      setCamera(pos: [number, number, number], target: [number, number, number], fov?: number): void;
      renderNow(): number;
      jiggle(step?: number): void;
      highlight(id: string | null): void;
      hud(show: boolean): void;
      /** Stop the animation loop (automation renders explicitly with renderNow). */
      pause(paused: boolean): void;
      /** Toggle sun shadows (to split main-pass vs shadow-pass draw calls). */
      shadows(on: boolean): void;
      /** PNG data URL of the last rendered frame. */
      capture(): string;
      info(): { calls: number; triangles: number; geometries: number; textures: number; items: number; models: number; materials: number; preset: string };
      ready: boolean;
    };
  }
}

window.__house = {
  setPreset,
  setWallMode(m) {
    mode = m;
    house.setWallMode(m);
  },
  setQuality(q) {
    quality = q;
    house.setQuality(q);
  },
  view,
  setCamera,
  renderNow,
  jiggle,
  highlight: (id) => house.setHighlight(id),
  hud: (show) => hud.classList.toggle('hidden', !show),
  pause: (p) => {
    paused = p;
  },
  shadows: (on) => {
    sun.castShadow = on;
  },
  capture: () => renderer.domElement.toDataURL('image/png'),
  info: () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    ...house.stats(),
    preset: presetId,
  }),
  ready: false,
};

setPreset(new URLSearchParams(location.search).get('preset') ?? 'apartment');

let paused = false;
function loop(): void {
  requestAnimationFrame(loop);
  if (paused) return;
  controls.update();
  renderer.render(scene, camera);
  updateHud();
}
loop();
window.__house.ready = true;
