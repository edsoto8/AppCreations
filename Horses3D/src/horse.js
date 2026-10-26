// A procedurally built, animated horse made only from three.js primitives.
// Local axes: +Z is forward, +Y is up, the root sits on the ground between the hooves.
import * as THREE from 'three';

const TAU = Math.PI * 2;

// Leg order everywhere: left-front, right-front, left-hind, right-hind.
// offsets are the phase of each leg within one stride (0..1).
export const GAITS = {
  stand:  { speed: 0,   freq: 0,    amp: 0,    knee: 0,    bob: 0,    pitch: 0,    nod: 0,    offsets: [0, 0.5, 0.75, 0.25] },
  walk:   { speed: 1.6, freq: 0.95, amp: 0.30, knee: 0.55, bob: 0.02, pitch: 0.01, nod: 0.06, offsets: [0, 0.5, 0.75, 0.25] },
  trot:   { speed: 4.0, freq: 1.5,  amp: 0.42, knee: 0.95, bob: 0.06, pitch: 0.02, nod: 0.03, offsets: [0, 0.5, 0.5, 0] },
  gallop: { speed: 9.5, freq: 2.2,  amp: 0.72, knee: 1.15, bob: 0.08, pitch: 0.07, nod: 0.12, offsets: [0.55, 0.65, 0.0, 0.1] },
};

const STATE_GAIT = { graze: 'stand', stand: 'stand', walk: 'walk', trot: 'trot', gallop: 'gallop' };
const TURN_RATE = { stand: 1.6, walk: 1.6, trot: 1.3, gallop: 1.1 };
export const STATE_LABEL = { graze: 'Grazing', stand: 'Resting', walk: 'Walking', trot: 'Trotting', gallop: 'Galloping' };

export const COATS = [
  { name: 'Bay',        body: '#7a4425', mane: '#1b1310', points: '#1b1310', muzzle: '#2a1d18' },
  { name: 'Chestnut',   body: '#a4532a', mane: '#8a3b18', points: null,      muzzle: '#4a2a1c', socks: true, blaze: true },
  { name: 'Palomino',   body: '#d6ac62', mane: '#f4ead3', points: null,      muzzle: '#6b5440', blaze: true },
  { name: 'Black',      body: '#1d1b1e', mane: '#0c0b0d', points: null,      muzzle: '#141215' },
  { name: 'Dapple Grey', body: '#b9b7b2', mane: '#77746f', points: '#5e5b57', muzzle: '#3a3836', pattern: 'dapple' },
  { name: 'Pinto',      body: '#f3efe8', mane: '#2a1d16', points: null,      muzzle: '#a88f86', pattern: 'pinto', spot: '#6b3a1e' },
  { name: 'Appaloosa',  body: '#efe9df', mane: '#3b2a22', points: '#3b2a22', muzzle: '#8f7a72', pattern: 'appaloosa', spot: '#3b2a22' },
  { name: 'Buckskin',   body: '#c9a26b', mane: '#1b1512', points: '#1b1512', muzzle: '#2d231d' },
];

function patternTexture(coat) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = coat.body;
  g.fillRect(0, 0, c.width, c.height);
  const blob = (x, y, r, color, alpha = 1) => {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    // Draw at x and x±width so spots wrap around the u seam.
    for (const ox of [-c.width, 0, c.width]) {
      g.beginPath();
      g.arc(x + ox, y, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  if (coat.pattern === 'pinto') {
    for (let i = 0; i < 6; i++) {
      const cx = Math.random() * c.width;
      const cy = 30 + Math.random() * (c.height - 60);
      for (let j = 0; j < 9; j++) {
        blob(cx + (Math.random() - 0.5) * 110, cy + (Math.random() - 0.5) * 70, 18 + Math.random() * 34, coat.spot);
      }
    }
  } else if (coat.pattern === 'appaloosa') {
    for (let i = 0; i < 260; i++) {
      blob(Math.random() * c.width, Math.random() * c.height, 2.5 + Math.random() * 5, coat.spot, 0.9);
    }
  } else if (coat.pattern === 'dapple') {
    for (let i = 0; i < 160; i++) {
      blob(Math.random() * c.width, Math.random() * c.height, 5 + Math.random() * 9, '#e4e2dd', 0.45);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function lerp(a, b, k) {
  return a + (b - a) * k;
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Horse {
  constructor({ name, coat, size = 1 }) {
    this.name = name;
    this.coat = coat;
    this.size = size;
    this.seed = Math.random() * 100;

    this.state = 'graze';
    this.timer = 2 + Math.random() * 4;
    this.target = new THREE.Vector3();
    this.heading = Math.random() * TAU;
    this.speed = 0;
    this.turnVel = 0;
    this.phase = Math.random();
    this.graze = 1;
    this.lane = 14;
    this.g = { ...GAITS.stand, offsets: [...GAITS.stand.offsets] };

    this.root = new THREE.Group();
    this.root.userData.horse = this;
    this.root.scale.setScalar(size);
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.#build();
  }

  get position() {
    return this.root.position;
  }

  get label() {
    return STATE_LABEL[this.state];
  }

  #build() {
    const coat = this.coat;
    const map = coat.pattern ? patternTexture(coat) : null;
    const coatMat = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : coat.body, map, roughness: 0.62 });
    const maneMat = new THREE.MeshStandardMaterial({ color: coat.mane, roughness: 0.85 });
    const pointsMat = coat.points ? new THREE.MeshStandardMaterial({ color: coat.points, roughness: 0.7 }) : coatMat;
    const sockMat = coat.socks ? new THREE.MeshStandardMaterial({ color: '#f2eee6', roughness: 0.75 }) : pointsMat;
    const hoofMat = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.5 });
    const muzzleMat = new THREE.MeshStandardMaterial({ color: coat.muzzle, roughness: 0.55 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#0a0706', roughness: 0.15, metalness: 0.1 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: '#f5f2ec', roughness: 0.7 });

    const add = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const body = this.body;

    // Torso: barrel plus rounded chest and rump.
    const barrel = add(new THREE.CapsuleGeometry(0.34, 0.85, 8, 20), coatMat, body, 0, 1.22, 0);
    barrel.rotation.x = Math.PI / 2;
    barrel.scale.set(0.92, 1, 1.04);
    add(new THREE.SphereGeometry(0.35, 20, 14), coatMat, body, 0, 1.24, 0.55).scale.set(0.9, 1.05, 1);
    add(new THREE.SphereGeometry(0.37, 20, 14), coatMat, body, 0, 1.27, -0.52).scale.set(1, 1, 1.05);

    // Neck and head.
    this.neck = new THREE.Group();
    this.neck.position.set(0, 1.38, 0.66);
    body.add(this.neck);
    const neckMesh = add(new THREE.CylinderGeometry(0.12, 0.24, 0.95, 16), coatMat, this.neck, 0, 0.4, 0);
    neckMesh.scale.x = 0.72;

    for (let i = 0; i < 10; i++) {
      const y = 0.05 + i * 0.085;
      const r = 0.24 + (0.12 - 0.24) * ((y + 0.075) / 0.95);
      const tuft = add(new THREE.BoxGeometry(0.035, 0.13, 0.11 + Math.random() * 0.04), maneMat, this.neck, 0.03, y, -r + 0.01);
      tuft.rotation.z = 0.25 + (Math.random() - 0.5) * 0.2;
      tuft.rotation.x = (Math.random() - 0.5) * 0.3;
    }

    this.head = new THREE.Group();
    this.head.position.set(0, 0.86, 0);
    this.neck.add(this.head);
    const skull = add(new THREE.CylinderGeometry(0.085, 0.12, 0.55, 14), coatMat, this.head, 0, 0, 0.25);
    skull.rotation.x = Math.PI / 2;
    skull.scale.z = 1.15;
    add(new THREE.SphereGeometry(0.13, 14, 10), coatMat, this.head, 0, -0.04, 0.03).scale.set(0.85, 1, 1);
    add(new THREE.SphereGeometry(0.095, 14, 10), muzzleMat, this.head, 0, -0.01, 0.5).scale.set(0.95, 0.9, 1.05);
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.02, 8, 6), eyeMat, this.head, s * 0.1, 0.05, 0.08);
      add(new THREE.SphereGeometry(0.018, 8, 6), hoofMat, this.head, s * 0.045, 0.02, 0.585);
    }
    if (coat.blaze) {
      const blaze = add(new THREE.BoxGeometry(0.05, 0.02, 0.36), whiteMat, this.head, 0, 0.09, 0.3);
      blaze.rotation.x = -0.07;
    }
    const forelock = add(new THREE.BoxGeometry(0.06, 0.03, 0.13), maneMat, this.head, 0, 0.12, 0.04);
    forelock.rotation.x = 0.2;

    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * 0.055, 0.11, -0.03);
      ear.rotation.x = -0.75;
      ear.rotation.z = -s * 0.15;
      this.head.add(ear);
      add(new THREE.ConeGeometry(0.035, 0.14, 8), coatMat, ear, 0, 0.07, 0);
      this.ears.push(ear);
    }

    // Legs: hip/shoulder pivot -> upper segment -> knee/hock pivot -> cannon, fetlock, hoof.
    this.legs = [];
    for (const [side, front] of [[1, true], [-1, true], [1, false], [-1, false]]) {
      const upperLen = front ? 0.46 : 0.5;
      const lowerLen = front ? 0.4 : 0.36;
      const hip = new THREE.Group();
      hip.position.set(side * 0.19, 0.98, front ? 0.58 : -0.6);
      body.add(hip);
      add(new THREE.CylinderGeometry(front ? 0.105 : 0.14, 0.065, upperLen + 0.12, 12), coatMat, hip, 0, -upperLen / 2 + 0.06, 0);
      const knee = new THREE.Group();
      knee.position.y = -upperLen;
      hip.add(knee);
      add(new THREE.SphereGeometry(0.068, 12, 8), pointsMat, knee);
      add(new THREE.CylinderGeometry(0.052, 0.048, lowerLen, 10), pointsMat, knee, 0, -lowerLen / 2, 0);
      add(new THREE.SphereGeometry(0.062, 10, 8), sockMat, knee, 0, -lowerLen, 0);
      add(new THREE.CylinderGeometry(0.05, 0.056, 0.06, 10), sockMat, knee, 0, -lowerLen - 0.03, 0.008);
      add(new THREE.CylinderGeometry(0.058, 0.074, 0.1, 12), hoofMat, knee, 0, -lowerLen - 0.07, 0.015);
      this.legs.push({ hip, knee, front });
    }

    // Tail: a chain of segments so it can curve and swish.
    this.tailRoot = new THREE.Group();
    this.tailRoot.position.set(0, 1.42, -0.86);
    body.add(this.tailRoot);
    this.tail = [];
    let parent = this.tailRoot;
    const segLen = 0.13;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : -segLen;
      parent.add(seg);
      add(new THREE.CylinderGeometry(0.045 + i * 0.01, 0.05 + i * 0.012, segLen + 0.02, 10), maneMat, seg, 0, -segLen / 2, 0);
      this.tail.push(seg);
      parent = seg;
    }
  }

  // ---- behaviour ----

  #pickNext(herd) {
    const r = Math.random();
    if (r < 0.38) this.#setIdle('graze', 4 + Math.random() * 7);
    else if (r < 0.5) this.#setIdle('stand', 2 + Math.random() * 4);
    else if (r < 0.8) this.#setMove('walk', herd, 4);
    else if (r < 0.93) this.#setMove('trot', herd, 9);
    else this.#setMove('gallop', herd, 16);
  }

  #setIdle(state, time) {
    this.state = state;
    this.timer = time;
  }

  #setMove(state, herd, minDist) {
    this.state = state;
    this.timer = 30;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * herd.roamRadius;
      this.target.set(Math.sin(a) * d, 0, Math.cos(a) * d);
      if (this.target.distanceTo(this.position) >= minDist) break;
    }
  }

  #think(dt, herd) {
    this.timer -= dt;
    if (herd.mode === 'gallop') {
      this.state = 'gallop';
      const ang = Math.atan2(this.position.x, this.position.z) + 0.5;
      this.target.set(Math.sin(ang) * this.lane, 0, Math.cos(ang) * this.lane);
      return;
    }
    if (herd.mode === 'graze') {
      if (this.state !== 'graze') this.#setIdle('graze', 5);
      return;
    }
    const moving = this.state === 'walk' || this.state === 'trot' || this.state === 'gallop';
    const arrived = moving && Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z) < 1.2;
    if (arrived || this.timer <= 0) this.#pickNext(herd);
  }

  update(dt, t, herd) {
    this.#think(dt, herd);

    // Blend gait parameters toward the target gait for smooth transitions.
    const goal = GAITS[STATE_GAIT[this.state]];
    const k = 1 - Math.exp(-dt * 2.5);
    const g = this.g;
    for (const key of ['speed', 'freq', 'amp', 'knee', 'bob', 'pitch', 'nod']) g[key] = lerp(g[key], goal[key], k);
    for (let i = 0; i < 4; i++) g.offsets[i] = lerp(g.offsets[i], goal.offsets[i], k);
    this.graze = lerp(this.graze, this.state === 'graze' ? 1 : 0, 1 - Math.exp(-dt * 1.5));

    // Steering toward the target, away from neighbours and the fence.
    const moving = goal.speed > 0;
    let desired = this.heading;
    if (moving) {
      let vx = this.target.x - this.position.x;
      let vz = this.target.z - this.position.z;
      const len = Math.hypot(vx, vz) || 1;
      vx /= len;
      vz /= len;
      for (const other of herd.horses) {
        if (other === this) continue;
        const dx = this.position.x - other.position.x;
        const dz = this.position.z - other.position.z;
        const d = Math.hypot(dx, dz);
        const reach = 2.4 * (this.size + other.size) / 2;
        if (d > 0.001 && d < reach) {
          const push = (reach - d) / reach * 1.8;
          vx += (dx / d) * push;
          vz += (dz / d) * push;
        }
      }
      const r = Math.hypot(this.position.x, this.position.z);
      if (r > herd.fenceRadius - 4) {
        const push = (r - (herd.fenceRadius - 4)) * 0.8;
        vx -= (this.position.x / r) * push;
        vz -= (this.position.z / r) * push;
      }
      desired = Math.atan2(vx, vz);
    }
    const sizeK = Math.sqrt(this.size);
    const maxTurn = TURN_RATE[STATE_GAIT[this.state]] * dt;
    const turn = THREE.MathUtils.clamp(wrapAngle(desired - this.heading), -maxTurn, maxTurn);
    this.heading = wrapAngle(this.heading + turn);
    this.turnVel = dt > 0 ? turn / dt : 0;
    this.speed = g.speed * sizeK;

    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;
    const r = Math.hypot(this.position.x, this.position.z);
    const limit = herd.fenceRadius - 1.5;
    if (r > limit) this.position.multiplyScalar(limit / r);
    this.root.rotation.y = this.heading;

    this.#pose(dt, t);
  }

  #pose(dt, t) {
    const g = this.g;
    this.phase = (this.phase + (g.freq / Math.sqrt(this.size)) * dt) % 1;
    const gallopF = THREE.MathUtils.clamp((g.amp - 0.42) / (0.72 - 0.42), 0, 1);
    const trotF = THREE.MathUtils.clamp((g.amp - 0.3) / (0.42 - 0.3), 0, 1);

    this.legs.forEach((leg, i) => {
      const p = TAU * (this.phase + g.offsets[i]);
      const lift = Math.max(0, Math.cos(p)) ** 1.5;
      if (leg.front) {
        leg.hip.rotation.x = -g.amp * Math.sin(p);
        leg.knee.rotation.x = g.knee * lift;
      } else {
        leg.hip.rotation.x = -g.amp * 0.9 * Math.sin(p) + 0.04 * g.amp;
        leg.knee.rotation.x = g.knee * 0.7 * lift;
      }
    });

    const s = Math.sin(TAU * this.phase);
    this.body.position.y = g.bob * Math.abs(s);
    this.body.rotation.x = g.pitch * s + this.graze * 0.06;
    this.body.rotation.z = THREE.MathUtils.clamp(-this.turnVel * this.speed * 0.02, -0.15, 0.15);

    const nod = g.nod * (gallopF > 0.5 ? Math.sin(TAU * this.phase) : Math.sin(2 * TAU * this.phase));
    const chew = this.graze * 0.05 * Math.sin(t * 7 + this.seed);
    const look = (1 - this.graze) * 0.12 * Math.sin(t * 0.4 + this.seed) * (1 - gallopF);
    this.neck.rotation.x = lerp(0.62, 2.5, this.graze) + gallopF * 0.35 + nod;
    this.neck.rotation.y = look;
    this.head.rotation.x = lerp(0.3, -0.6, this.graze) - gallopF * 0.15 + chew;

    this.ears.forEach((ear, i) => {
      const twitch = Math.sin(t * 1.3 + this.seed * (i + 1)) > 0.97 ? 0.4 : 0;
      ear.rotation.x = -0.75 - gallopF * 0.5 + twitch;
    });

    this.tailRoot.rotation.x = 0.45 + trotF * 0.2 + gallopF * 0.35;
    const swish = lerp(0.22, 0.08, gallopF);
    const swishSpeed = lerp(1.8, 9, gallopF);
    this.tail.forEach((seg, i) => {
      if (i > 0) seg.rotation.x = lerp(-0.12, -0.05, gallopF) + 0.03 * gallopF * Math.sin(t * 12 - i);
      seg.rotation.z = swish * Math.sin(t * swishSpeed + this.seed - i * 0.6);
    });
  }
}
