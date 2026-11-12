import * as THREE from 'three';
import type { CassetteId, Denomination } from '../core/types';
import { anchor, label, ledMesh, part, shellMesh, spinner, type BuildCtx, type MotorGroup } from './context';
import { D } from './dims';
import { BRAND, makeCanvas, mulberry32 } from './materials';
import { NOTE_H, NOTE_W, noteMaterial, NOTE_STYLE } from './notes';
import { box, cylX, cylY, cylZ, dyn, extrudeShapeX, extrudeShapeY, fasteners, group, holeCircle, holeRect, instancedBoxes, mesh, rbox, ribbonGeometry, type V3 } from './util';

export interface InternalsBuild {
  /** Objects that jitter slightly while the dispenser runs. */
  vibrationTargets: THREE.Object3D[];
}

const X = new THREE.Vector3(1, 0, 0);

/** Sample a curve and offset each point along the "up" normal (tangent × X). */
function offsetSamples(curve: THREE.Curve<THREE.Vector3>, n: number, off: number, xOff = 0, t0 = 0, t1 = 1): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const nrm = new THREE.Vector3().crossVectors(tan, X).normalize();
    pts.push(p.addScaledVector(nrm, off).add(new THREE.Vector3(xOff, 0, 0)));
  }
  return pts;
}

/** Transport waypoints (world): picker exits → vertical belts up the back → stacker entry. */
export const TRANSPORT_POINTS: V3[] = [
  [D.dispX, 0.16, D.transportZ],
  [D.dispX, 0.4, D.transportZ],
  [D.dispX, 0.6, D.transportZ],
  [D.dispX, 0.67, D.transportZ],
  [D.dispX, 0.718, -0.268],
  [D.dispX, 0.752, -0.24],
  [D.dispX, 0.768, -0.2],
  [D.dispX, 0.772, -0.165],
];

/** Presenter path (bundle centre): stacker → belts forward and up → just behind the shutter. */
export const PRESENTER_POINTS: V3[] = [
  [D.dispX, D.stacker.y, D.stacker.z],
  [D.dispX, D.stacker.y, 0.06],
  [D.dispX, 0.712, 0.17],
  [D.dispX, 0.76, 0.255],
  [D.dispX, 0.83, 0.31],
  [D.dispX, 0.893, 0.358],
  [D.dispX, D.cash.y, 0.392],
];

const toV = (p: V3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

export function buildInternals(ctx: BuildCtx, denoms: Record<CassetteId, Denomination>): InternalsBuild {
  const { m, s, root } = ctx;
  const own = <T extends THREE.Material>(mat: T): T => {
    ctx.ownedMaterials.push(mat);
    return mat;
  };
  const vibrationTargets: THREE.Object3D[] = [];
  const zincDS = own(m.zinc.clone());
  zincDS.side = THREE.DoubleSide;
  const beltDS = own(m.belt.clone());
  beltDS.side = THREE.DoubleSide;
  const presBeltDS = own(m.presenterBelt.clone());
  presBeltDS.side = THREE.DoubleSide;
  ctx.belts.transport.push(beltDS.map!);
  ctx.belts.presenter.push(presBeltDS.map!);

  // stack-edge texture rotated for the side faces of standing stacks
  const sideEdgeTex = m.noteStackEdge.map!.clone();
  sideEdgeTex.rotation = Math.PI / 2;
  sideEdgeTex.center.set(0.5, 0.5);
  sideEdgeTex.repeat.set(1, 6);
  ctx.ownedTextures.push(sideEdgeTex);
  const stackSide = own(new THREE.MeshStandardMaterial({ map: sideEdgeTex, roughness: 0.9 }));

  // ───────────────────────────── safe body ─────────────────────────────
  const safe = part(ctx, 'safe', root);
  const wallH = D.safeTop - D.plinthH;
  const wallD = D.safeFrontIn - (D.back + 0.007);
  const wallZ = (D.safeFrontIn + D.back + 0.007) / 2;
  for (const sx of [-1, 1]) {
    shellMesh(ctx, mesh(box(D.skinIn - D.safeWallIn, wallH, wallD), s.safeWall, safe, [sx * (D.safeWallIn + D.skinIn) / 2, D.plinthH + wallH / 2, wallZ]));
  }
  shellMesh(ctx, mesh(box(D.safeWallIn * 2, D.safeFloorTop - D.plinthH, wallD), s.safeWall, safe, [0, (D.safeFloorTop + D.plinthH) / 2, wallZ]));
  shellMesh(ctx, mesh(box(D.safeWallIn * 2, D.safeCeilBottom - D.safeFloorTop, D.safeBackIn - (D.back + 0.007)), s.safeWall, safe, [0, (D.safeCeilBottom + D.safeFloorTop) / 2, (D.safeBackIn + D.back + 0.007) / 2]));
  // ceiling with openings for the presenter throat and the deposit chute
  const ceil = new THREE.Shape();
  ceil.moveTo(-D.safeWallIn, D.back + 0.007);
  ceil.lineTo(D.safeWallIn, D.back + 0.007);
  ceil.lineTo(D.safeWallIn, D.safeFrontIn);
  ceil.lineTo(-D.safeWallIn, D.safeFrontIn);
  ceil.lineTo(-D.safeWallIn, D.back + 0.007);
  ceil.holes.push(holeRect(D.dispX, 0.3, 0.23, 0.11));
  ceil.holes.push(holeRect(D.depX, 0.0, 0.2, 0.1));
  const ceilMesh = shellMesh(ctx, mesh(extrudeShapeY(ceil, D.safeTop - D.safeCeilBottom), s.safeWall, safe, [0, D.safeTop, 0]));
  ceilMesh.name = 'safe-ceiling';
  // front frame lip (visible around the open door)
  for (const sx of [-1, 1]) mesh(box(0.012, wallH - 0.02, 0.01), m.darkMetal, safe, [sx * (D.safeWallIn + 0.006), D.plinthH + wallH / 2, D.safeFrontIn - 0.005]);
  fasteners(safe, [-0.2, -0.05, 0.1, 0.22].map((x) => [x, D.safeFloorTop + 0.0005, -0.33] as V3), [0, 1, 0], m.zinc, 0.008, 'safe');

  // ───────────────────────────── dispenser frame ─────────────────────────────
  const disp = part(ctx, 'dispenser', root);
  const dispShake = group(disp, [0, 0, 0], 'dispenser-shake');
  vibrationTargets.push(dispShake);
  const plateShape = new THREE.Shape();
  const pz0 = -0.365;
  const pz1 = 0.3;
  const py0 = D.cassette.y.reject - 0.004;
  const py1 = 0.79;
  plateShape.moveTo(pz0, py0);
  plateShape.lineTo(pz1, py0);
  plateShape.lineTo(pz1, py0 + 0.03);
  plateShape.lineTo(pz1 - 0.42, py0 + 0.03);
  plateShape.lineTo(pz1 - 0.42, py1 - 0.03);
  plateShape.lineTo(pz1, py1 - 0.03);
  plateShape.lineTo(pz1, py1);
  plateShape.lineTo(pz0, py1);
  plateShape.lineTo(pz0, py0);
  // big service window over the transport/picker area so the note path is visible from the side
  plateShape.holes.push(holeRect(-0.245, 0.445, 0.2, 0.6, 0.03));
  const plateGeo = extrudeShapeX(plateShape, 0.005);
  for (const x of [0.016, 0.254]) mesh(plateGeo, m.frameGrey, dispShake, [x, 0, 0]);
  // cross members + cassette rails
  for (const [y, z] of [
    [py0 + 0.01, -0.36],
    [py1 - 0.01, -0.36],
    [py1 - 0.01, 0.29],
    [0.43, -0.36],
  ] as Array<[number, number]>) {
    mesh(box(0.236, 0.012, 0.012), m.darkMetal, dispShake, [D.dispX, y, z]);
  }
  for (const id of ['reject', 'C', 'B', 'A'] as const) {
    const y = D.cassette.y[id];
    for (const x of [0.021, 0.249]) mesh(box(0.006, 0.004, 0.52), m.zinc, dispShake, [x, y - 0.002, 0.03]);
  }
  // drive motor + gearbox (bottom rear) and timing belt on the right plate
  mesh(cylX(0.026, 0.09, 24), m.darkMetal, dispShake, [D.dispX - 0.04, 0.14, -0.335]);
  mesh(rbox(0.05, 0.06, 0.06, 0.006), m.frameGrey, dispShake, [D.dispX + 0.04, 0.14, -0.335]);
  label(ctx, dispShake, { w: 256, h: 64, bg: '#e7e7e2', lines: [{ text: 'DRIVE 24V', size: 30, weight: '800', color: '#222', y: 0.55 }] }, [0.04, 0.01], [D.dispX + 0.04, 0.14, -0.3045]);
  for (const [y, z, r] of [
    [0.14, -0.335, 0.022],
    [0.672, -0.29, 0.016],
    [0.74, -0.175, 0.018],
    [0.47, -0.3, 0.012],
  ] as Array<[number, number, number]>) {
    spinner(ctx, 'transport', mesh(cylX(r, 0.008, 24), m.brass, dispShake, [0.264, y, z]), 8);
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.264, 0.162, -0.335), new THREE.Vector3(0.264, 0.66, -0.305), new THREE.Vector3(0.264, 0.756, -0.18), new THREE.Vector3(0.264, 0.72, -0.16), new THREE.Vector3(0.264, 0.66, -0.275), new THREE.Vector3(0.264, 0.118, -0.335)], true), 64, 0.002, 4, true), m.rubber, dispShake);
  // dispenser control board on the right plate
  mesh(box(0.003, 0.09, 0.14), m.pcb, dispShake, [0.2595, 0.27, 0.05]);
  instancedBoxes(dispShake, [0.003, 0.012, 0.016], [[0.2615, 0.29, 0.02], [0.2615, 0.26, 0.06], [0.2615, 0.29, 0.09], [0.2615, 0.25, 0.0]], m.satinBlack).userData.componentId = 'dispenser';
  label(ctx, dispShake, { w: 512, h: 96, bg: '#d9dcdf', border: { color: '#333', width: 4 }, lines: [{ text: 'CASH DISPENSER', size: 40, weight: '800', color: '#1a1a1a', y: 0.38 }, { text: 'generic · training model', size: 26, weight: '500', color: '#333', y: 0.75 }] }, [0.1, 0.019], [D.dispX, py1 - 0.01, 0.2965]);

  // ───────────────────────────── cassettes ─────────────────────────────
  const C = D.cassette;
  const cw = C.x1 - C.x0;
  const cd = C.z1 - C.z0;
  const cz = (C.z0 + C.z1) / 2;
  const stackRearZ = C.z0 + 0.008;
  const STACK_MAX = 0.4;
  const stackGeo = new THREE.BoxGeometry(NOTE_W, NOTE_H, 1);
  stackGeo.translate(0, 0, 0.5);

  const cassetteFrontCanvas = (title: string, sub: string, color: string): HTMLCanvasElement => {
    const { canvas, ctx: c } = makeCanvas(512, 224);
    c.fillStyle = '#2c3138';
    c.fillRect(0, 0, 512, 224);
    c.fillStyle = color;
    c.fillRect(0, 0, 512, 16);
    c.fillStyle = '#ffffff';
    c.font = "800 92px 'Inter', Arial, sans-serif";
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText(title, 26, 106);
    c.font = "700 30px 'Inter', Arial, sans-serif";
    c.fillText(sub, 150, 84);
    c.font = "500 22px 'Inter', Arial, sans-serif";
    c.fillStyle = '#aab3bc';
    c.fillText('TRAINING NOTES ONLY', 150, 126);
    // barcode-ish strip
    const rnd = mulberry32(title.charCodeAt(0));
    c.fillStyle = '#e8e8e8';
    c.fillRect(150, 150, 220, 46);
    c.fillStyle = '#111';
    for (let x = 156; x < 364; x += 2 + Math.floor(rnd() * 4)) c.fillRect(x, 154, 1 + Math.floor(rnd() * 2), 38);
    return canvas;
  };

  const buildCassette = (id: CassetteId | 'reject'): THREE.Group => {
    const y0 = C.y[id];
    const isReject = id === 'reject';
    const g = part(ctx, isReject ? 'reject-cassette' : `cassette-${id}`, root);
    const body = isReject ? m.rejectBody : m.cassetteBody;
    mesh(box(cw, 0.006, cd), body, g, [D.dispX, y0 + 0.003, cz]);
    for (const x of [C.x0 + 0.003, C.x1 - 0.003]) mesh(box(0.006, C.h, cd), body, g, [x, y0 + C.h / 2, cz]);
    mesh(box(cw, 0.032, 0.006), body, g, [D.dispX, y0 + 0.016, C.z0 + 0.003]);
    // top: metal side strips + clear window, open at the rear (pick opening)
    const topZ0 = C.z0 + 0.055;
    const topD = C.z1 - topZ0;
    for (const x of [C.x0 + 0.025, C.x1 - 0.025]) mesh(box(0.05, 0.004, topD), body, g, [x, y0 + C.h - 0.002, topZ0 + topD / 2]);
    mesh(box(cw - 0.1, 0.003, topD), m.smokedClear, g, [D.dispX, y0 + C.h - 0.002, topZ0 + topD / 2]);
    // front face + handle + label
    mesh(rbox(cw + 0.004, C.h, 0.022, 0.004), body, g, [D.dispX, y0 + C.h / 2, C.z1 - 0.011]);
    const fc = cassetteFrontCanvas(isReject ? 'R' : id, isReject ? 'REJECT CASSETTE' : `CASSETTE ${id} · $${denoms[id as CassetteId]}`, isReject ? '#c0392b' : NOTE_STYLE[denoms[id as CassetteId]].base);
    const ft = new THREE.CanvasTexture(fc);
    ft.colorSpace = THREE.SRGBColorSpace;
    ft.anisotropy = 8;
    ctx.ownedTextures.push(ft);
    mesh(new THREE.PlaneGeometry(0.15, 0.0656), own(new THREE.MeshStandardMaterial({ map: ft, roughness: 0.5 })), g, [D.dispX - 0.025, y0 + C.h / 2, C.z1 + 0.0006]);
    mesh(rbox(0.016, 0.06, 0.014, 0.005), m.chrome, g, [C.x1 - 0.026, y0 + C.h / 2, C.z1 + 0.007]);
    mesh(cylZ(0.006, 0.006, 14), m.yellowPaint, g, [C.x1 - 0.026, y0 + C.h - 0.012, C.z1 + 0.003]);
    // guide rod for the pusher
    if (!isReject) mesh(cylZ(0.004, cd - 0.04, 10), m.chrome, g, [D.dispX, y0 + 0.012, cz]);

    if (!isReject) {
      const cid = id as CassetteId;
      const stack = new THREE.Mesh(stackGeo, [stackSide, stackSide, m.noteStackEdge, m.noteStackEdge, m.noteStackEdge, noteMaterial(denoms[cid])]);
      stack.position.set(D.dispX, y0 + 0.006 + NOTE_H / 2, stackRearZ);
      stack.name = `stack-${cid}`;
      dyn(stack);
      g.add(stack);
      const pusher = mesh(rbox(0.17, 0.078, 0.008, 0.003), m.lightPlastic, g, [D.dispX, y0 + 0.006 + 0.039, stackRearZ]);
      dyn(pusher);
      ctx.fills[cid] = { stack, axis: 'z', max: STACK_MAX, pusher, pusherBase: stackRearZ + 0.004, min: 0.0005 };
      anchor(ctx, `pick-${cid}`, g, [D.dispX, y0 + 0.006 + NOTE_H, stackRearZ + 0.001]);
    } else {
      const pile = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.11).translate(0, 0.5, 0), [stackSide, stackSide, m.noteStackEdge, m.noteStackEdge, stackSide, stackSide]);
      pile.position.set(D.dispX, y0 + 0.006, C.z0 + 0.07);
      pile.name = 'stack-reject';
      dyn(pile);
      g.add(pile);
      ctx.fills.reject = { stack: pile, axis: 'y', max: 0.075, min: 0.0005 };
      anchor(ctx, 'rejectEntry', g, [D.dispX, y0 + C.h - 0.004, C.z0 + 0.03]);
    }
    return g;
  };
  buildCassette('reject');
  for (const id of ['C', 'B', 'A'] as CassetteId[]) buildCassette(id);

  // ───────────────────────────── retract bin ─────────────────────────────
  const R = D.retract;
  const rb = part(ctx, 'retract-bin', root);
  const rw = cw;
  const rd = R.z1 - R.z0;
  const rh = R.y1 - R.y0;
  mesh(box(rw, 0.005, rd), m.rejectBody, rb, [D.dispX, R.y0 + 0.0025, (R.z0 + R.z1) / 2]);
  for (const x of [C.x0 + 0.003, C.x1 - 0.003]) mesh(box(0.006, rh, rd), m.rejectBody, rb, [x, R.y0 + rh / 2, (R.z0 + R.z1) / 2]);
  mesh(box(rw, rh, 0.006), m.rejectBody, rb, [D.dispX, R.y0 + rh / 2, R.z0 + 0.003]);
  mesh(rbox(rw + 0.004, rh, 0.02, 0.004), m.rejectBody, rb, [D.dispX, R.y0 + rh / 2, R.z1 - 0.01]);
  // lid with entry flap opening near the presenter
  mesh(box(rw, 0.004, 0.1), m.rejectBody, rb, [D.dispX, R.y1 - 0.002, R.z0 + 0.05]);
  mesh(box(rw, 0.004, 0.06), m.rejectBody, rb, [D.dispX, R.y1 - 0.002, R.z1 - 0.03]);
  mesh(box(rw - 0.03, 0.002, 0.03), m.darkMetal, rb, [D.dispX, R.y1 + 0.004, 0.08], [0.6, 0, 0]);
  label(ctx, rb, { w: 512, h: 96, bg: '#5a2e2e', lines: [{ text: 'RETRACT BIN', size: 46, weight: '800', color: '#fff', y: 0.38 }, { text: 'uncollected cash', size: 26, weight: '500', color: '#f1c6c6', y: 0.75 }] }, [0.12, 0.0225], [D.dispX - 0.02, R.y0 + rh / 2, R.z1 + 0.0006]);
  mesh(rbox(0.016, 0.04, 0.014, 0.005), m.chrome, rb, [C.x1 - 0.026, R.y0 + rh / 2, R.z1 + 0.007]);
  {
    const pile = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.08).translate(0, 0.5, 0), [stackSide, stackSide, m.noteStackEdge, m.noteStackEdge, stackSide, stackSide]);
    pile.position.set(D.dispX, R.y0 + 0.005, 0.17);
    pile.name = 'stack-retract';
    dyn(pile);
    rb.add(pile);
    ctx.fills.retract = { stack: pile, axis: 'y', max: 0.05, min: 0.0005 };
  }
  anchor(ctx, 'retractEntry', rb, [D.dispX, R.y1 + 0.004, 0.16]);

  // ───────────────────────────── picker rollers ─────────────────────────────
  const pk = part(ctx, 'picker-rollers', root);
  const pkShake = group(pk, [0, 0, 0], 'picker-shake');
  vibrationTargets.push(pkShake);
  const tyre = cylX(0.011, 0.018, 20);
  const counter = cylX(0.008, 0.016, 16);
  const shaft = cylX(0.0025, 0.226, 8);
  for (const id of ['A', 'B', 'C'] as CassetteId[]) {
    const yTop = C.y[id] + C.h;
    const y = yTop + 0.008;
    const pick = group(pkShake, [D.dispX, y, C.z0 - 0.008]);
    mesh(shaft, m.chrome, pick);
    for (const dx of [-0.05, 0, 0.05]) mesh(tyre, m.rubber, pick, [dx, 0, 0]);
    // flat on one tyre so rotation is visible
    mesh(box(0.019, 0.004, 0.006), m.orangePlastic, pick, [0.05, 0.009, 0]);
    spinner(ctx, `picker-${id}` as MotorGroup, pick, 22);
    const strip = group(pkShake, [D.dispX, y, C.z0 + 0.018]);
    mesh(shaft, m.chrome, strip);
    for (const dx of [-0.05, 0, 0.05]) mesh(counter, m.greyPlastic, strip, [dx, 0, 0]);
    spinner(ctx, `picker-${id}` as MotorGroup, strip, -22);
    // pick module bracket + curved guide onto the transport
    mesh(box(0.226, 0.006, 0.05), m.darkMetal, pkShake, [D.dispX, y + 0.02, C.z0 + 0.012]);
    mesh(cylX(0.012, 0.03, 16), m.darkMetal, pkShake, [C.x1 - 0.005, y + 0.01, C.z0 + 0.04]);
  }

  // ───────────────────────────── transport ─────────────────────────────
  const tr = part(ctx, 'transport', root);
  const trShake = group(tr, [0, 0, 0], 'transport-shake');
  vibrationTargets.push(trShake);
  const tPts = TRANSPORT_POINTS.map(toV);
  const tCurve = new THREE.CatmullRomCurve3(tPts, false, 'centripetal');
  for (const xo of [-0.055, 0.055]) {
    for (const off of [-0.0035, 0.0035]) {
      mesh(ribbonGeometry(offsetSamples(tCurve, 60, off, xo), 0.007, X, 1), beltDS, trShake);
    }
  }
  // belt pulleys / idlers along the transport
  for (let i = 0; i < tPts.length; i++) {
    if (i === 3) continue;
    const p = tPts[i];
    for (const side of [-1, 1]) {
      const r = i === 0 || i === tPts.length - 1 ? 0.008 : 0.006;
      const roller = group(trShake, [p.x, p.y, p.z + side * (0.0035 + r)]);
      mesh(cylX(r, 0.2, 16), side < 0 ? m.rubber : m.chrome, roller);
      mesh(box(0.004, r * 1.6, 0.002), m.orangePlastic, roller, [0.104, 0, r * 0.8]);
      spinner(ctx, 'transport', roller, side * 30);
    }
  }
  // side guide plates of the vertical transport
  for (const x of [D.dispX - 0.1, D.dispX + 0.1]) mesh(box(0.003, 0.55, 0.05), m.zinc, trShake, [x, 0.42, D.transportZ - 0.012]);
  // reject channel (behind the transport, running down to the reject cassette)
  for (const x of [D.dispX - 0.085, D.dispX + 0.085]) {
    for (const dz of [-0.012, 0.012]) mesh(box(0.012, 0.47, 0.002), zincDS, trShake, [x, 0.43, D.rejectChannelZ + dz]);
    mesh(box(0.003, 0.47, 0.024), m.zinc, trShake, [x + Math.sign(x - D.dispX) * 0.006, 0.43, D.rejectChannelZ]);
  }
  label(ctx, trShake, { w: 256, h: 48, bg: '#c0392b', lines: [{ text: 'REJECT PATH', size: 28, weight: '800', color: '#fff', y: 0.55 }] }, [0.06, 0.011], [D.dispX, 0.5, D.rejectChannelZ + 0.0135]);
  // diverter gate (rotates to send a note to the reject path)
  const div = group(trShake, [D.dispX, D.diverterY, D.transportZ - 0.008], 'diverter');
  dyn(div);
  mesh(box(0.19, 0.003, 0.03), m.orangePlastic, div, [0, 0, -0.012]);
  mesh(cylX(0.004, 0.21, 10), m.chrome, div);
  div.rotation.x = 0.7;
  // extra reject-path waypoints for the animator
  const rejPts: V3[] = [
    [D.dispX, D.diverterY - 0.02, D.rejectChannelZ],
    [D.dispX, 0.45, D.rejectChannelZ],
    [D.dispX, 0.26, D.rejectChannelZ],
    [D.dispX, 0.222, -0.29],
  ];
  rejPts.forEach((p, i) => anchor(ctx, `reject-${i}`, trShake, p));
  TRANSPORT_POINTS.forEach((p, i) => anchor(ctx, `transport-${i}`, trShake, p));

  // ───────────────────────────── validation sensors ─────────────────────────────
  const vs = part(ctx, 'validation-sensors', root);
  for (const dz of [-0.016, 0.016]) {
    mesh(rbox(0.22, 0.02, 0.012, 0.003), m.frameGrey, vs, [D.dispX, D.sensorY, D.transportZ + dz]);
  }
  const sensorMat = own(m.sensorGlow.clone());
  const sl = mesh(box(0.18, 0.005, 0.002), sensorMat, vs, [D.dispX, D.sensorY, D.transportZ + 0.0095]);
  sl.name = 'sensorLight';
  dyn(sl);
  const sl2 = mesh(box(0.18, 0.005, 0.002), sensorMat, vs, [D.dispX, D.sensorY, D.transportZ - 0.0095]);
  sl2.name = 'sensorLight2';
  dyn(sl2);
  mesh(box(0.08, 0.04, 0.003), m.pcb, vs, [D.dispX, D.sensorY + 0.012, D.transportZ - 0.024]);
  label(ctx, vs, { w: 256, h: 48, bg: '#1a1d21', lines: [{ text: 'NOTE SENSOR', size: 26, weight: '800', color: '#7fd1ff', y: 0.55 }] }, [0.05, 0.0095], [D.dispX + 0.05, D.sensorY, D.transportZ + 0.0222]);
  anchor(ctx, 'sensor', vs, [D.dispX, D.sensorY, D.transportZ]);

  // ───────────────────────────── stacker ─────────────────────────────
  const stk = part(ctx, 'stacker', root);
  mesh(box(0.2, 0.004, 0.11), m.zinc, stk, [D.dispX, D.stacker.y - 0.004, D.stacker.z - 0.005]);
  for (const x of [D.dispX - 0.095, D.dispX + 0.095]) mesh(box(0.003, 0.05, 0.11), m.zinc, stk, [x, D.stacker.y + 0.02, D.stacker.z - 0.005]);
  const wheel = group(stk, [D.dispX, 0.742, -0.178], 'stackerWheel');
  mesh(cylX(0.003, 0.2, 8), m.chrome, wheel);
  const fingerGeo = new THREE.TorusGeometry(0.026, 0.0016, 4, 10, 1.7);
  fingerGeo.rotateY(Math.PI / 2);
  for (const dx of [-0.06, 0, 0.06]) {
    mesh(cylX(0.012, 0.008, 16), m.greyPlastic, wheel, [dx, 0, 0]);
    for (let k = 0; k < 6; k++) {
      const f = mesh(fingerGeo, m.lightPlastic, wheel, [dx, 0, 0]);
      f.rotation.x = (k / 6) * Math.PI * 2;
      f.position.set(dx, Math.sin(f.rotation.x) * 0.006, Math.cos(f.rotation.x) * 0.006);
    }
  }
  spinner(ctx, 'stacker', wheel, 14);
  const clamp = group(stk, [D.dispX, D.stacker.y + 0.032, D.stacker.z], 'stackerClamp');
  dyn(clamp);
  mesh(box(0.17, 0.004, 0.07), m.darkMetal, clamp);
  mesh(box(0.012, 0.03, 0.012), m.darkMetal, clamp, [0, 0.016, -0.03]);
  anchor(ctx, 'stacker', stk, [D.dispX, D.stacker.y, D.stacker.z]);

  // ───────────────────────────── presenter + shutter ─────────────────────────────
  const pr = part(ctx, 'presenter-shutter', root);
  const pPts = PRESENTER_POINTS.map(toV);
  const pCurve = new THREE.CatmullRomCurve3(pPts, false, 'centripetal');
  for (const xo of [-0.05, 0.05]) {
    mesh(ribbonGeometry(offsetSamples(pCurve, 50, -0.004, xo, 0.02, 0.98), 0.008, X, 1), presBeltDS, pr);
    mesh(ribbonGeometry(offsetSamples(pCurve, 50, 0.014, xo, 0.25, 0.98), 0.008, X, 1), presBeltDS, pr);
  }
  // upper/lower guide plates of the exit throat
  mesh(ribbonGeometry(offsetSamples(pCurve, 30, -0.012, 0, 0.55, 1), 0.105, X, 1), zincDS, pr);
  mesh(ribbonGeometry(offsetSamples(pCurve, 30, 0.026, 0, 0.55, 1), 0.105, X, 1), zincDS, pr);
  for (const t of [0.08, 0.3, 0.5, 0.7, 0.9]) {
    const p = pCurve.getPointAt(t);
    const nrm = new THREE.Vector3().crossVectors(pCurve.getTangentAt(t), X).normalize();
    for (const [off, mat] of [
      [-0.011, m.rubber],
      [0.021, m.chrome],
    ] as Array<[number, THREE.Material]>) {
      if (off > 0 && t < 0.3) continue;
      const q = p.clone().addScaledVector(nrm, off);
      const roller = group(pr, [q.x, q.y, q.z]);
      mesh(cylX(0.007, 0.15, 14), mat, roller);
      spinner(ctx, 'presenter', roller, off < 0 ? 26 : -26);
    }
  }
  // presenter side frames
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-0.2, 0.68);
  sideShape.lineTo(0.2, 0.68);
  sideShape.lineTo(0.37, 0.86);
  sideShape.lineTo(0.37, 0.95);
  sideShape.lineTo(0.3, 0.95);
  sideShape.lineTo(0.12, 0.76);
  sideShape.lineTo(-0.2, 0.76);
  sideShape.lineTo(-0.2, 0.68);
  sideShape.holes.push(holeCircle(0.05, 0.72, 0.022));
  sideShape.holes.push(holeCircle(-0.12, 0.72, 0.022));
  const sideGeo = extrudeShapeX(sideShape, 0.004);
  for (const x of [D.dispX - 0.118, D.dispX + 0.118]) mesh(sideGeo, m.frameGrey, pr, [x, 0, 0]);
  // shutter: plate in vertical guides right behind the cash slot
  const shutter = mesh(rbox(0.214, 0.044, 0.004, 0.0015), m.darkMetal, pr, [D.dispX, D.cash.y, 0.405]);
  shutter.name = 'shutter';
  dyn(shutter);
  for (const x of [D.dispX - 0.111, D.dispX + 0.111]) mesh(box(0.006, 0.12, 0.012), m.frameGrey, pr, [x, D.cash.y - 0.03, 0.405]);
  mesh(cylX(0.012, 0.03, 16), m.darkMetal, pr, [D.dispX + 0.13, D.cash.y - 0.06, 0.39]);
  PRESENTER_POINTS.forEach((p, i) => anchor(ctx, `presenter-${i}`, pr, p));
  anchor(ctx, 'shutterOutside', pr, [D.dispX, D.cash.y, D.front + 0.036]);

  // ───────────────────────────── deposit module ─────────────────────────────
  const dm = part(ctx, 'deposit-module', root);
  const dx = D.depX;
  // validator (right behind the slot)
  mesh(rbox(0.21, 0.025, 0.12, 0.004), m.greyPlastic, dm, [dx, D.cash.y + 0.022, 0.33]);
  mesh(rbox(0.21, 0.025, 0.12, 0.004), m.greyPlastic, dm, [dx, D.cash.y - 0.022, 0.33]);
  const scanMat = own(m.scanGlow.clone());
  const scan = mesh(box(0.18, 0.003, 0.006), scanMat, dm, [dx, D.cash.y + 0.009, 0.33]);
  scan.name = 'depositScan';
  dyn(scan);
  label(ctx, dm, { w: 256, h: 48, bg: '#1a1d21', lines: [{ text: 'NOTE VALIDATOR', size: 24, weight: '800', color: '#7fd1ff', y: 0.55 }] }, [0.06, 0.011], [dx, D.cash.y + 0.035, 0.3905]);
  for (const z of [0.29, 0.37]) {
    const r = group(dm, [dx, D.cash.y - 0.009, z]);
    mesh(cylX(0.005, 0.17, 12), m.rubber, r);
    spinner(ctx, 'deposit', r, 25);
  }
  // escrow platform
  mesh(box(0.2, 0.004, 0.2), m.zinc, dm, [dx, 0.896, 0.14]);
  for (const x of [dx - 0.1, dx + 0.1]) mesh(box(0.004, 0.05, 0.2), m.frameGrey, dm, [x, 0.915, 0.14]);
  mesh(ribbonGeometry([new THREE.Vector3(dx, 0.8985, 0.235), new THREE.Vector3(dx, 0.8985, 0.045)], 0.06, X, 1), presBeltDS, dm);
  label(ctx, dm, { w: 256, h: 48, bg: '#24465f', lines: [{ text: 'ESCROW', size: 30, weight: '800', color: '#fff', y: 0.55 }] }, [0.05, 0.0095], [dx, 0.925, 0.2405]);
  // chute down to the deposit bin
  for (const z of [-0.035, 0.035]) mesh(box(0.19, 0.3, 0.003), zincDS, dm, [dx, 0.71, z]);
  const dr = group(dm, [dx, 0.885, 0.035]);
  mesh(cylX(0.008, 0.17, 12), m.rubber, dr);
  spinner(ctx, 'deposit', dr, 25);
  // deposit cassette (bin)
  const bx0 = -0.276;
  const bx1 = -0.044;
  const bw = bx1 - bx0;
  const by0 = D.cassette.y.reject;
  const by1 = 0.555;
  const bz0 = -0.3;
  const bz1 = 0.3;
  mesh(box(bw, 0.006, bz1 - bz0), m.depositBody, dm, [dx, by0 + 0.003, 0]);
  for (const x of [bx0 + 0.003, bx1 - 0.003]) mesh(box(0.006, by1 - by0, bz1 - bz0), m.depositBody, dm, [x, (by0 + by1) / 2, 0]);
  mesh(box(bw, by1 - by0, 0.006), m.depositBody, dm, [dx, (by0 + by1) / 2, bz0 + 0.003]);
  mesh(rbox(bw + 0.004, by1 - by0, 0.022, 0.004), m.depositBody, dm, [dx, (by0 + by1) / 2, bz1 - 0.011]);
  mesh(box(bw, 0.004, 0.2), m.depositBody, dm, [dx, by1 - 0.002, -0.17]);
  mesh(box(bw, 0.004, 0.2), m.depositBody, dm, [dx, by1 - 0.002, 0.17]);
  mesh(rbox(0.016, 0.1, 0.014, 0.005), m.chrome, dm, [bx1 - 0.024, (by0 + by1) / 2, bz1 + 0.007]);
  {
    const fc = makeCanvas(512, 320).canvas;
    const c = fc.getContext('2d')!;
    c.fillStyle = '#24465f';
    c.fillRect(0, 0, 512, 320);
    c.fillStyle = BRAND.tealCss;
    c.fillRect(0, 0, 512, 18);
    c.fillStyle = '#fff';
    c.font = "800 64px 'Inter', Arial, sans-serif";
    c.textAlign = 'center';
    c.fillText('DEPOSIT', 256, 120);
    c.font = "600 34px 'Inter', Arial, sans-serif";
    c.fillText('CASSETTE', 256, 172);
    c.font = "500 24px 'Inter', Arial, sans-serif";
    c.fillStyle = '#bcd3e2';
    c.fillText('accepted notes · training', 256, 240);
    const t = new THREE.CanvasTexture(fc);
    t.colorSpace = THREE.SRGBColorSpace;
    ctx.ownedTextures.push(t);
    mesh(new THREE.PlaneGeometry(0.16, 0.1), own(new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 })), dm, [dx - 0.01, 0.37, bz1 + 0.0006]);
  }
  {
    const pile = new THREE.Mesh(new THREE.BoxGeometry(NOTE_W, 1, NOTE_H).translate(0, 0.5, 0), [stackSide, stackSide, noteMaterial(20), m.noteStackEdge, stackSide, stackSide]);
    pile.position.set(dx, by0 + 0.006, 0);
    pile.name = 'stack-deposit';
    dyn(pile);
    dm.add(pile);
    ctx.fills.deposit = { stack: pile, axis: 'y', max: 0.4, min: 0.0005 };
  }
  anchor(ctx, 'escrow', dm, [dx, 0.9, 0.14]);
  anchor(ctx, 'depositBin', dm, [dx, by1 + 0.01, 0.0]);

  // ───────────────────────────── receipt printer ─────────────────────────────
  const rp = part(ctx, 'receipt-printer', root);
  const px = D.rightCol;
  const py = D.receipt.y - 0.003;
  mesh(box(0.115, 0.004, 0.27), m.zinc, rp, [px, 1.0, 0.155]);
  for (const x of [px - 0.056, px + 0.056]) {
    const sp = new THREE.Shape();
    sp.moveTo(0.02, 0.998);
    sp.lineTo(0.29, 0.998);
    sp.lineTo(0.29, 1.105);
    sp.lineTo(0.15, 1.105);
    sp.lineTo(0.12, 1.135);
    sp.lineTo(0.02, 1.135);
    sp.lineTo(0.02, 0.998);
    sp.holes.push(holeCircle(0.08, 1.06, 0.03));
    mesh(extrudeShapeX(sp, 0.004), m.frameGrey, rp, [x, 0, 0]);
  }
  const roll = group(rp, [px, 1.06, 0.08], 'paperRoll');
  mesh(cylX(0.042, 0.082, 32), m.paper, roll);
  mesh(cylX(0.012, 0.09, 16), m.greyPlastic, roll);
  spinner(ctx, 'printer', roll, 4);
  mesh(cylX(0.003, 0.12, 8), m.chrome, rp, [px, 1.06, 0.08]);
  const paperPath = [new THREE.Vector3(px, 1.102, 0.08), new THREE.Vector3(px, 1.098, 0.16), new THREE.Vector3(px, py + 0.002, 0.225), new THREE.Vector3(px, py, 0.3)];
  const paperDS = own(m.paper.clone());
  paperDS.side = THREE.DoubleSide;
  mesh(ribbonGeometry(new THREE.CatmullRomCurve3(paperPath).getPoints(20), 0.039, X, 1), paperDS, rp);
  mesh(rbox(0.1, 0.018, 0.03, 0.003), m.darkMetal, rp, [px, py + 0.012, 0.235]);
  const platen = group(rp, [px, py - 0.008, 0.235]);
  mesh(cylX(0.0075, 0.095, 16), m.rubber, platen);
  spinner(ctx, 'printer', platen, 20);
  mesh(box(0.1, 0.01, 0.012), m.chrome, rp, [px, py + 0.009, 0.275]);
  mesh(box(0.003, 0.05, 0.08), m.pcb, rp, [px + 0.06, 1.05, 0.2]);
  label(ctx, rp, { w: 256, h: 48, bg: '#e7e7e2', lines: [{ text: 'RECEIPT PRINTER', size: 24, weight: '800', color: '#222', y: 0.55 }] }, [0.06, 0.011], [px + 0.0585, 1.03, 0.1], [0, Math.PI / 2, 0]);
  anchor(ctx, 'printerHead', rp, [px, py, 0.235]);

  // ───────────────────────────── card reader module ─────────────────────────────
  const crm = part(ctx, 'card-reader-module', root);
  const cx = D.rightCol;
  const cy = D.card.y + 0.002;
  mesh(box(0.1, 0.004, 0.235), m.zinc, crm, [cx, cy - 0.012, 0.17]);
  for (const x of [cx - 0.048, cx + 0.048]) {
    const sp = new THREE.Shape();
    sp.moveTo(0.055, cy - 0.014);
    sp.lineTo(0.288, cy - 0.014);
    sp.lineTo(0.288, cy + 0.02);
    sp.lineTo(0.055, cy + 0.02);
    sp.lineTo(0.055, cy - 0.014);
    sp.holes.push(holeRect(0.17, cy + 0.003, 0.15, 0.018, 0.004));
    mesh(extrudeShapeX(sp, 0.004), m.frameGrey, crm, [x, 0, 0]);
  }
  mesh(box(0.1, 0.002, 0.2), m.pcb, crm, [cx, cy + 0.022, 0.17]);
  instancedBoxes(crm, [0.016, 0.003, 0.016], [[cx - 0.02, cy + 0.0245, 0.12], [cx + 0.02, cy + 0.0245, 0.16], [cx, cy + 0.0245, 0.22]], m.satinBlack).userData.componentId = 'card-reader-module';
  mesh(cylX(0.012, 0.04, 16), m.darkMetal, crm, [cx + 0.025, cy + 0.04, 0.09]);
  for (const z of [0.11, 0.2, 0.27]) {
    for (const off of [-0.006, 0.006]) {
      const r = group(crm, [cx, cy + off, z]);
      mesh(cylX(0.0045, 0.06, 12), m.rubber, r);
      spinner(ctx, 'card', r, off < 0 ? 25 : -25);
    }
  }
  // chip contact head + magnetic head (generic)
  mesh(box(0.02, 0.008, 0.02), m.brass, crm, [cx, cy + 0.011, 0.18]);
  // retain bin behind the reader
  mesh(box(0.09, 0.004, 0.1), m.darkMetal, crm, [cx, 1.122, 0.0]);
  for (const x of [cx - 0.045, cx + 0.045]) mesh(box(0.004, 0.07, 0.1), m.darkMetal, crm, [x, 1.157, 0.0]);
  mesh(box(0.09, 0.07, 0.004), m.darkMetal, crm, [cx, 1.157, -0.05]);
  mesh(box(0.09, 0.04, 0.004), m.darkMetal, crm, [cx, 1.142, 0.05]);
  label(ctx, crm, { w: 256, h: 48, bg: '#e7e7e2', lines: [{ text: 'CARD RETAIN', size: 26, weight: '800', color: '#222', y: 0.55 }] }, [0.05, 0.0095], [cx, 1.14, 0.0525]);
  ledMesh(ctx, cylZ(0.002, 0.002, 8), crm, [cx - 0.035, cy + 0.03, 0.06], 0x22dd66, null, 1.5);
  anchor(ctx, 'cardReaderInside', crm, [cx, cy, 0.19]);
  anchor(ctx, 'cardRetainBin', crm, [cx, 1.135, 0.0]);

  // ───────────────────────────── controller PC ─────────────────────────────
  const pc = part(ctx, 'controller-pc', root);
  const pcX = -0.07;
  const pcY = 1.175;
  const pcZ = -0.26;
  mesh(rbox(0.3, 0.33, 0.26, 0.006), m.darkMetal, pc, [pcX, pcY, pcZ]);
  mesh(box(0.29, 0.32, 0.004), m.satinBlack, pc, [pcX, pcY, pcZ + 0.13]);
  {
    const slots: V3[] = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 2; c++) slots.push([pcX - 0.08 + c * 0.075, pcY + 0.13 - r * 0.018, pcZ + 0.1325]);
    instancedBoxes(pc, [0.06, 0.006, 0.002], slots, m.throatDark).userData.componentId = 'controller-pc';
  }
  mesh(cylZ(0.045, 0.004, 32), m.greyPlastic, pc, [pcX + 0.08, pcY + 0.07, pcZ + 0.133]);
  mesh(new THREE.TorusGeometry(0.03, 0.002, 4, 32), m.chrome, pc, [pcX + 0.08, pcY + 0.07, pcZ + 0.136]);
  instancedBoxes(pc, [0.012, 0.005, 0.004], [[pcX + 0.06, pcY - 0.06, pcZ + 0.134], [pcX + 0.08, pcY - 0.06, pcZ + 0.134], [pcX + 0.1, pcY - 0.06, pcZ + 0.134], [pcX + 0.06, pcY - 0.08, pcZ + 0.134]], m.cableBlue).userData.componentId = 'controller-pc';
  ledMesh(ctx, cylZ(0.003, 0.002, 10), pc, [pcX + 0.11, pcY - 0.12, pcZ + 0.134], 0x2a7fff, null, 2);
  ledMesh(ctx, cylZ(0.003, 0.002, 10), pc, [pcX + 0.095, pcY - 0.12, pcZ + 0.134], 0x22dd66, null, 1.5);
  label(ctx, pc, { w: 512, h: 160, bg: '#d9dcdf', border: { color: '#333', width: 6 }, lines: [{ text: 'ATM CONTROLLER PC', size: 40, weight: '800', color: '#1a1a1a', y: 0.33 }, { text: 'generic · runs the ATM application', size: 26, weight: '500', color: '#333', y: 0.7 }] }, [0.12, 0.0375], [pcX - 0.06, pcY - 0.1, pcZ + 0.1325]);
  fasteners(pc, [[pcX - 0.14, pcY + 0.155, pcZ + 0.1325], [pcX + 0.14, pcY + 0.155, pcZ + 0.1325], [pcX - 0.14, pcY - 0.155, pcZ + 0.1325], [pcX + 0.14, pcY - 0.155, pcZ + 0.1325]], [0, 0, 1], m.zinc, 0.004, 'controller-pc');

  // I/O distribution board + cable duct on the upper module floor (part of the controller system)
  mesh(rbox(0.14, 0.03, 0.1, 0.004), m.greyPlastic, pc, [-0.2, D.band.y1 + 0.015, 0.02]);
  mesh(box(0.13, 0.002, 0.09), m.pcb, pc, [-0.2, D.band.y1 + 0.031, 0.02]);
  instancedBoxes(pc, [0.014, 0.008, 0.01], [[-0.24, D.band.y1 + 0.036, 0.0], [-0.22, D.band.y1 + 0.036, 0.0], [-0.2, D.band.y1 + 0.036, 0.0], [-0.18, D.band.y1 + 0.036, 0.0], [-0.16, D.band.y1 + 0.036, 0.04]], m.lightPlastic).userData.componentId = 'controller-pc';
  label(ctx, pc, { w: 256, h: 48, bg: '#e7e7e2', lines: [{ text: 'I/O BOARD', size: 30, weight: '800', color: '#222', y: 0.55 }] }, [0.05, 0.0095], [-0.2, D.band.y1 + 0.015, 0.0705]);
  mesh(box(0.5, 0.025, 0.03), m.greyPlastic, pc, [0.0, D.band.y1 + 0.0125, -0.1]);

  // ───────────────────────────── power supply ─────────────────────────────
  const ps = part(ctx, 'power-supply', root);
  const psX = -0.28;
  mesh(rbox(0.085, 0.24, 0.26, 0.004), m.zinc, ps, [psX, 1.125, -0.27]);
  {
    const fins: V3[] = [];
    for (let i = 0; i < 9; i++) fins.push([psX, 1.25, -0.38 + i * 0.027]);
    instancedBoxes(ps, [0.07, 0.02, 0.003], fins, m.darkMetal).userData.componentId = 'power-supply';
  }
  mesh(cylZ(0.03, 0.004, 28), m.greyPlastic, ps, [psX, 1.07, -0.138]);
  mesh(new THREE.TorusGeometry(0.02, 0.002, 4, 28), m.chrome, ps, [psX, 1.07, -0.135]);
  ledMesh(ctx, cylZ(0.003, 0.002, 10), ps, [psX + 0.025, 1.22, -0.138], 0x22dd66, null, 2);
  label(ctx, ps, { w: 256, h: 128, bg: '#f2c230', border: { color: '#111', width: 5 }, lines: [{ text: 'PSU 24 V DC', size: 34, weight: '800', color: '#111', y: 0.35 }, { text: '⚡ isolate first', size: 24, weight: '600', color: '#111', y: 0.72 }] }, [0.06, 0.03], [psX, 1.17, -0.1385]);
  // breaker / distribution rail on the rear wall
  mesh(box(0.2, 0.035, 0.012), m.zinc, ps, [-0.16, 1.43, D.back + 0.02]);
  instancedBoxes(ps, [0.018, 0.05, 0.04], [[-0.22, 1.43, D.back + 0.045], [-0.2, 1.43, D.back + 0.045], [-0.18, 1.43, D.back + 0.045], [-0.15, 1.43, D.back + 0.045]], m.lightPlastic).userData.componentId = 'power-supply';
  instancedBoxes(ps, [0.006, 0.012, 0.006], [[-0.22, 1.44, D.back + 0.067], [-0.2, 1.44, D.back + 0.067], [-0.18, 1.44, D.back + 0.067], [-0.15, 1.44, D.back + 0.067]], m.orangePlastic).userData.componentId = 'power-supply';

  // ───────────────────────────── comms ─────────────────────────────
  const cm = part(ctx, 'comms', root);
  mesh(rbox(0.17, 0.036, 0.11, 0.008), m.lightPlastic, cm, [0.17, 1.475, -0.33]);
  for (let i = 0; i < 4; i++) ledMesh(ctx, box(0.004, 0.003, 0.002), cm, [0.115 + i * 0.012, 1.48, -0.274], i === 3 ? 0xffaa22 : 0x22dd66, null, 1.6);
  for (const x of [0.105, 0.235]) {
    mesh(cylY(0.006, 0.014, 10), m.blackPlastic, cm, [x, 1.5, -0.37]);
    mesh(cylY(0.005, 0.1, 10, 0.004), m.blackPlastic, cm, [x, 1.56, -0.37]);
  }
  label(ctx, cm, { w: 256, h: 48, bg: null, lines: [{ text: 'COMMS · 4G/LAN', size: 26, weight: '800', color: '#333', y: 0.55 }] }, [0.07, 0.013], [0.2, 1.465, -0.2745]);
  // network/telephone line cable into the comms box
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.25, 1.47, -0.385), new THREE.Vector3(0.28, 1.42, -0.405), new THREE.Vector3(0.3, 1.2, -0.41)]), 16, 0.004, 6), m.cableBlue, cm);

  // ───────────────────────────── harness (decorative, no component) ─────────────────────────────
  const harness = group(root, [0, 0, 0], 'harness');
  const tube = (pts: V3[], r: number, mat: THREE.Material): void => {
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(toV)), 32, r, 6), mat, harness);
  };
  tube([[-0.25, 1.24, -0.2], [-0.2, 1.36, -0.15], [-0.07, 1.36, -0.12]], 0.006, m.cable); // PSU → PC
  tube([[0.06, 1.12, -0.13], [0.15, 1.14, -0.05], [0.24, 1.2, 0.05]], 0.004, m.cable); // PC → card reader
  tube([[0.06, 1.08, -0.13], [0.15, 1.04, -0.02], [0.24, 1.02, 0.03]], 0.004, m.cable); // PC → printer
  tube([[0.0, 1.35, -0.13], [0.12, 1.45, -0.25], [0.17, 1.47, -0.28]], 0.0035, m.cableBlue); // PC → comms
  tube([[-0.27, 1.0, -0.35], [-0.27, 0.93, -0.38], [0.2, 0.9, -0.39], [0.22, 0.8, -0.395]], 0.007, m.cable); // into the safe (through gland)
  tube([[0.0, 1.06, -0.13], [-0.05, 1.03, 0.0], [-0.04, 1.06, 0.2], [-0.03, 1.08, 0.28]], 0.004, m.cable); // PC → fascia (keypad/display)

  return { vibrationTargets };
}
