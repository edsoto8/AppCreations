import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Horse, COATS } from './horse.js';
import { buildWorld, updateClouds, FENCE_RADIUS } from './world.js';

const NAMES = ['Spirit', 'Maple', 'Duchess', 'Comet', 'Biscuit', 'Shadow', 'Juniper', 'Rosie',
  'Thunder', 'Willow', 'Pepper', 'Ranger', 'Clover', 'Dusty', 'Hazel', 'Blaze'];
const MAX_HORSES = 16;

// ---- renderer, scene, camera ----
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(14, 9, 22);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 3;
controls.maxDistance = 90;

const world = buildWorld(scene);

// ---- the herd ----
const chips = document.getElementById('chips');
const card = document.getElementById('card');
let followed = null;

const herd = { mode: 'roam', horses: [], fenceRadius: FENCE_RADIUS, roamRadius: FENCE_RADIUS - 6 };

function addHorse({ coat, size = 1 } = {}) {
  if (herd.horses.length >= MAX_HORSES) return null;
  const i = herd.horses.length;
  const horse = new Horse({
    name: NAMES[i % NAMES.length],
    coat: coat ?? COATS[Math.floor(Math.random() * COATS.length)],
    size,
  });
  const a = Math.random() * Math.PI * 2;
  const d = 3 + Math.random() * 15;
  horse.position.set(Math.sin(a) * d, 0, Math.cos(a) * d);
  horse.lane = 13 + (i % 4) * 2.6;
  scene.add(horse.root);
  herd.horses.push(horse);
  renderChips();
  return horse;
}

COATS.forEach((coat) => addHorse({ coat }));
addHorse({ coat: COATS[1], size: 0.62 }).name = 'Pip (foal)';
renderChips();

// ---- dust kicked up at speed ----
const dustTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const dust = Array.from({ length: 160 }, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTexture, color: '#c9b48a', transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false;
  s.userData.life = 0;
  scene.add(s);
  return s;
});
let dustCursor = 0;

function updateDust(dt) {
  for (const horse of herd.horses) {
    if (horse.speed < 5) continue;
    horse.dustAcc = (horse.dustAcc ?? 0) + dt * horse.speed * 1.6;
    while (horse.dustAcc > 1) {
      horse.dustAcc -= 1;
      const s = dust[dustCursor];
      dustCursor = (dustCursor + 1) % dust.length;
      const back = -0.6 * horse.size;
      s.position.set(
        horse.position.x + Math.sin(horse.heading) * back + (Math.random() - 0.5) * 0.6,
        0.15,
        horse.position.z + Math.cos(horse.heading) * back + (Math.random() - 0.5) * 0.6,
      );
      s.userData.life = 1;
      s.visible = true;
    }
  }
  for (const s of dust) {
    if (!s.visible) continue;
    s.userData.life -= dt * 0.9;
    if (s.userData.life <= 0) {
      s.visible = false;
      continue;
    }
    const age = 1 - s.userData.life;
    s.scale.setScalar(0.5 + age * 1.8);
    s.position.y += dt * 0.4;
    s.material.opacity = 0.45 * s.userData.life;
  }
}

// ---- UI ----

function renderChips() {
  chips.replaceChildren(
    ...herd.horses.map((h) => {
      const b = document.createElement('button');
      b.className = 'chip' + (h === followed ? ' active' : '');
      b.innerHTML = `<span class="swatch" style="background:${h.coat.body}"></span>${h.name}`;
      b.onclick = () => follow(h === followed ? null : h);
      return b;
    }),
  );
}

function follow(horse) {
  followed = horse;
  card.hidden = !horse;
  renderChips();
}

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    herd.mode = btn.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
  });
});
document.getElementById('add').addEventListener('click', (e) => {
  addHorse();
  e.currentTarget.disabled = herd.horses.length >= MAX_HORSES;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') follow(null);
});

// Click (not drag) on a horse to follow it.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(herd.horses.map((h) => h.root), true)[0];
  let obj = hit?.object;
  while (obj && !obj.userData.horse) obj = obj.parent;
  follow(obj?.userData.horse ?? null);
});

// ---- loop ----
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
const followGoal = new THREE.Vector3();
const delta = new THREE.Vector3();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  for (const horse of herd.horses) horse.update(dt, t, herd);
  updateDust(dt);
  updateClouds(world.clouds, dt);

  if (followed) {
    // Move the orbit target with the horse and drag the camera along by the same amount.
    followGoal.set(followed.position.x, 1.1 * followed.size, followed.position.z);
    delta.copy(followGoal).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4));
    controls.target.add(delta);
    camera.position.add(delta);
    card.querySelector('.name').textContent = followed.name;
    card.querySelector('.coat').textContent = followed.size < 1 ? `${followed.coat.name} foal` : followed.coat.name;
    card.querySelector('.gait').textContent = followed.label;
  }
  controls.update();
  renderer.render(scene, camera);
});

// Handy for tinkering from the browser console.
window.meadow = { scene, camera, controls, herd, follow, addHorse };
