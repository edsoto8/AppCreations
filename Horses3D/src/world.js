// The pasture: sky, lights, rolling ground, grass, fence, trees, hills and clouds.
import * as THREE from 'three';

export const FENCE_RADIUS = 30;

const SKY_TOP = new THREE.Color('#4f8fd6');
const SKY_HORIZON = new THREE.Color('#dcecf5');

// Cheap smooth noise from layered sines (no extra dependency needed).
function hills(x, z) {
  return (
    Math.sin(x * 0.045) * Math.cos(z * 0.05) * 2.2 +
    Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.7) * 0.9 +
    Math.cos((x + z) * 0.021) * 2.5
  );
}

// Flat inside the paddock, rising gently outside it.
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const t = THREE.MathUtils.smoothstep(r, FENCE_RADIUS + 2, FENCE_RADIUS + 40);
  return hills(x, z) * t + t * 1.5;
}

export function buildWorld(scene) {
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON, 70, 320);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
      vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
        void main() { float h = clamp(normalize(vPos).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0); }`,
    }),
  );
  scene.add(sky);

  scene.add(new THREE.HemisphereLight('#cfe6ff', '#5b7a35', 1.1));
  const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
  sun.position.set(35, 55, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  buildGround(scene);
  buildGrass(scene);
  buildFence(scene);
  buildProps(scene);
  buildTrees(scene);
  buildMountains(scene);
  return { clouds: buildClouds(scene) };
}

function buildGround(scene) {
  const geo = new THREE.PlaneGeometry(700, 700, 220, 220);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const a = new THREE.Color('#6f9a3a');
  const b = new THREE.Color('#8fb04a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const n = 0.5 + 0.5 * Math.sin(x * 0.3) * Math.cos(z * 0.27) * Math.sin((x - z) * 0.07);
    c.copy(a).lerp(b, n);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildGrass(scene) {
  const count = 9000;
  const blades = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.07, 0.38, 3).translate(0, 0.19, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    count,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * 90;
    const a = Math.random() * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    e.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    q.setFromEuler(e);
    const s = 0.6 + Math.random() * 0.9;
    m.compose(new THREE.Vector3(x, groundHeight(x, z), z), q, new THREE.Vector3(s, s * (0.7 + Math.random()), s));
    blades.setMatrixAt(i, m);
    blades.setColorAt(i, color.setHSL(0.24 + Math.random() * 0.06, 0.5, 0.3 + Math.random() * 0.15));
  }
  blades.receiveShadow = true;
  scene.add(blades);

  const flowerCount = 700;
  const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.8 }), flowerCount);
  const palette = ['#ffffff', '#fff27a', '#d9a6ff', '#ffb3c7'].map((h) => new THREE.Color(h));
  for (let i = 0; i < flowerCount; i++) {
    const r = Math.sqrt(Math.random()) * 80;
    const a = Math.random() * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    m.makeTranslation(x, groundHeight(x, z) + 0.1, z);
    flowers.setMatrixAt(i, m);
    flowers.setColorAt(i, palette[i % palette.length]);
  }
  scene.add(flowers);
}

function buildFence(scene) {
  const wood = new THREE.MeshStandardMaterial({ color: '#8b6a45', roughness: 0.9 });
  const posts = 56;
  const postGeo = new THREE.BoxGeometry(0.18, 1.5, 0.18);
  const pts = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const p = new THREE.Vector3(Math.sin(a) * FENCE_RADIUS, 0, Math.cos(a) * FENCE_RADIUS);
    pts.push(p);
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(p.x, 0.75, p.z);
    post.rotation.y = a;
    post.castShadow = true;
    scene.add(post);
  }
  for (let i = 0; i < posts; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % posts];
    const len = p0.distanceTo(p1);
    for (const y of [0.65, 1.25]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, len + 0.1), wood);
      rail.position.set((p0.x + p1.x) / 2, y, (p0.z + p1.z) / 2);
      rail.lookAt(p1.x, y, p1.z);
      rail.castShadow = true;
      scene.add(rail);
    }
  }
}

function buildProps(scene) {
  const hay = new THREE.MeshStandardMaterial({ color: '#d8b25a', roughness: 1 });
  for (const [x, z, a] of [[-20, 8, 0.3], [-21.5, 10.2, 1.2], [-19, 11.5, 2.4]]) {
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 20), hay);
    bale.rotation.set(0, a, Math.PI / 2);
    bale.position.set(x, 0.75, z);
    bale.castShadow = bale.receiveShadow = true;
    scene.add(bale);
  }
  const trough = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#8d969c', roughness: 0.4, metalness: 0.6 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.8), metal);
  shell.position.y = 0.3;
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(2.25, 0.02, 0.65),
    new THREE.MeshStandardMaterial({ color: '#4c86b0', roughness: 0.1, metalness: 0.2 }),
  );
  water.position.y = 0.55;
  trough.add(shell, water);
  shell.castShadow = true;
  trough.position.set(16, 0, -18);
  trough.rotation.y = 0.8;
  scene.add(trough);
}

function buildTrees(scene) {
  const bark = new THREE.MeshStandardMaterial({ color: '#6b4a30', roughness: 1 });
  const leaves = ['#3f7a2e', '#4d8c34', '#5f9a3c', '#356b28'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }),
  );
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = FENCE_RADIUS + 8 + Math.random() * 90;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const s = 0.8 + Math.random() * 0.9;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 3, 8), bark);
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    tree.add(trunk);
    const blobs = 2 + Math.floor(Math.random() * 3);
    for (let j = 0; j < blobs; j++) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + Math.random() * 0.8, 0), leaves[(i + j) % leaves.length]);
      leaf.position.set((Math.random() - 0.5) * 1.6, 3.4 + j * 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 1.6);
      leaf.rotation.set(Math.random(), Math.random(), Math.random());
      leaf.castShadow = true;
      tree.add(leaf);
    }
    tree.scale.setScalar(s);
    tree.position.set(x, groundHeight(x, z) - 0.1, z);
    scene.add(tree);
  }
}

function buildMountains(scene) {
  const mats = ['#7d93a8', '#8aa0b3', '#6f8699'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }),
  );
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const r = 230 + Math.random() * 60;
    const h = 30 + Math.random() * 45;
    const m = new THREE.Mesh(new THREE.ConeGeometry(30 + Math.random() * 30, h, 6 + Math.floor(Math.random() * 3)), mats[i % 3]);
    m.position.set(Math.sin(a) * r, h / 2 - 4, Math.cos(a) * r);
    m.rotation.y = Math.random() * Math.PI;
    scene.add(m);
  }
}

function buildClouds(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0.95 });
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + Math.random() * 4, 1), mat);
      puff.position.set(j * 5 - puffs * 2.5, Math.random() * 2, (Math.random() - 0.5) * 6);
      puff.scale.y = 0.6;
      cloud.add(puff);
    }
    cloud.position.set((Math.random() - 0.5) * 400, 70 + Math.random() * 30, (Math.random() - 0.5) * 400);
    scene.add(cloud);
    clouds.push(cloud);
  }
  return clouds;
}

export function updateClouds(clouds, dt) {
  for (const c of clouds) {
    c.position.x += dt * 2;
    if (c.position.x > 220) c.position.x = -220;
  }
}
