import * as THREE from 'three';
import type { KeypadKey } from '../core/types';
import type { Door } from './types';
import { anchor, label, ledMesh, part, shellMesh, type BuildCtx } from './context';
import { D } from './dims';
import { BRAND, FONT, makeCanvas, roundRectPath } from './materials';
import { buildKeypad } from './keypad';
import { box, cylY, cylZ, dyn, extrudeProfileX, extrudeXY, fasteners, group, holeRect, instancedBoxes, instancedDots, mesh, rbox, rectShape, type V3 } from './util';

export interface ExteriorBuild {
  doors: { service: Door; vault: Door };
  /** Content groups (world-space coordinates) that move with each door. */
  serviceInner: THREE.Group;
  vaultInner: THREE.Group;
  screenMesh: THREE.Mesh;
  keys: Map<KeypadKey, THREE.Mesh>;
  /** Rest pose of the training card on the wallet shelf (world). */
  cardRest: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

function makeDoor(parent: THREE.Object3D, pivotPos: V3, maxAngle: number, name: string): { pivot: THREE.Group; inner: THREE.Group; door: Door } {
  const pivot = group(parent, pivotPos, `${name}-pivot`);
  const inner = group(pivot, [-pivotPos[0], -pivotPos[1], -pivotPos[2]], `${name}-inner`);
  let open = 0;
  const door: Door = {
    pivot,
    setOpen(a: number) {
      open = Math.min(1, Math.max(0, a));
      pivot.rotation.y = -maxAngle * open;
    },
    get open() {
      return open;
    },
  };
  return { pivot, inner, door };
}

function contactlessCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#e8f6ff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(70, 118, 28 + i * 30, -0.75, 0.75);
    ctx.stroke();
  }
  ctx.fillStyle = '#9fb3c2';
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('TAP HERE', 128, 230);
  return canvas;
}

function grilleCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256, 256);
  ctx.fillStyle = '#9ea4aa';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#0a0b0c';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = 8 + x * 16 + (y % 2) * 8;
      const cy = 8 + y * 16;
      const d = Math.hypot(cx - 128, cy - 128);
      if (d > 118) continue;
      ctx.beginPath();
      ctx.arc(cx, cy, 4.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvas;
}

function topperCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(2048, 640);
  const g = ctx.createLinearGradient(0, 0, 0, 640);
  g.addColorStop(0, '#173a5c');
  g.addColorStop(1, '#0c2034');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 640);
  // logo mark: stylised meridian globe
  ctx.save();
  ctx.translate(250, 300);
  ctx.strokeStyle = BRAND.tealCss;
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(0, 0, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, 60, 150, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-150, 0);
  ctx.lineTo(150, 0);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `800 190px ${FONT}`;
  ctx.fillText('MERIDIAN', 470, 250);
  ctx.font = `600 96px ${FONT}`;
  ctx.fillStyle = '#cfe9ef';
  ctx.fillText('TRAINING BANK', 476, 420);
  // ATM badge
  ctx.fillStyle = BRAND.tealCss;
  roundRectPath(ctx, 1560, 170, 380, 230, 40);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = `900 150px ${FONT}`;
  ctx.fillText('ATM', 1750, 292);
  ctx.font = `600 52px ${FONT}`;
  ctx.fillStyle = '#d6eef3';
  ctx.fillText('24h · TRAINING', 1750, 500);
  return canvas;
}

export function buildExterior(ctx: BuildCtx): ExteriorBuild {
  const { m, s, root } = ctx;
  const tex = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    ctx.ownedTextures.push(t);
    return t;
  };
  const own = <T extends THREE.Material>(mat: T): T => {
    ctx.ownedMaterials.push(mat);
    return mat;
  };

  // ───────────────────────────── cabinet ─────────────────────────────
  const cab = part(ctx, 'cabinet', root);
  shellMesh(ctx, mesh(rbox(0.68, D.plinthH, 0.8, 0.008), s.plinth, cab, [0, D.plinthH / 2, 0]));
  const sideH = D.topY - D.plinthH;
  for (const sx of [-1, 1]) {
    const side = shellMesh(ctx, mesh(rbox(0.025, sideH, D.front - D.back, 0.006), s.sidePaint, cab, [sx * 0.3475, D.plinthH + sideH / 2, 0]), true);
    side.name = sx < 0 ? 'side-left' : 'side-right';
    // printed side graphic
    const decal = shellMesh(ctx, mesh(new THREE.PlaneGeometry(0.836, sideH - 0.012), s.sideGraphic, cab, [sx * 0.3602, D.plinthH + sideH / 2, 0], [0, (sx * Math.PI) / 2, 0]));
    decal.name = sx < 0 ? 'side-graphic-left' : 'side-graphic-right';
    // front edge: brushed trim + teal light strip along the alcove cheeks
    mesh(box(0.022, sideH - 0.01, 0.003), m.brushedAlu, cab, [sx * 0.3475, D.plinthH + sideH / 2, D.front + 0.0016]);
    mesh(box(0.005, D.topY - D.band.y1 - 0.03, 0.002), m.tealGlow, cab, [sx * 0.3475, (D.topY + D.band.y1) / 2, D.front + 0.0035]);
  }
  // top canopy
  shellMesh(ctx, mesh(rbox(D.W, 0.03, D.front - D.back + 0.01, 0.008), s.topPaint, cab, [0, D.topY + 0.015, 0.005]), true);
  mesh(box(D.W - 0.01, 0.012, 0.003), m.brushedAlu, cab, [0, D.topY + 0.015, D.front + 0.0105]);
  // warm downlight under the canopy lip, lighting the fascia
  mesh(box(0.6, 0.003, 0.012), m.warmGlow, cab, [0, D.topY - 0.004, D.front - 0.02]);
  // rear panel
  shellMesh(ctx, mesh(rbox(0.672, sideH - 0.005, 0.012, 0.004), s.rearPaint, cab, [0, D.plinthH + sideH / 2, D.back + 0.006]), true);
  // rear louvres (upper module ventilation): brushed plates with dark slots
  for (const y of [1.44, 1.2]) {
    mesh(rbox(0.36, 0.17, 0.004, 0.002), m.brushedAlu, cab, [0, y, D.back - 0.002]);
    const slots: V3[] = [];
    for (let r = 0; r < 7; r++) for (const x of [-0.085, 0.085]) slots.push([x, y - 0.06 + r * 0.02, D.back - 0.0042]);
    instancedBoxes(cab, [0.14, 0.008, 0.001], slots, m.throatDark).userData.componentId = 'cabinet';
  }
  fasteners(cab, [-0.17, 0.17].flatMap((x) => [1.36, 1.52, 1.12, 1.28].map((y) => [x, y, D.back - 0.004] as V3)), [0, 0, -1], m.zinc, 0.004, 'cabinet');
  // rear access panel seam (upper) + lock
  for (const [w, h, x, y] of [
    [0.56, 0.004, 0, 1.585],
    [0.56, 0.004, 0, 1.03],
    [0.004, 0.555, -0.28, 1.3075],
    [0.004, 0.555, 0.28, 1.3075],
  ] as Array<[number, number, number, number]>) {
    mesh(box(w, h, 0.002), m.throatDark, cab, [x, y, D.back - 0.0005]);
  }
  mesh(cylZ(0.011, 0.008, 18), m.chrome, cab, [0.24, 1.3, D.back - 0.004]);
  mesh(box(0.0025, 0.012, 0.002), m.throatDark, cab, [0.24, 1.3, D.back - 0.0085]);
  // rating plate
  mesh(new THREE.PlaneGeometry(0.16, 0.1), s.rearPlate, cab, [-0.15, 0.95, D.back - 0.0008], [0, Math.PI, 0]);
  // power cable gland + cable to the floor
  mesh(cylZ(0.014, 0.02, 16), m.blackPlastic, cab, [0.2, 0.16, D.back - 0.008]);
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.2, 0.16, D.back - 0.016),
    new THREE.Vector3(0.2, 0.1, D.back - 0.05),
    new THREE.Vector3(0.21, 0.012, D.back - 0.12),
    new THREE.Vector3(0.25, 0.01, D.back - 0.4),
  ]);
  mesh(new THREE.TubeGeometry(cablePath, 24, 0.006, 8, false), m.cable, cab);
  // floor anchor bolts (front)
  fasteners(cab, [-0.28, 0.28].map((x) => [x, D.plinthH + 0.0005, 0.405] as V3), [0, 1, 0], m.zinc, 0.009, 'cabinet');

  // fixed fascia band with the cash and deposit openings
  const bandShape = rectShape(0, (D.band.y0 + D.band.y1) / 2, D.skinIn * 2, D.band.y1 - D.band.y0);
  bandShape.holes.push(holeRect(D.dispX, D.cash.y, 0.206, 0.038, 0.004));
  bandShape.holes.push(holeRect(D.depX, D.cash.y, 0.176, 0.024, 0.004));
  const band = shellMesh(ctx, mesh(extrudeXY(bandShape, 0.012), s.fascia, cab, [0, 0, D.front - 0.012]));
  band.name = 'fascia-band';
  mesh(box(D.skinIn * 2, 0.004, 0.004), m.brushedAlu, cab, [0, D.band.y1 - 0.002, D.front + 0.001]);
  // upper module floor plate (internal)
  mesh(box(0.66, 0.006, 0.71), m.zinc, cab, [0, D.band.y1 - 0.003, -0.06]);

  // ───────────────────────────── topper sign ─────────────────────────────
  const topper = part(ctx, 'topper-sign', root);
  const topperBody = own(new THREE.MeshStandardMaterial({ color: BRAND.navy, metalness: 0.4, roughness: 0.35 }));
  const tb = mesh(rbox(D.W, 0.25, 0.16, 0.012), topperBody, topper, [0, D.topY + 0.03 + 0.125, D.front - 0.08]);
  tb.castShadow = true;
  const topTex = tex(topperCanvas());
  const topMat = own(new THREE.MeshStandardMaterial({ map: topTex, emissive: 0xffffff, emissiveMap: topTex, emissiveIntensity: 1.25, roughness: 0.2, metalness: 0 }));
  mesh(new THREE.PlaneGeometry(0.69, 0.215), topMat, topper, [0, D.topY + 0.155, D.front + 0.0008]);
  mesh(new THREE.PlaneGeometry(0.69, 0.215), topMat, topper, [0, D.topY + 0.155, D.front - 0.1608], [0, Math.PI, 0]);
  for (const sx of [-1, 1]) {
    mesh(box(0.003, 0.2, 0.12), m.tealGlow, topper, [sx * 0.3612, D.topY + 0.155, D.front - 0.08]);
  }
  mesh(box(D.W + 0.004, 0.006, 0.164), m.brushedAlu, topper, [0, D.topY + 0.033, D.front - 0.08]);

  // ───────────────────────────── service door (upper fascia) ─────────────────────────────
  const svc = makeDoor(root, [-D.skinIn + 0.002, 0, D.front + 0.003], (100 * Math.PI) / 180, 'service-door');
  const sd = part(ctx, 'service-door', svc.inner);
  const dW = D.door.x1 - D.door.x0;
  const faceH = D.door.y1 - D.door.y0;
  const face = shellMesh(ctx, mesh(rbox(dW, faceH, D.door.faceT, 0.003), s.fascia, sd, [0, D.door.y0 + faceH / 2, D.door.face - D.door.faceT / 2]));
  face.name = 'service-door-face';
  // alcove side flanges + ceiling return
  const flangeH = D.door.y1 - D.deck.yBackTop;
  for (const sx of [-1, 1]) {
    shellMesh(ctx, mesh(box(0.006, flangeH, D.front - D.door.face), s.fascia, sd, [sx * (D.door.x1 - 0.003), D.deck.yBackTop + flangeH / 2, (D.front + D.door.face) / 2]));
  }
  shellMesh(ctx, mesh(box(dW, 0.008, D.front - D.door.face), s.fascia, sd, [0, D.door.y1 - 0.004, (D.front + D.door.face) / 2]));
  // keypad deck (tilted) + flat wallet shelf
  const dk = D.deck;
  const deckW = dk.shelfX - D.door.x0;
  const deck = shellMesh(
    ctx,
    mesh(
      extrudeProfileX(
        [
          [D.door.face - 0.006, dk.yBottom],
          [dk.zFront, dk.yBottom],
          [dk.zFront, dk.yFrontTop],
          [dk.zBack, dk.yBackTop],
          [D.door.face - 0.006, dk.yBackTop],
        ],
        deckW,
        0.003,
      ),
      s.fascia,
      sd,
      [D.door.x0 + deckW / 2, 0, 0],
    ),
  );
  deck.name = 'keypad-deck';
  const shelfW = D.door.x1 - dk.shelfX;
  shellMesh(
    ctx,
    mesh(
      extrudeProfileX(
        [
          [D.door.face - 0.006, dk.yBottom],
          [dk.zFront, dk.yBottom],
          [dk.zFront, dk.shelfTop],
          [D.door.face - 0.006, dk.shelfTop],
        ],
        shelfW,
        0.003,
      ),
      s.fascia,
      sd,
      [dk.shelfX + shelfW / 2, 0, 0],
    ),
  );
  // brushed lip along the deck front + rubber mat on the shelf
  mesh(box(dW - 0.004, dk.yFrontTop - dk.yBottom - 0.004, 0.002), m.brushedAlu, sd, [0, (dk.yBottom + dk.yFrontTop) / 2, dk.zFront + 0.001]);
  mesh(rbox(shelfW - 0.024, 0.002, 0.19, 0.001), m.brushedAlu, sd, [dk.shelfX + shelfW / 2, dk.shelfTop + 0.0042, 0.41]);
  // door back: stiffening frame (visible when open)
  for (const [w, h, x, y] of [
    [dW - 0.04, 0.02, 0, 1.6],
    [dW - 0.04, 0.02, 0, 1.11],
    [0.02, 0.49, -0.3, 1.355],
    [0.02, 0.49, 0.3, 1.355],
  ] as Array<[number, number, number, number]>) {
    shellMesh(ctx, mesh(box(w, h, 0.012), s.doorInner, sd, [x, y, D.door.face - D.door.faceT - 0.006]));
  }
  label(
    ctx,
    sd,
    {
      w: 512,
      h: 256,
      bg: '#e8e8e2',
      border: { color: '#333', width: 6 },
      lines: [
        { text: 'SERVICE DOOR', size: 40, weight: '800', color: '#111', y: 0.2 },
        { text: 'Authorised technicians only.', size: 26, weight: '500', color: '#222', y: 0.45 },
        { text: 'Isolate power before servicing', size: 26, weight: '500', color: '#222', y: 0.62 },
        { text: 'the dispenser. (Training unit)', size: 26, weight: '500', color: '#222', y: 0.77 },
      ],
    },
    [0.12, 0.06],
    [0.15, 1.5, D.door.face - D.door.faceT - 0.0005],
    [0, Math.PI, 0],
  );

  // left-column instruction sticker
  label(
    ctx,
    sd,
    {
      w: 256,
      h: 384,
      bg: '#1b1e22',
      border: { color: BRAND.tealCss, width: 4, radius: 16 },
      lines: [
        { text: 'HOW TO USE', size: 30, weight: '800', color: BRAND.tealCss, y: 0.1 },
        { text: '1  Insert or tap card', size: 21, weight: '600', color: '#e6e9ec', y: 0.25, align: 'left', x: 0.08 },
        { text: '2  Enter PIN (shield it)', size: 21, weight: '600', color: '#e6e9ec', y: 0.37, align: 'left', x: 0.08 },
        { text: '3  Choose transaction', size: 21, weight: '600', color: '#e6e9ec', y: 0.49, align: 'left', x: 0.08 },
        { text: '4  Take card', size: 21, weight: '600', color: '#e6e9ec', y: 0.61, align: 'left', x: 0.08 },
        { text: '5  Take cash & receipt', size: 21, weight: '600', color: '#e6e9ec', y: 0.73, align: 'left', x: 0.08 },
        { text: 'Training simulator', size: 18, weight: '500', color: '#8d98a3', y: 0.9 },
      ],
    },
    [0.085, 0.1275],
    [D.leftCol, 1.285, D.door.face + 0.0006],
  );

  // ───────────────────────────── display ─────────────────────────────
  const sc = D.screen;
  // pushed forward so the top of the tilted screen stays in front of the fascia face
  const disp = part(ctx, 'display', svc.inner, [sc.cx, sc.cy, D.door.face + 0.022]);
  disp.rotation.x = sc.tilt;
  const bezelShape = rectShape(0, 0, 0.372, 0.296, 0.012);
  bezelShape.holes.push(holeRect(0, 0.004, sc.w + 0.004, sc.h + 0.004, 0.002));
  mesh(extrudeXY(bezelShape, 0.024, 0.003), m.satinBlack, disp, [0, 0, 0]);
  mesh(box(sc.w + 0.012, sc.h + 0.012, 0.004), m.throatDark, disp, [0, 0.004, 0.009]);
  // the screen: self-lit plane, UV 0..1 across the visible area
  const scrCanvas = makeCanvas(1024, 768).canvas;
  {
    const c = scrCanvas.getContext('2d')!;
    const g = c.createLinearGradient(0, 0, 0, 768);
    g.addColorStop(0, '#103457');
    g.addColorStop(1, '#0a1c30');
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 768);
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.font = `800 76px ${FONT}`;
    c.fillText('MERIDIAN TRAINING BANK', 512, 300);
    c.font = `500 44px ${FONT}`;
    c.fillStyle = '#bfe7ee';
    c.fillText('Welcome — please insert or tap your card', 512, 400);
    c.font = `500 30px ${FONT}`;
    c.fillStyle = '#7f9bb3';
    c.fillText('Training simulator · fictional bank & currency', 512, 690);
  }
  const scrTex = tex(scrCanvas);
  const screenMat = own(new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
  const screenMesh = mesh(new THREE.PlaneGeometry(sc.w, sc.h), screenMat, disp, [0, 0.004, 0.0115]);
  screenMesh.name = 'atm-screen';
  dyn(screenMesh);
  // monitor back housing (inside the door)
  mesh(rbox(0.35, 0.27, 0.06, 0.01), m.darkMetal, disp, [0, 0.004, -0.045]);
  // privacy hood: top + tapered sides
  mesh(rbox(0.384, 0.008, 0.07, 0.003), m.blackPlastic, disp, [0, 0.152, 0.057]);
  const hoodSide = extrudeProfileX(
    [
      [0.016, -0.148],
      [0.034, -0.148],
      [0.092, 0.156],
      [0.016, 0.156],
    ],
    0.008,
    0.0015,
  );
  for (const sx of [-1, 1]) mesh(hoodSide, m.blackPlastic, disp, [sx * 0.188, 0, 0]);
  label(ctx, disp, { w: 256, h: 32, bg: null, lines: [{ text: 'MERIDIAN', size: 24, weight: '800', color: '#8c97a2', y: 0.55, letterSpacing: 6 }] }, [0.07, 0.009], [0, -0.135, 0.0242]);

  // ───────────────────────────── keypad ─────────────────────────────
  const slopeAng = Math.atan2(dk.yBackTop - dk.yFrontTop, dk.zFront - dk.zBack);
  const kpT = 0.5;
  const kpZ = dk.zFront + (dk.zBack - dk.zFront) * kpT;
  const kpY = dk.yFrontTop + (dk.yBackTop - dk.yFrontTop) * kpT;
  const kpPart = part(ctx, 'keypad', svc.inner, [D.keypad.x, kpY, kpZ]);
  kpPart.rotation.x = -(Math.PI / 2 - slopeAng);
  const kp = buildKeypad(m);
  kpPart.add(kp.group);
  ctx.ownedTextures.push(...kp.textures);
  ctx.ownedMaterials.push(...kp.materials);

  // ───────────────────────────── card reader bezel ─────────────────────────────
  const cr = part(ctx, 'card-reader', svc.inner, [D.rightCol, D.card.y, D.door.face]);
  mesh(rbox(0.106, 0.064, 0.026, 0.009), m.brushedAlu, cr, [0, 0, 0.013]);
  mesh(extrudeProfileX([[0.0, -0.025], [0.04, -0.011], [0.04, 0.015], [0.0, 0.027]], 0.094, 0.002), m.satinBlack, cr, [0, 0, 0]);
  ledMesh(ctx, rbox(0.078, 0.02, 0.003, 0.003), cr, [0, 0.002, 0.0428], 0x22dd66, 'card');
  mesh(box(0.068, 0.0075, 0.003), m.throatDark, cr, [0, 0.002, 0.0444]);
  label(
    ctx,
    cr,
    {
      w: 256,
      h: 48,
      bg: null,
      lines: [{ text: 'INSERT CARD ▾', size: 30, weight: '800', color: '#e6e9ec', y: 0.55 }],
    },
    [0.08, 0.015],
    [0, 0.044, 0.0006],
  );
  anchor(ctx, 'cardSlot', cr, [D.rightCol, D.card.y + 0.002, D.door.face + 0.046]);

  // ───────────────────────────── contactless ─────────────────────────────
  const cl = part(ctx, 'contactless-reader', svc.inner, [D.rightCol, D.contactless.y, D.door.face]);
  mesh(rbox(0.096, 0.088, 0.014, 0.008), m.satinBlack, cl, [0, 0, 0.007]);
  const clTex = tex(contactlessCanvas());
  const clMat = own(new THREE.MeshStandardMaterial({ map: clTex, emissive: 0xffffff, emissiveMap: clTex, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1 }));
  mesh(new THREE.PlaneGeometry(0.07, 0.07), clMat, cl, [0, -0.004, 0.0142]);
  ledMesh(ctx, rbox(0.05, 0.004, 0.002, 0.0015), cl, [0, 0.036, 0.0142], 0x22dd66, 'contactless');
  anchor(ctx, 'contactless', cl, [D.rightCol, D.contactless.y, D.door.face + 0.05]);

  // ───────────────────────────── receipt slot ─────────────────────────────
  const rs = part(ctx, 'receipt-slot', svc.inner, [D.rightCol, D.receipt.y, D.door.face]);
  mesh(rbox(0.106, 0.034, 0.022, 0.007), m.brushedAlu, rs, [0, 0, 0.011]);
  mesh(box(0.088, 0.004, 0.003), m.throatDark, rs, [0, -0.003, 0.0215]);
  ledMesh(ctx, box(0.07, 0.003, 0.002), rs, [0, 0.009, 0.0222], 0x22dd66, 'receipt');
  label(ctx, rs, { w: 256, h: 40, bg: null, lines: [{ text: 'RECEIPT', size: 28, weight: '800', color: '#d5dade', y: 0.55 }] }, [0.05, 0.008], [0, -0.025, 0.0006]);
  anchor(ctx, 'receiptSlot', rs, [D.rightCol, D.receipt.y - 0.003, D.door.face + 0.022]);

  // ───────────────────────────── speakers ─────────────────────────────
  const sp = part(ctx, 'speakers', svc.inner);
  const grTex = tex(grilleCanvas());
  const grMat = own(new THREE.MeshStandardMaterial({ map: grTex, metalness: 0.8, roughness: 0.35 }));
  for (const x of [D.leftCol, D.rightCol]) {
    mesh(cylZ(0.04, 0.006, 32), m.satinBlack, sp, [x, D.speakerY, D.door.face + 0.003]);
    mesh(new THREE.CircleGeometry(0.035, 32), grMat, sp, [x, D.speakerY, D.door.face + 0.0062]);
  }

  // ───────────────────────────── camera ─────────────────────────────
  const camY = 1.548;
  const cam = part(ctx, 'camera', svc.inner, [0, camY, D.door.face]);
  mesh(rbox(0.11, 0.034, 0.02, 0.014), m.satinBlack, cam, [0, 0, 0.01]);
  mesh(cylZ(0.011, 0.006, 24), m.chrome, cam, [0, 0, 0.021]);
  mesh(new THREE.SphereGeometry(0.0085, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), m.lens, cam, [0, 0, 0.0235]);
  for (const x of [-0.03, 0.03]) mesh(cylZ(0.0035, 0.002, 12), own(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x550000, emissiveIntensity: 0.6, roughness: 0.2 })), cam, [x, 0, 0.0205]);
  label(ctx, cam, { w: 256, h: 32, bg: null, lines: [{ text: 'CCTV IN OPERATION', size: 22, weight: '700', color: '#7c8792', y: 0.55 }] }, [0.07, 0.009], [0, -0.03, 0.0006]);

  // header wordmark (left)
  label(
    ctx,
    sd,
    { w: 512, h: 64, bg: null, lines: [{ text: 'MERIDIAN TRAINING BANK', size: 34, weight: '800', color: '#d8dee4', y: 0.55, letterSpacing: 2 }] },
    [0.17, 0.021],
    [-0.205, camY, D.door.face + 0.0006],
  );

  // ───────────────────────────── status LEDs ─────────────────────────────
  const st = part(ctx, 'status-leds', svc.inner, [0.205, camY, D.door.face]);
  mesh(rbox(0.09, 0.022, 0.006, 0.004), m.satinBlack, st, [0, 0, 0.003]);
  const ledGeo = cylZ(0.0035, 0.003, 14);
  ledMesh(ctx, ledGeo, st, [-0.028, 0.0, 0.0065], 0x22dd66, 'status');
  ledMesh(ctx, ledGeo, st, [-0.01, 0.0, 0.0065], 0x2a7fff, null, 1.6);
  ledMesh(ctx, ledGeo, st, [0.008, 0.0, 0.0065], 0xffaa22, null, 0.15);
  label(ctx, st, { w: 128, h: 32, bg: null, lines: [{ text: 'PWR NET SVC', size: 16, weight: '700', color: '#7c8792', y: 0.55 }] }, [0.04, 0.008], [0.025, 0, 0.0062]);

  // ───────────────────────────── accessibility ─────────────────────────────
  const acc = part(ctx, 'accessibility', svc.inner, [D.leftCol, 0, D.door.face]);
  // headphone jack with tactile ring
  const jackY = 1.13;
  mesh(cylZ(0.016, 0.006, 28), m.brushedAlu, acc, [0, jackY, 0.003]);
  mesh(new THREE.TorusGeometry(0.0115, 0.0016, 8, 28), m.brushedSteel, acc, [0, jackY, 0.0062]);
  mesh(cylZ(0.0042, 0.002, 16), m.throatDark, acc, [0, jackY, 0.0062]);
  label(ctx, acc, { w: 256, h: 40, bg: null, lines: [{ text: '🎧 AUDIO', size: 26, weight: '800', color: '#d5dade', y: 0.55 }] }, [0.05, 0.008], [0, jackY - 0.025, 0.0006]);
  // braille / tactile plate
  const plateY = 1.195;
  mesh(rbox(0.084, 0.03, 0.003, 0.002), m.brushedSteel, acc, [0, plateY, 0.0015]);
  label(ctx, acc, { w: 512, h: 64, bg: null, lines: [{ text: 'AUDIO GUIDANCE · PLUG IN HEADPHONES', size: 24, weight: '800', color: '#202326', y: 0.5 }] }, [0.078, 0.0095], [0, plateY + 0.008, 0.0031]);
  {
    // Fictional tactile dot pattern (decorative braille-style cells)
    const cells = ['100000', '101000', '110000', '100110', '010100', '101010', '000000', '110110', '100100', '111010'];
    const dots: V3[] = [];
    cells.forEach((c, i) => {
      for (let k = 0; k < 6; k++) {
        if (c[k] !== '1') continue;
        const col = k < 3 ? 0 : 1;
        const row = k % 3;
        dots.push([-0.036 + i * 0.008 + col * 0.0025, plateY - 0.0025 - row * 0.0025, 0.003]);
      }
    });
    instancedDots(acc, 0.0008, dots, m.brushedSteel).userData.componentId = 'accessibility';
  }

  // card rest: on the wallet shelf, right of the keypad
  const cardRest = {
    position: new THREE.Vector3(0.258, dk.shelfTop + 0.0058, 0.474),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.1)),
  };

  // ───────────────────────────── cash slot (fixed fascia band) ─────────────────────────────
  const cs = part(ctx, 'cash-slot', root, [D.dispX, D.cash.y, D.front]);
  const csShape = rectShape(0, 0, 0.255, 0.068, 0.012);
  csShape.holes.push(holeRect(0, 0, 0.206, 0.038, 0.006));
  mesh(extrudeXY(csShape, 0.02, 0.003), m.brushedAlu, cs, [0, 0, 0]);
  // throat sleeve
  for (const [w, h, x, y] of [
    [0.206, 0.003, 0, 0.0175],
    [0.206, 0.003, 0, -0.0175],
    [0.003, 0.038, 0.1015, 0],
    [0.003, 0.038, -0.1015, 0],
  ] as Array<[number, number, number, number]>) {
    mesh(box(w, h, 0.05), m.throatDark, cs, [x, y, -0.012]);
  }
  ledMesh(ctx, box(0.17, 0.0035, 0.002), cs, [0, 0.026, 0.0205], 0x22dd66, 'cash');
  label(ctx, cs, { w: 256, h: 40, bg: null, lines: [{ text: 'CASH', size: 28, weight: '800', color: '#d5dade', y: 0.55 }] }, [0.05, 0.008], [0, 0.048, 0.0006]);

  // ───────────────────────────── deposit slot ─────────────────────────────
  const ds = part(ctx, 'deposit-slot', root, [D.depX, D.cash.y, D.front]);
  const dsShape = rectShape(0, 0, 0.21, 0.056, 0.01);
  dsShape.holes.push(holeRect(0, 0, 0.176, 0.024, 0.005));
  mesh(extrudeXY(dsShape, 0.018, 0.003), m.brushedAlu, ds, [0, 0, 0]);
  for (const [w, h, x, y] of [
    [0.176, 0.003, 0, 0.0105],
    [0.176, 0.003, 0, -0.0105],
  ] as Array<[number, number, number, number]>) {
    mesh(box(w, h, 0.05), m.throatDark, ds, [x, y, -0.014]);
  }
  ledMesh(ctx, box(0.15, 0.0035, 0.002), ds, [0, 0.0205, 0.0185], 0x22dd66, 'deposit');
  label(ctx, ds, { w: 384, h: 40, bg: null, lines: [{ text: 'DEPOSIT · NOTES ONLY', size: 26, weight: '800', color: '#d5dade', y: 0.55 }] }, [0.09, 0.0094], [0, 0.043, 0.0006]);
  anchor(ctx, 'depositSlot', ds, [D.depX, D.cash.y, D.front + 0.03]);

  // ───────────────────────────── vault door ─────────────────────────────
  const vd = D.vaultDoor;
  const vlt = makeDoor(root, [vd.x0 - 0.002, 0, vd.z1 + 0.004], (105 * Math.PI) / 180, 'vault-door');
  const vp = part(ctx, 'vault-door', vlt.inner);
  const vW = vd.x1 - vd.x0;
  const vH = vd.y1 - vd.y0;
  const vCy = (vd.y0 + vd.y1) / 2;
  shellMesh(ctx, mesh(rbox(vW, vH, vd.z1 - vd.z0, 0.006), s.vaultPaint, vp, [0, vCy, (vd.z0 + vd.z1) / 2]), true).name = 'vault-door-slab';
  shellMesh(ctx, mesh(rbox(vW - 0.07, vH - 0.07, 0.006, 0.004), s.vaultPaint, vp, [0, vCy, vd.z1 + 0.001]));
  // handle (chrome lever on a rose)
  const hx = 0.2;
  const hy = 0.47;
  mesh(cylZ(0.034, 0.012, 32), m.chrome, vp, [hx, hy, vd.z1 + 0.006]);
  mesh(cylZ(0.014, 0.03, 20), m.chrome, vp, [hx, hy, vd.z1 + 0.025]);
  mesh(rbox(0.15, 0.024, 0.018, 0.009), m.chrome, vp, [hx - 0.045, hy, vd.z1 + 0.04]);
  mesh(new THREE.SphereGeometry(0.016, 16, 12), m.chrome, vp, [hx - 0.12, hy, vd.z1 + 0.04]);
  // electronic lock: generic keypad + small display
  const lk = group(vp, [hx, 0.65, vd.z1]);
  mesh(rbox(0.084, 0.112, 0.022, 0.01), m.satinBlack, lk, [0, 0, 0.011]);
  const lcd = labelMaterialMesh(ctx, lk, '#0b2a1a', '#58f08a', '- - - - - -', [0.06, 0.016], [0, 0.034, 0.0222]);
  lcd.userData.dynamic = true;
  const lkKeys: V3[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) lkKeys.push([-0.02 + c * 0.02, 0.01 - r * 0.0155, 0.0235]);
  instancedBoxes(lk, [0.015, 0.011, 0.004], lkKeys, m.greyPlastic).userData.componentId = 'vault-door';
  label(ctx, vp, { w: 256, h: 32, bg: null, lines: [{ text: 'ELECTRONIC LOCK', size: 22, weight: '800', color: '#2a2e33', y: 0.55 }] }, [0.07, 0.009], [hx, 0.578, vd.z1 + 0.0042]);
  label(
    ctx,
    vp,
    {
      w: 512,
      h: 192,
      bg: '#f2c230',
      border: { color: '#141414', width: 10 },
      lines: [
        { text: 'TRAINING SAFE', size: 52, weight: '900', color: '#141414', y: 0.33 },
        { text: 'Contents: fictional training notes', size: 28, weight: '600', color: '#141414', y: 0.66 },
      ],
    },
    [0.16, 0.06],
    [-0.13, 0.72, vd.z1 + 0.0042],
  );
  label(ctx, vp, { w: 512, h: 64, bg: null, lines: [{ text: 'MERIDIAN · SECURE CASH MODULE', size: 28, weight: '800', color: '#3e444b', y: 0.55, letterSpacing: 3 }] }, [0.24, 0.03], [-0.07, 0.15, vd.z1 + 0.0042]);
  // inner side: bolt-work cover + bolts into the right wall
  shellMesh(ctx, mesh(box(vW - 0.06, vH - 0.06, 0.008), s.vaultInner, vp, [0, vCy, vd.z0 - 0.004]));
  for (const y of [0.22, 0.454, 0.69]) mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 16).rotateZ(Math.PI / 2), m.chrome, vp, [vd.x1 - 0.02, y, vd.z0 + 0.012]);
  fasteners(vp, [0.24, -0.24].flatMap((x) => [0.2, 0.454, 0.7].map((y) => [x, y, vd.z0 - 0.008] as V3)), [0, 0, -1], m.zinc, 0.006, 'vault-door');

  // ───────────────────────────── locks & hinges (fixed on the cabinet) ─────────────────────────────
  const lh = part(ctx, 'locks-hinges', root);
  for (const y of [0.2, 0.7]) {
    mesh(cylY(0.0125, 0.12, 20), m.chrome, lh, [vd.x0 - 0.002, y, vd.z1 + 0.004]);
    mesh(cylY(0.0145, 0.008, 20), m.darkMetal, lh, [vd.x0 - 0.002, y + 0.064, vd.z1 + 0.004]);
    mesh(box(0.012, 0.1, 0.004), m.darkMetal, lh, [vd.x0 + 0.01, y, vd.z1 + 0.002]);
  }
  for (const y of [1.16, 1.52]) {
    mesh(cylY(0.0065, 0.07, 16), m.chrome, lh, [-D.skinIn + 0.002, y, D.front + 0.003]);
  }
  // service door lock cylinder on the right cheek
  mesh(cylZ(0.0085, 0.008, 20), m.chrome, lh, [0.3475, 1.5, D.front + 0.004]);
  mesh(box(0.0022, 0.009, 0.002), m.throatDark, lh, [0.3475, 1.5, D.front + 0.0085]);
  // vault-door bolt receivers (right wall, inner front)
  for (const y of [0.22, 0.454, 0.69]) mesh(rbox(0.03, 0.04, 0.03, 0.004), m.darkMetal, lh, [D.safeWallIn + 0.006, y, D.safeFrontIn - 0.012]);

  // keypad keys map
  const keys = kp.keys;

  return {
    doors: { service: svc.door, vault: vlt.door },
    serviceInner: svc.inner,
    vaultInner: vlt.inner,
    screenMesh,
    keys,
    cardRest,
  };
}

function labelMaterialMesh(ctx: BuildCtx, parent: THREE.Object3D, bg: string, fg: string, text: string, size: [number, number], pos: V3): THREE.Mesh {
  const lm = label(
    ctx,
    parent,
    { w: 256, h: 64, bg, lines: [{ text, size: 36, weight: '700', color: fg, y: 0.55, font: "'DejaVu Sans Mono', monospace" }] },
    size,
    pos,
    undefined,
    { emissive: 0xffffff, emissiveIntensity: 0.6 },
  );
  const mat = lm.material as THREE.MeshStandardMaterial;
  mat.emissiveMap = mat.map;
  return lm;
}
