/**
 * Dev-only scratch harness: lobby + ATM + MechanismAnimator, no app shell.
 * URL params:
 *   cam=front|three|rear|side|left|top|screen|keypad|upper|dispenser|safe|card|cash|x,y,z,tx,ty,tz
 *   doors=0..1 (both) | service=0..1 | vault=0..1   explode=0..1   xray=1   lobby=0   arrows=dispense,reject,...
 *   seq=dispense|reject|jam|retract|deposit|card|receipt|purge   at=<sim ms to fast-forward to, then freeze>
 *   alert=<componentId>   w,h = viewport
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildAtm } from '../src/models/buildAtm';
import { buildLobby } from '../src/scene/environment';
import { MechanismAnimator } from '../src/animations/MechanismAnimator';
import { FlowArrows, type FlowRoute } from '../src/animations/FlowArrows';
import { AnimClock } from '../src/animations/AnimClock';
import type { CassetteId, ComponentId, Note, Denomination } from '../src/core/types';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(num('w', window.innerWidth), num('h', window.innerHeight));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exposure', 1.0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202428);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = num('env', 0.55);

const camera = new THREE.PerspectiveCamera(42, renderer.domElement.width / renderer.domElement.height, 0.02, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

if (q.get('lobby') !== '0') {
  const lobby = buildLobby();
  scene.add(lobby.group);
} else {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
}

const model = buildAtm();
scene.add(model.root);
const clock = new AnimClock();
const logSfx = { play: (n: string) => (window as unknown as { sfxLog: string[] }).sfxLog.push(n) };
(window as unknown as { sfxLog: string[] }).sfxLog = [];
const mech = new MechanismAnimator({ model, scene, clock, sfx: logSfx });
const flow = new FlowArrows(model, scene);

// log sim-time duration of every driver call (window.__timing)
const timing: string[] = [];
(window as unknown as { __timing: string[] }).__timing = timing;
for (const k of ['pickNote', 'validateNote', 'divertToReject', 'stackNote', 'jamNote', 'presentBundle', 'bundleCollected', 'retractBundle', 'purge', 'printReceipt', 'depositIntake', 'depositStore', 'depositReturn', 'cardIn', 'cardEject', 'cardRetain'] as const) {
  const orig = (mech[k] as (...a: unknown[]) => Promise<void>).bind(mech);
  (mech as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
    const t0 = clock.now();
    await orig(...a);
    timing.push(`${k} ${t0.toFixed(0)}→${clock.now().toFixed(0)} (${(clock.now() - t0).toFixed(0)}ms)`);
  };
}

// ---------------------------------------------------------------- view options
const doors = num('doors', 0);
model.doors.service.setOpen(num('service', doors));
model.doors.vault.setOpen(num('vault', doors));
const explode = num('explode', 0);
if (explode > 0) {
  for (const [id, off] of model.explodeOffsets) {
    const p = model.parts.get(id)!;
    p.position.addScaledVector(off, explode);
  }
}
if (q.get('xray') === '1') {
  for (const m of model.shellMeshes) {
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.12;
    mat.depthWrite = false;
  }
}
const arrows = q.get('arrows');
if (arrows) for (const r of arrows.split(',')) flow.show(r as FlowRoute, true);
const alert = q.get('alert');
if (alert) mech.setComponentAlert(alert as ComponentId, 'FAULT');

const presets: Record<string, [number, number, number, number, number, number]> = {
  front: [0.3, 1.45, 2.75, 0, 0.98, 0.05],
  three: [1.45, 1.55, 1.75, 0, 0.95, 0],
  rear: [-1.2, 1.5, -1.5, 0, 0.9, 0],
  side: [2.1, 1.25, 0.55, 0, 0.9, 0],
  left: [-1.9, 1.3, 1.0, 0, 0.9, 0],
  top: [0.4, 2.6, 1.0, 0, 1.0, 0],
  card: [0.55, 1.35, 0.95, 0.25, 1.12, 0.35],
  cash: [0.35, 1.05, 0.95, 0.1, 0.9, 0.42],
  wide: [1.8, 1.9, 3.2, 0, 1.0, 0],
};
const camName = q.get('cam') ?? 'front';
if (camName.includes(',')) {
  const v = camName.split(',').map(Number);
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
} else if (presets[camName]) {
  const v = presets[camName];
  camera.position.set(v[0], v[1], v[2]);
  controls.target.set(v[3], v[4], v[5]);
} else {
  const f = model.anchors.focus[camName as keyof typeof model.anchors.focus];
  camera.position.copy(f.position);
  controls.target.copy(f.target);
}
camera.fov = num('fov', 42);
camera.updateProjectionMatrix();
controls.update();

// ---------------------------------------------------------------- sequences
let nid = 1;
const mk = (denom: Denomination, extra: Partial<Note> = {}): Note => ({ id: nid++, denom, serial: `TRN-${denom}-${nid}`, loc: 'cassette:A', ...extra });

async function dispense(picks: Array<[CassetteId, Denomination, number]>, opts: { reject?: number; jam?: number } = {}): Promise<Note[]> {
  const bundle: Note[] = [];
  let k = 0;
  for (const [c, d, n] of picks) {
    for (let i = 0; i < n; i++, k++) {
      const note = mk(d);
      await mech.pickNote(note, c);
      if (opts.jam === k) {
        await mech.jamNote(note);
        return bundle.concat(note);
      }
      const res = opts.reject === k ? 'DOUBLE' : 'OK';
      await mech.validateNote(note, res);
      if (res !== 'OK') {
        await mech.divertToReject(note);
        i--;
        continue;
      }
      await mech.stackNote(note);
      bundle.push(note);
    }
  }
  return bundle;
}

const sequences: Record<string, () => Promise<void>> = {
  async dispense() {
    const b = await dispense([['A', 20, 3], ['B', 50, 2]]);
    await mech.presentBundle(b);
    await clock.wait(1500);
    await mech.bundleCollected(b);
  },
  async reject() {
    const b = await dispense([['A', 20, 3]], { reject: 1 });
    await mech.presentBundle(b);
  },
  async jam() {
    await dispense([['C', 100, 3]], { jam: 2 });
    await clock.wait(800);
    mech.setComponentAlert('transport', 'FAULT');
  },
  async purge() {
    const b = await dispense([['C', 100, 3]], { jam: 2 });
    await clock.wait(500);
    await mech.purge(b, 'reject');
  },
  async retract() {
    const b = await dispense([['A', 20, 2]]);
    await mech.presentBundle(b);
    await clock.wait(800);
    await mech.retractBundle(b);
  },
  async deposit() {
    const ns = [mk(20), mk(50), mk(20, { suspect: true }), mk(100)];
    await mech.depositIntake(ns);
    await clock.wait(600);
    await mech.depositStore(ns);
  },
  async depositReturn() {
    const ns = [mk(20), mk(50)];
    await mech.depositIntake(ns);
    await clock.wait(400);
    await mech.depositReturn(ns);
  },
  async card() {
    await mech.cardIn('chip');
    await clock.wait(600);
    await mech.cardEject();
  },
  async retain() {
    await mech.cardIn('chip');
    await clock.wait(300);
    await mech.cardEject();
    await clock.wait(500);
    await mech.cardRetain();
  },
  async contactless() {
    await mech.cardIn('contactless');
  },
  async receipt() {
    await mech.printReceipt(['DATE 2026-11-12  10:42', 'ATM  MTB-T200 LOBBY', 'CARD 9990 **** **** 1234', 'WITHDRAWAL     $160.00', 'FROM  CHK-1001', 'AUTH 004211  STAN 000123', 'AVAILABLE    $2,290.75']);
  },
};

const hud = document.getElementById('hud')!;
const status = document.createElement('div');
hud.appendChild(status);
for (const name of Object.keys(sequences)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => {
    mech.reset();
    void sequences[name]();
  };
  hud.appendChild(b);
}
if (q.get('hud') === '0') hud.style.display = 'none';

// ---------------------------------------------------------------- loop
let last = performance.now();
let frozen = false;
let rendered = 0;
function frame(now: number): void {
  if ((window as unknown as { __stop?: boolean }).__stop) return;
  const dt = Math.min(100, now - last);
  last = now;
  if (!frozen) {
    clock.update(dt);
    model.update(dt / 1000);
    mech.update(dt / 1000);
    flow.update(dt / 1000);
  }
  controls.update();
  renderer.render(scene, camera);
  rendered++;
  (window as unknown as { __frames: number }).__frames = rendered;
  const info = renderer.info.render;
  status.textContent = `sim ${clock.now().toFixed(0)} ms · calls ${info.calls} · tris ${info.triangles}`;
  (window as unknown as { __stats: unknown }).__stats = { calls: info.calls, triangles: info.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  requestAnimationFrame(frame);
}

async function start(): Promise<void> {
  const seq = q.get('seq');
  const at = num('at', -1);
  if (seq && sequences[seq]) {
    void sequences[seq]();
    if (at >= 0) {
      frozen = true;
      while (clock.now() < at) {
        clock.advance(8);
        model.update(0.008);
        mech.update(0.008);
        flow.update(0.008);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } else if (at >= 0) {
    frozen = true;
  }
  if (frozen) {
    // let LEDs etc settle without advancing sim time
    model.update(0.016);
    mech.update(0.016);
    flow.update(0.3);
  }
  requestAnimationFrame(frame);
  setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), 600);
}
void start();
(window as unknown as { dbg: unknown }).dbg = { model, mech, clock, scene, camera, controls, THREE };
