import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural bank lobby around the ATM (ATM front faces +Z at the origin).
 * Polished tiled floor, a slatted feature wall behind the ATM, ceiling light panels, an instruction
 * stand and a wall poster. One shadow-casting key light (2048 map); everything else is fill.
 * The camera space in front of the ATM (z 1.2..3, x -0.8..0.8) is kept clear.
 */

const FONT = "'Inter', 'Segoe UI', 'Helvetica Neue', 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export interface Lobby {
  group: THREE.Group;
  lights: THREE.Light[];
  dispose(): void;
}

export function buildLobby(): Lobby {
  const group = new THREE.Group();
  group.name = 'lobby';
  const textures: THREE.Texture[] = [];
  const tex = (c: HTMLCanvasElement, srgb: boolean, repeat?: [number, number]): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    textures.push(t);
    return t;
  };

  const ROOM = { x0: -4.5, x1: 4.5, z0: -1.9, z1: 5.5, h: 3.2 };
  const roomW = ROOM.x1 - ROOM.x0;
  const roomD = ROOM.z1 - ROOM.z0;
  const cx = (ROOM.x0 + ROOM.x1) / 2;
  const cz = (ROOM.z0 + ROOM.z1) / 2;

  // ───────────── floor: large polished stone tiles ─────────────
  const TILE = 0.6;
  const [fc, f] = canvas(1024, 1024);
  const [rc, r] = canvas(512, 512);
  {
    const rnd = rng(7);
    const n = 4; // tiles per texture
    const s = 1024 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const base = 214 + (rnd() - 0.5) * 14;
        f.fillStyle = `rgb(${base | 0},${(base - 6) | 0},${(base - 14) | 0})`;
        f.fillRect(i * s, j * s, s, s);
        // soft cloudy variation + a few veins
        for (let k = 0; k < 40; k++) {
          const g = f.createRadialGradient(i * s + rnd() * s, j * s + rnd() * s, 0, i * s + rnd() * s, j * s + rnd() * s, 30 + rnd() * 80);
          const tone = rnd() < 0.5 ? '255,250,240' : '150,140,128';
          g.addColorStop(0, `rgba(${tone},0.10)`);
          g.addColorStop(1, `rgba(${tone},0)`);
          f.fillStyle = g;
          f.fillRect(i * s, j * s, s, s);
        }
        f.strokeStyle = 'rgba(120,110,100,0.25)';
        f.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          f.beginPath();
          let x = i * s + rnd() * s;
          let y = j * s;
          f.moveTo(x, y);
          while (y < (j + 1) * s) {
            x += (rnd() - 0.5) * 18;
            y += 8 + rnd() * 10;
            f.lineTo(Math.min((i + 1) * s, Math.max(i * s, x)), Math.min((j + 1) * s, y));
          }
          f.stroke();
        }
      }
    }
    // grout
    f.fillStyle = '#8f877d';
    for (let i = 0; i <= n; i++) {
      f.fillRect(i * s - 2, 0, 4, 1024);
      f.fillRect(0, i * s - 2, 1024, 4);
    }
    // roughness: polished tiles, rough grout, subtle scuffs
    r.fillStyle = 'rgb(46,46,46)';
    r.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 900; k++) {
      const v = 46 + rnd() * 50;
      r.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},0.35)`;
      r.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 18, 1 + rnd() * 3);
    }
    r.fillStyle = 'rgb(220,220,220)';
    const rs = 512 / n;
    for (let i = 0; i <= n; i++) {
      r.fillRect(i * rs - 1.5, 0, 3, 512);
      r.fillRect(0, i * rs - 1.5, 512, 3);
    }
  }
  const rep: [number, number] = [roomW / (TILE * 4), roomD / (TILE * 4)];
  const floorMat = new THREE.MeshStandardMaterial({
    map: tex(fc, true, rep),
    roughnessMap: tex(rc, false, rep),
    roughness: 1,
    metalness: 0,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  floor.name = 'lobby-floor';
  group.add(floor);

  // ───────────── walls ─────────────
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e5de, roughness: 0.9, metalness: 0 });
  const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xdcd7cf, roughness: 0.92, metalness: 0 });
  const addWall = (w: number, pos: [number, number, number], rotY: number, mat: THREE.Material): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), mat);
    m.position.set(...pos);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  addWall(roomW, [cx, ROOM.h / 2, ROOM.z0], 0, wallMat);
  addWall(roomD, [ROOM.x0, ROOM.h / 2, cz], Math.PI / 2, sideWallMat);
  addWall(roomD, [ROOM.x1, ROOM.h / 2, cz], -Math.PI / 2, sideWallMat);
  addWall(roomW, [cx, ROOM.h / 2, ROOM.z1], Math.PI, sideWallMat);

  // skirting boards
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.2 });
  const skirt = (w: number, pos: [number, number, number], rotY: number): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.015), skirtMat);
    m.position.set(...pos);
    m.rotation.y = rotY;
    group.add(m);
  };
  skirt(roomW, [cx, 0.05, ROOM.z0 + 0.008], 0);
  skirt(roomD, [ROOM.x0 + 0.008, 0.05, cz], Math.PI / 2);
  skirt(roomD, [ROOM.x1 - 0.008, 0.05, cz], Math.PI / 2);
  skirt(roomW, [cx, 0.05, ROOM.z1 - 0.008], 0);

  // ───────────── feature wall behind the ATM: navy panel + oak slats ─────────────
  const featW = 3.0;
  const navyMat = new THREE.MeshStandardMaterial({ color: 0x163049, roughness: 0.6, metalness: 0.1 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(featW, ROOM.h - 0.02, 0.04), navyMat);
  panel.position.set(0, ROOM.h / 2, ROOM.z0 + 0.02);
  panel.receiveShadow = true;
  group.add(panel);
  const [wc, w] = canvas(256, 1024);
  {
    const rnd = rng(3);
    w.fillStyle = '#a9794b';
    w.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * 256;
      w.strokeStyle = `rgba(${rnd() < 0.5 ? '90,55,25' : '210,170,120'},${0.15 + rnd() * 0.25})`;
      w.lineWidth = 0.5 + rnd() * 2;
      w.beginPath();
      w.moveTo(x, 0);
      let xx = x;
      for (let y = 0; y <= 1024; y += 32) {
        xx += (rnd() - 0.5) * 3;
        w.lineTo(xx, y);
      }
      w.stroke();
    }
  }
  const woodMat = new THREE.MeshStandardMaterial({ map: tex(wc, true), roughness: 0.55, metalness: 0 });
  const slatH = 2.7;
  const slatCount = 15;
  const slatGeo = new THREE.BoxGeometry(0.045, slatH, 0.03);
  const slats = new THREE.InstancedMesh(slatGeo, woodMat, slatCount * 2);
  {
    const mtx = new THREE.Matrix4();
    let k = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < slatCount; i++) {
        const x = side * (0.75 + i * 0.05);
        mtx.makeTranslation(x, slatH / 2 + 0.12, ROOM.z0 + 0.055);
        slats.setMatrixAt(k++, mtx);
      }
    }
    slats.instanceMatrix.needsUpdate = true;
  }
  slats.receiveShadow = true;
  group.add(slats);
  // backlit bank sign on the feature wall
  const [sc, sctx] = canvas(1024, 256);
  {
    sctx.clearRect(0, 0, 1024, 256);
    sctx.fillStyle = '#ffffff';
    sctx.font = `800 104px ${FONT}`;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText('MERIDIAN', 512, 100);
    sctx.font = `600 46px ${FONT}`;
    sctx.fillStyle = '#7fe0d4';
    sctx.fillText('TRAINING BANK · SELF-SERVICE', 512, 196);
  }
  const signTex = tex(sc, true);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9, transparent: true, roughness: 0.4 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.31), signMat);
  sign.position.set(0, 2.55, ROOM.z0 + 0.045);
  group.add(sign);
  // floor-level cove light along the feature panel
  const coveMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff0d8, emissiveIntensity: 1.6 });
  const cove = new THREE.Mesh(new THREE.BoxGeometry(featW - 0.1, 0.01, 0.01), coveMat);
  cove.position.set(0, 0.105, ROOM.z0 + 0.05);
  group.add(cove);

  // ───────────── ceiling + recessed light panels ─────────────
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.95 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, ROOM.h, cz);
  group.add(ceil);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6ea, emissiveIntensity: 2.2, roughness: 0.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xbfc2c6, metalness: 0.6, roughness: 0.4 });
  const panelPos: Array<[number, number]> = [];
  for (const x of [-3, -1.2, 1.2, 3]) for (const z of [-0.6, 1.6, 3.8]) panelPos.push([x, z]);
  const lp = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.58, 1.18).rotateX(Math.PI / 2), panelMat, panelPos.length);
  const lt = new THREE.InstancedMesh(new THREE.BoxGeometry(0.64, 0.02, 1.24), trimMat, panelPos.length);
  panelPos.forEach(([x, z], i) => {
    lp.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, ROOM.h - 0.012, z));
    lt.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, ROOM.h - 0.005, z));
  });
  group.add(lt, lp);
  // round downlights over the ATM zone
  const dlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e0, emissiveIntensity: 3 });
  const dl = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 24).rotateX(Math.PI / 2), dlMat, 3);
  [-0.6, 0, 0.6].forEach((x, i) => dl.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, ROOM.h - 0.003, 0.4)));
  group.add(dl);

  // ───────────── instruction stand (left of the ATM) ─────────────
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 1, roughness: 0.3 });
  const stand = new THREE.Group();
  stand.name = 'instruction-stand';
  stand.position.set(-1.1, 0, 0.45);
  stand.rotation.y = 0.45;
  group.add(stand);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 40), steel);
  base.position.y = 0.01;
  stand.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.05, 16), steel);
  pole.position.y = 0.53;
  pole.castShadow = true;
  stand.add(pole);
  const [pc, p] = canvas(768, 1024);
  {
    const g = p.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0, '#12283f');
    g.addColorStop(1, '#0c1b2b');
    p.fillStyle = g;
    p.fillRect(0, 0, 768, 1024);
    p.fillStyle = '#18b3a3';
    p.fillRect(0, 0, 768, 14);
    p.fillStyle = '#ffffff';
    p.textAlign = 'left';
    p.textBaseline = 'middle';
    p.font = `800 60px ${FONT}`;
    p.fillText('How to use', 50, 90);
    p.fillText('this ATM', 50, 160);
    const steps = [
      ['1', 'Insert or tap your card', 'Chip end first, face up'],
      ['2', 'Enter your PIN', 'Shield the keypad with your hand'],
      ['3', 'Choose a transaction', 'Withdraw · Deposit · Balance · Transfer'],
      ['4', 'Take your card', 'It is returned before the cash'],
      ['5', 'Take cash & receipt', 'Uncollected cash is retracted'],
    ];
    steps.forEach(([n, a, b], i) => {
      const y = 270 + i * 135;
      p.fillStyle = '#18b3a3';
      p.beginPath();
      p.arc(82, y, 34, 0, Math.PI * 2);
      p.fill();
      p.fillStyle = '#0c1b2b';
      p.font = `800 40px ${FONT}`;
      p.textAlign = 'center';
      p.fillText(n, 82, y + 2);
      p.textAlign = 'left';
      p.fillStyle = '#ffffff';
      p.font = `700 36px ${FONT}`;
      p.fillText(a, 140, y - 18);
      p.fillStyle = '#9fb4c7';
      p.font = `500 26px ${FONT}`;
      p.fillText(b, 140, y + 24);
    });
    p.fillStyle = '#ffd34d';
    p.font = `700 26px ${FONT}`;
    p.fillText('Training simulator — fictional bank & currency', 50, 975);
  }
  const posterTex = tex(pc, true);
  const frame = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.66, 0.03, 2, 0.01), new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.5, roughness: 0.4 }));
  frame.position.set(0, 1.38, 0);
  frame.rotation.x = -0.12;
  frame.castShadow = true;
  stand.add(frame);
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.47, 0.627), new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.35, emissive: 0xffffff, emissiveMap: posterTex, emissiveIntensity: 0.25 }));
  poster.position.set(0, 0, 0.0155);
  frame.add(poster);

  // ───────────── wall poster (right of the ATM) ─────────────
  const [wpc, wp] = canvas(1024, 704);
  {
    wp.fillStyle = '#f6f4ef';
    wp.fillRect(0, 0, 1024, 704);
    wp.fillStyle = '#12283f';
    wp.fillRect(0, 0, 1024, 150);
    wp.fillStyle = '#ffffff';
    wp.textAlign = 'left';
    wp.textBaseline = 'middle';
    wp.font = `800 62px ${FONT}`;
    wp.fillText('Training simulator', 56, 76);
    wp.fillStyle = '#12283f';
    wp.font = `700 44px ${FONT}`;
    wp.fillText('Fictional bank & currency', 56, 220);
    wp.font = `500 32px ${FONT}`;
    wp.fillStyle = '#333a42';
    const lines = [
      'Meridian Training Bank does not exist.',
      'Cards use the never-issued 9990 prefix.',
      'Banknotes are labelled TRAINING NOTE —',
      'NOT LEGAL TENDER and only work here.',
      'No real accounts, PINs or networks are used.',
    ];
    lines.forEach((l, i) => wp.fillText(l, 56, 300 + i * 56));
    // four note swatches (training colours)
    const cols = ['#d8c08c', '#3aa6a0', '#8c6fc9', '#e2735f'];
    const vals = ['10', '20', '50', '100'];
    cols.forEach((c, i) => {
      wp.fillStyle = c;
      wp.fillRect(56 + i * 230, 600, 200, 70);
      wp.fillStyle = '#1a1a1a';
      wp.font = `800 36px ${FONT}`;
      wp.fillText(vals[i], 72 + i * 230, 636);
    });
  }
  const wallPoster = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62), new THREE.MeshStandardMaterial({ map: tex(wpc, true), roughness: 0.5 }));
  wallPoster.position.set(2.05, 1.55, ROOM.z0 + 0.012);
  group.add(wallPoster);
  const wpFrame = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.66, 0.015), new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.4, roughness: 0.5 }));
  wpFrame.position.set(2.05, 1.55, ROOM.z0 + 0.004);
  group.add(wpFrame);

  // ───────────── small props: waste bin + plant ─────────────
  const binMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.9, roughness: 0.35 });
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.55, 32, 1, true), binMat);
  bin.position.set(0.98, 0.275, -0.25);
  group.add(bin);
  const binTop = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.6 }));
  binTop.position.set(0.98, 0.565, -0.25);
  group.add(binTop);
  const potMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.2 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.5, 32), potMat);
  pot.position.set(2.4, 0.25, -1.2);
  pot.castShadow = true;
  group.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.7 });
  const leafGeo = new THREE.SphereGeometry(0.1, 8, 6);
  leafGeo.scale(0.5, 1.7, 0.25);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, 40);
  {
    const rnd = rng(9);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const tilt = 0.2 + rnd() * 0.8;
      q.setFromEuler(new THREE.Euler(Math.cos(a) * tilt, a, Math.sin(a) * tilt));
      const h = 0.65 + rnd() * 0.7;
      mtx.compose(new THREE.Vector3(2.4 + Math.sin(a) * tilt * 0.18, h, -1.2 + Math.cos(a) * tilt * 0.18), q, new THREE.Vector3(1, 1 + rnd(), 1));
      leaves.setMatrixAt(i, mtx);
    }
  }
  leaves.castShadow = true;
  group.add(leaves);

  // ───────────── lights ─────────────
  const hemi = new THREE.HemisphereLight(0xe6eef8, 0x6d6255, 0.45);
  hemi.position.set(0, 3, 0);
  const key = new THREE.SpotLight(0xfff1e0, 38, 9, 0.62, 0.65, 1.6);
  key.position.set(1.5, 3.05, 2.3);
  key.target.position.set(0, 0.9, 0.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 7;
  key.shadow.radius = 4;
  group.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdbe6ff, 0.55);
  fill.position.set(-2.5, 2.2, 3.0);
  fill.target.position.set(0, 0.9, 0);
  group.add(fill, fill.target);
  const rim = new THREE.PointLight(0xfff0dd, 4, 5, 2);
  rim.position.set(-1.0, 2.6, -1.3);
  group.add(hemi, rim);

  const lights: THREE.Light[] = [hemi, key, fill, rim];

  return {
    group,
    lights,
    dispose() {
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) geos.add(m.geometry);
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
      });
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      key.shadow.map?.dispose();
    },
  };
}
