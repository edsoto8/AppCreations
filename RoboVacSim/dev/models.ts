/**
 * Standalone dev preview for the procedural robot + dock models (served by Vite at /dev/models.html).
 *
 * Keys: 1 robot view, 2 dock view, E explode, X x-ray, P dock panels, C cutaway, D next dock phase,
 * L next LED mode, H next highlight, M mop lift, O dust-bin lid, B bumper hit, U underside, Q quality,
 * G toggle HUD. Window hooks (for automated screenshots): __setView, __setDockPhase, __setLed,
 * __highlight, __setQuality, __info, __ready.
 */
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createDockModel } from '../src/render/models/dock/index';
import { createRobotModel } from '../src/render/models/robot/index';
import type { ModelQuality } from '../src/render/models/shared/quality';
import type {
  DockAnimState,
  DockModel,
  DockPhase,
  LedMode,
  RobotAnimState,
  RobotModel,
} from '../src/render/models/types';

type ViewName =
  | 'robot-close'
  | 'robot-top'
  | 'robot-exploded'
  | 'robot-xray'
  | 'robot-underside'
  | 'robot-bin'
  | 'dock'
  | 'dock-panels'
  | 'dock-cutaway'
  | 'dock-front';

interface DevInfo {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  robotMeshes: number;
  dockMeshes: number;
  robotParts: number;
  dockParts: number;
  view: ViewName;
  quality: ModelQuality;
}

declare global {
  interface Window {
    __ready?: boolean;
    __setView?: (v: ViewName) => void;
    __setDockPhase?: (p: DockPhase) => void;
    __setLed?: (m: LedMode) => void;
    __highlight?: (id: string | null) => void;
    __setQuality?: (q: ModelQuality) => void;
    __info?: () => DevInfo;
    /** Renders one frame without the shadow pass and returns its draw calls. */
    __mainPassCalls?: () => number;
  }
}

const PHASES: DockPhase[] = ['idle', 'charging', 'dustExtraction', 'mopWash', 'waterTransfer', 'drying', 'ready'];
const LEDS: LedMode[] = ['idle', 'mapping', 'cleaning', 'returning', 'charging', 'maintenance', 'manual', 'paused', 'recovering', 'error', 'off'];
const QUALITIES: ModelQuality[] = ['low', 'medium', 'high', 'ultra'];

const params = new URLSearchParams(location.search);
let quality: ModelQuality = (QUALITIES as string[]).includes(params.get('q') ?? '') ? (params.get('q') as ModelQuality) : 'high';

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x1b1f25);
const pmrem = new PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.65;

const camera = new PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.01, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemi = new HemisphereLight(0xdfe8ff, 0x2a2622, 0.35);
scene.add(hemi);
const key = new DirectionalLight(0xfff4e6, 2.6);
key.position.set(1.6, 2.6, 1.3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1;
key.shadow.camera.right = 1;
key.shadow.camera.top = 1;
key.shadow.camera.bottom = -1;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 6;
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.004;
key.shadow.radius = 4;
scene.add(key);
const rim = new DirectionalLight(0xcfe0ff, 1.1);
rim.position.set(-1.8, 1.2, -1.6);
scene.add(rim);

const groundMat = new MeshStandardMaterial({ color: 0x4d5258, roughness: 0.82, metalness: 0 });
const ground = new Mesh(new CircleGeometry(6, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let robot: RobotModel;
let dock: DockModel;
let robotMeshes = 0;
let dockMeshes = 0;

const robotState: RobotAnimState = {
  leftWheelAngle: 0, rightWheelAngle: 0, casterYaw: 0, mainBrushAngle: 0, sideBrushAngle: 0, lidarAngle: 0,
  mopAngle: 0, mopLowered: 1, bumperCompression: 0, bumperHitAngle: 0, ledMode: 'cleaning', battery: 0.64,
  dustbinOpen: 0, dustbinFill: 0.55, waterLevel: 0.7, suspensionLift: 0, suction: 1,
};
const dockState: DockAnimState = {
  phase: 'charging', phaseProgress: 0, robotDocked: true, cleanWater: 0.78, dirtyWater: 0.32, dustBag: 0.45,
  robotBattery: 0.64, statusText: 'CHARGING 64%',
};

const flags = { explode: 0, explodeTarget: 0, xray: false, panels: 0, panelsTarget: 0, cutaway: false, underside: false, spinning: true };
let view: ViewName = 'robot-close';
let highlightIdx = -1;
let bumpTime = -10;

function countMeshes(root: { traverse: (fn: (o: { type: string }) => void) => void }): number {
  let n = 0;
  root.traverse((o) => {
    if (o.type === 'Mesh' || o.type === 'InstancedMesh' || o.type === 'Points') n++;
  });
  return n;
}

function build(): void {
  if (robot) {
    scene.remove(robot.root);
    robot.dispose();
  }
  if (dock) {
    scene.remove(dock.root);
    dock.dispose();
  }
  robot = createRobotModel({ quality });
  dock = createDockModel({ quality });
  robotMeshes = countMeshes(robot.root);
  dockMeshes = countMeshes(dock.root);
  scene.add(robot.root, dock.root);
  robot.setXray(flags.xray);
  robot.setExplode(flags.explode);
  dock.setPanelsOpen(flags.panels);
  dock.setCutaway(flags.cutaway);
  applyView(view);
}

function setCamera(pos: [number, number, number], target: [number, number, number]): void {
  camera.position.set(...pos);
  controls.target.set(...target);
  controls.update();
}

function applyView(v: ViewName): void {
  view = v;
  const isDock = v.startsWith('dock');
  dock.root.visible = isDock;
  flags.underside = v === 'robot-underside';
  robot.root.rotation.set(flags.underside ? Math.PI : 0, 0, 0);
  robot.root.position.set(0, flags.underside ? 0.1004 : 0, 0);
  flags.xray = v === 'robot-xray';
  robot.setXray(flags.xray);
  flags.explode = flags.explodeTarget = v === 'robot-exploded' ? 1 : 0;
  robot.setExplode(flags.explode);
  flags.panels = flags.panelsTarget = v === 'dock-panels' ? 1 : 0;
  dock.setPanelsOpen(flags.panels);
  flags.cutaway = v === 'dock-cutaway';
  dock.setCutaway(flags.cutaway);
  robotState.dustbinOpen = v === 'robot-bin' ? 1 : 0;
  robotState.mopLowered = isDock ? 0 : 1;
  robotState.suction = isDock ? 0 : 1;
  robotState.ledMode = isDock ? 'charging' : v === 'robot-top' ? 'mapping' : 'cleaning';
  if (v === 'dock-cutaway') setDockPhase('dustExtraction');
  else if (v === 'dock-panels') setDockPhase('mopWash');
  else if (isDock) setDockPhase('charging');
  switch (v) {
    case 'robot-close': setCamera([0.46, 0.2, 0.36], [0.02, 0.045, 0]); break;
    case 'robot-top': setCamera([-0.3, 0.62, 0.34], [0, 0.03, 0]); break;
    case 'robot-exploded': setCamera([0.8, 0.78, 0.74], [0, 0.17, 0]); break;
    case 'robot-xray': setCamera([0.38, 0.46, 0.4], [0, 0.04, 0]); break;
    case 'robot-underside': setCamera([0.3, 0.48, 0.34], [0, 0.07, 0]); break;
    case 'robot-bin': setCamera([-0.45, 0.42, 0.25], [-0.05, 0.05, 0]); break;
    case 'dock': setCamera([-0.95, 0.62, 0.85], [0.12, 0.17, 0]); break;
    case 'dock-front': setCamera([-0.9, 0.34, 0.0], [0.15, 0.22, 0]); break;
    case 'dock-panels': setCamera([-0.55, 0.62, 1.05], [0.25, 0.2, 0]); break;
    case 'dock-cutaway': setCamera([0.05, 0.42, 1.05], [0.3, 0.22, 0]); break;
  }
}

function setDockPhase(p: DockPhase): void {
  dockState.phase = p;
  const pct = Math.round(dockState.robotBattery * 100);
  const text: Record<DockPhase, string> = {
    idle: 'STANDBY', charging: `CHARGING ${pct}%`, dustExtraction: 'EMPTYING BIN', mopWash: 'WASHING MOPS',
    waterTransfer: 'REFILLING', drying: 'DRYING MOPS', ready: 'READY',
  };
  dockState.statusText = text[p];
  robotState.ledMode = p === 'charging' ? 'charging' : p === 'ready' ? 'idle' : 'maintenance';
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1') applyView('robot-close');
  else if (k === '2') applyView('dock');
  else if (k === 'e') flags.explodeTarget = flags.explodeTarget > 0.5 ? 0 : 1;
  else if (k === 'x') robot.setXray((flags.xray = !flags.xray));
  else if (k === 'p') flags.panelsTarget = flags.panelsTarget > 0.5 ? 0 : 1;
  else if (k === 'c') dock.setCutaway((flags.cutaway = !flags.cutaway));
  else if (k === 'd') setDockPhase(PHASES[(PHASES.indexOf(dockState.phase) + 1) % PHASES.length]);
  else if (k === 'l') robotState.ledMode = LEDS[(LEDS.indexOf(robotState.ledMode) + 1) % LEDS.length];
  else if (k === 'h') {
    const all = [...robot.parts, ...dock.parts];
    highlightIdx = highlightIdx + 1 >= all.length ? -1 : highlightIdx + 1;
    const id = highlightIdx >= 0 ? all[highlightIdx].id : null;
    robot.highlight(id);
    dock.highlight(id);
  } else if (k === 'm') robotState.mopLowered = robotState.mopLowered > 0.5 ? 0 : 1;
  else if (k === 'o') robotState.dustbinOpen = robotState.dustbinOpen > 0.5 ? 0 : 1;
  else if (k === 'b') bumpTime = elapsed;
  else if (k === 'u') applyView(view === 'robot-underside' ? 'robot-close' : 'robot-underside');
  else if (k === 'q') {
    quality = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length];
    build();
  } else if (k === 'g') hud.classList.toggle('hidden');
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const hud = document.getElementById('hud') as HTMLDivElement;
const clock = new Timer();
clock.connect(document);
let elapsed = 0;
let lastCalls = 0;
let lastTris = 0;
const tmp = new Vector3();

function frame(timestamp: number): void {
  clock.update(timestamp);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  const t = elapsed;
  if (flags.spinning) {
    robotState.lidarAngle += dt * Math.PI * 2 * 1.2;
    robotState.sideBrushAngle += dt * 9;
    robotState.mainBrushAngle += dt * 14;
    robotState.mopAngle += dt * 5;
    robotState.leftWheelAngle += dt * 1.5;
    robotState.rightWheelAngle += dt * 1.5;
  }
  const bump = t - bumpTime;
  robotState.bumperCompression = bump < 0.5 ? Math.sin((bump / 0.5) * Math.PI) : 0;
  robotState.bumperHitAngle = 0.4;
  robotState.casterYaw = Math.sin(t * 0.4) * 0.3;
  flags.explode += (flags.explodeTarget - flags.explode) * Math.min(1, dt * 3);
  flags.panels += (flags.panelsTarget - flags.panels) * Math.min(1, dt * 3);
  robot.setExplode(flags.explode);
  dock.setPanelsOpen(flags.panels);
  dockState.phaseProgress = (t * 0.1) % 1;
  dockState.robotDocked = view.startsWith('dock');
  robot.update(robotState, t, dt);
  dock.update(dockState, t, dt);
  controls.update();
  renderer.render(scene, camera);
  lastCalls = renderer.info.render.calls;
  lastTris = renderer.info.render.triangles;
  tmp.copy(camera.position);
  hud.textContent =
    `view ${view}  quality ${quality}\n` +
    `draw calls ${lastCalls}  tris ${lastTris}\n` +
    `robot meshes ${robotMeshes}  dock meshes ${dockMeshes}\n` +
    `LED ${robotState.ledMode}  dock ${dockState.phase}\n` +
    `1/2 views  E explode  X xray  P panels  C cutaway\nD phase  L led  H highlight  M mop  O lid  B bump  U under  Q quality`;
  requestAnimationFrame(frame);
}

window.__setView = (v) => applyView(v);
window.__setDockPhase = (p) => setDockPhase(p);
window.__setLed = (m) => {
  robotState.ledMode = m;
};
window.__highlight = (id) => {
  robot.highlight(id);
  dock.highlight(id);
};
window.__setQuality = (q) => {
  quality = q;
  build();
};
window.__info = () => ({
  calls: lastCalls,
  triangles: lastTris,
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
  robotMeshes,
  dockMeshes,
  robotParts: robot.parts.length,
  dockParts: dock.parts.length,
  view,
  quality,
});

window.__mainPassCalls = () => {
  key.castShadow = false;
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  key.castShadow = true;
  return calls;
};

build();
applyView((params.get('view') as ViewName | null) ?? 'robot-close');
requestAnimationFrame(frame);
window.__ready = true;
