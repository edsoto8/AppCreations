/**
 * Baked building art (one atlas sprite per building type / variant / farm stage). Anchors sit at the
 * centre of the footprint on the ground, so a sprite is placed at tileToScreen(origin + footprint / 2).
 */
import { css, shadeRgb, type RGB } from '../util/color';
import { mulberry32 } from '../util/noise';
import type { Art } from './canvas';
import { Kit, ao, compose, door, facets, planks, shingles, snowBlanket, solid, stones, sweep, windowPane, type Pt } from './isoKit';

const PLASTER: RGB[] = [
  [238, 224, 192],
  [240, 236, 226],
  [230, 200, 150],
];
const ROOF: RGB[] = [
  [194, 92, 66],
  [88, 118, 126],
  [168, 122, 78],
];
const TIMBER: RGB = [96, 66, 46];
const STONE: RGB = [170, 162, 152];
const WOOD: RGB = [158, 112, 74];

export const HOUSE_VARIANTS = 3;
export const FARM_STAGES = 6;

interface Roofed {
  k: Kit;
}

/** Gable roof with ridge along u. Returns nothing; draws the +u gable end and the +v slope. */
function gableU(k: Roofed['k'], u0: number, u1: number, v0: number, v1: number, h: number, rise: number, over: number, roof: RGB, wall: (c: CanvasRenderingContext2D, w: number, h: number) => void, rowH = 4.6): void {
  const c = k.ctx;
  const vm = (v0 + v1) / 2;
  // gable end on the +u plane
  const o = k.P(u1, v1, h + rise);
  const e = k.P(u1, v0, h + rise);
  const wp = Math.hypot(e.x - o.x, e.y - o.y);
  c.save();
  k.poly([k.P(u1, v1, h), k.P(u1, v0, h), k.P(u1, vm, h + rise)]);
  c.clip();
  c.transform((e.x - o.x) / wp, (e.y - o.y) / wp, 0, 1, o.x, o.y);
  wall(c, wp, rise + 2);
  c.restore();
  k.poly([k.P(u1, v1, h), k.P(u1, v0, h), k.P(u1, vm, h + rise)]);
  c.strokeStyle = css([30, 22, 26], 0.55);
  c.lineWidth = 0.9;
  c.stroke();
  // front slope
  const ro = k.P(u0 - over, vm, h + rise);
  const ra = k.P(u1 + over, vm, h + rise);
  const rb = k.P(u0 - over, v1 + over, h - 2);
  k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, compose(solid(roof, 1.04, 0.1), shingles(rowH, 7, shadeRgb(roof, 1), 7), ao(0.2, 0.18)));
  if (k.snow) k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, snowBlanket(), 0);
  // lit ridge cap
  c.strokeStyle = css(k.snow ? [240, 246, 255] : shadeRgb(roof, 1.35), 0.9);
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(ro.x, ro.y);
  c.lineTo(ra.x, ra.y);
  c.stroke();
}

/** Gable roof with ridge along v (gable end faces +v). */
function gableV(k: Kit, u0: number, u1: number, v0: number, v1: number, h: number, rise: number, over: number, roof: RGB, wall: (c: CanvasRenderingContext2D, w: number, h: number) => void, rowH = 4.6): void {
  const c = k.ctx;
  const um = (u0 + u1) / 2;
  // gable end on the +v plane
  const o = k.P(u0, v1, h + rise);
  const e = k.P(u1, v1, h + rise);
  const wp = Math.hypot(e.x - o.x, e.y - o.y);
  c.save();
  k.poly([k.P(u0, v1, h), k.P(u1, v1, h), k.P(um, v1, h + rise)]);
  c.clip();
  c.transform((e.x - o.x) / wp, (e.y - o.y) / wp, 0, 1, o.x, o.y);
  wall(c, wp, rise + 2);
  c.restore();
  k.poly([k.P(u0, v1, h), k.P(u1, v1, h), k.P(um, v1, h + rise)]);
  c.strokeStyle = css([30, 22, 26], 0.55);
  c.lineWidth = 0.9;
  c.stroke();
  // slope facing +u
  const ro = k.P(um, v1 + over, h + rise);
  const ra = k.P(um, v0 - over, h + rise);
  const rb = k.P(u1 + over, v1 + over, h - 2);
  k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, compose(solid(shadeRgb(roof, 0.8), 1, 0.1), shingles(rowH, 7, shadeRgb(roof, 0.8), 11), ao(0.2, 0.2)));
  if (k.snow) k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, compose(snowBlanket(), (cc, w, h) => { cc.fillStyle = 'rgba(40,60,110,0.16)'; cc.fillRect(0, 0, w, h); }), 0);
  c.strokeStyle = css(k.snow ? [240, 246, 255] : shadeRgb(roof, 1.2), 0.85);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(ro.x, ro.y);
  c.lineTo(ra.x, ra.y);
  c.stroke();
}

/** Four-sided hip roof; draws the two visible triangles. */
function hip(k: Kit, u0: number, u1: number, v0: number, v1: number, h: number, rise: number, over: number, roof: RGB): void {
  const A = k.P((u0 + u1) / 2, (v0 + v1) / 2, h + rise);
  const Cl = k.P(u0 - over, v1 + over, h - 1);
  const Cb = k.P(u1 + over, v1 + over, h - 1);
  const Cr = k.P(u1 + over, v0 - over, h - 1);
  const tri = (p0: Pt, p1: Pt, apex: Pt, s: number): void => {
    const c = k.ctx;
    const a = { x: p1.x - p0.x, y: p1.y - p0.y };
    const b = { x: apex.x - p0.x, y: apex.y - p0.y };
    const w = Math.hypot(a.x, a.y);
    const hh = Math.hypot(b.x, b.y);
    c.save();
    k.poly([p0, p1, apex]);
    c.clip();
    c.transform(a.x / w, a.y / w, b.x / hh, b.y / hh, p0.x, p0.y);
    solid(roof, s, 0.1)(c, w, hh);
    shingles(4.2, 6.5, shadeRgb(roof, s), 5)(c, w, hh);
    ao(0.1, 0.16)(c, w, hh);
    if (k.snow) {
      snowBlanket(0.9)(c, w, hh);
      if (s < 0.9) {
        c.fillStyle = 'rgba(40,60,110,0.16)';
        c.fillRect(0, 0, w, hh);
      }
    }
    c.restore();
    k.poly([p0, p1, apex]);
    c.strokeStyle = css([30, 22, 26], 0.5);
    c.lineWidth = 0.9;
    c.stroke();
  };
  tri(Cl, Cb, A, 1.02);
  tri(Cb, Cr, A, 0.78);
}

function timberFrame(c: CanvasRenderingContext2D, w: number, h: number, cols: number, brace = true): void {
  c.fillStyle = css(TIMBER, 1);
  const t = 1.9;
  c.fillRect(0, 0, t, h);
  c.fillRect(w - t, 0, t, h);
  c.fillRect(0, 0, w, t);
  c.fillRect(0, h - t, w, t);
  for (let i = 1; i < cols; i++) c.fillRect((i / cols) * w - t / 2, 0, t, h);
  c.fillRect(0, h * 0.46, w, t * 0.8);
  if (brace) {
    c.strokeStyle = css(TIMBER, 1);
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(t, h - t);
    c.lineTo(w / cols - t / 2, h * 0.48);
    c.stroke();
  }
}

// --- Buildings ------------------------------------------------------------------------------------

export function bakeHouse(variant: number, snow = false): Art {
  const k = new Kit(2, 2, 66);
  k.snow = snow;
  const plaster = PLASTER[variant % PLASTER.length]!;
  const roof = ROOF[variant % ROOF.length]!;
  const c = k.ctx;
  k.groundShadow(-0.85, 0.85, -0.85, 0.85, 0.9);
  // stone foundation
  k.box(-0.82, 0.82, -0.82, 0.82, 0, 4, { left: stones(STONE, 3, 5), right: compose(stones(STONE, 4, 5), (cc, w, h) => { cc.fillStyle = 'rgba(0,0,0,0.25)'; cc.fillRect(0, 0, w, h); }), top: solid(STONE, 1) });
  const wallBody = (shade: number) => compose(solid(plaster, shade, 0.1), ao(0.04, 0.2));
  // chimney (behind the roof)
  const chim = (): void => {
    k.box(-0.56, -0.34, -0.5, -0.28, 20, 52, { left: stones([150, 140, 132], 8, 4), right: compose(stones([120, 112, 106], 9, 4)), top: solid([90, 82, 78], 1) });
  };
  // walls
  k.wallLeft(-0.78, 0.78, 0.78, 4, 28, compose(wallBody(1), (cc, w, h) => {
    timberFrame(cc, w, h, 4);
    door(cc, w * 0.4, h - 18, 8.5, 18, [128, 86, 58]);
    cc.fillStyle = css([140, 130, 120], 1);
    cc.fillRect(w * 0.4 - 1.5, h - 1.4, 12, 1.4);
    windowPane(cc, w * 0.1, 6, 7, 8, { shutters: shadeRgb(roof, 0.9), flowers: true });
    windowPane(cc, w * 0.72, 6, 7, 8, { shutters: shadeRgb(roof, 0.9) });
  }, sweep(0.1, 0.0)));
  k.wallRight(0.78, -0.78, 0.78, 4, 28, compose(wallBody(0.78), (cc, w, h) => {
    timberFrame(cc, w, h, 3, false);
    windowPane(cc, w * 0.18, 6, 7, 8, { shutters: shadeRgb(roof, 0.75) });
    windowPane(cc, w * 0.62, 6, 7, 8, { shutters: shadeRgb(roof, 0.75), flowers: true });
  }));
  chim();
  gableU(k, -0.78, 0.78, -0.78, 0.78, 28, 20, 0.14, roof, compose(solid(plaster, 0.76, 0.06), (cc, w, h) => {
    cc.fillStyle = css(TIMBER, 1);
    cc.fillRect(0, h - 3, w, 3);
    cc.fillRect(w / 2 - 1, 0, 2, h);
  }));
  // flower bush and barrel by the door
  c.fillStyle = css([40, 70, 40], 0.3);
  c.beginPath();
  c.ellipse(k.P(0.95, 0.5, 0).x, k.P(0.95, 0.5, 0).y + 1, 6, 2.5, 0, 0, Math.PI * 2);
  c.fill();
  return k.art;
}

export function bakeTownCenter(snow = false): Art {
  const k = new Kit(3, 3, 112);
  k.snow = snow;
  const c = k.ctx;
  const plaster: RGB = [232, 216, 180];
  const roof: RGB = [158, 70, 56];
  k.groundShadow(-1.4, 1.4, -1.4, 1.4, 1);
  // stone plinth with steps
  k.box(-1.42, 1.42, -1.42, 1.42, 0, 6, { left: stones([166, 158, 148], 21, 6), right: stones([140, 132, 124], 22, 6), top: solid([186, 178, 166], 1) });
  // hall
  k.wallLeft(-1.12, 1.12, 0.98, 6, 34, compose(solid(plaster, 1, 0.1), ao(0.04, 0.2), (cc, w, h) => {
    timberFrame(cc, w, h, 6);
    door(cc, w / 2 - 8, h - 24, 16, 24, [120, 82, 56]);
    cc.fillStyle = css([150, 140, 130], 1);
    cc.fillRect(w / 2 - 11, h - 1.6, 22, 1.6);
    for (const x of [0.12, 0.28, 0.66, 0.8]) windowPane(cc, w * x, 8, 7, 9, { shutters: [150, 80, 60] });
  }));
  k.wallRight(1.12, -0.98, 0.98, 6, 34, compose(solid(plaster, 0.78, 0.1), ao(0.04, 0.2), (cc, w, h) => {
    timberFrame(cc, w, h, 4, false);
    for (const x of [0.16, 0.42, 0.68]) windowPane(cc, w * x, 8, 7, 9, { shutters: [120, 62, 48], flowers: x > 0.4 });
  }));
  // tower behind-left
  k.box(-0.82, -0.12, -0.82, -0.12, 34, 60, { left: compose(stones([196, 184, 160], 31, 5), ao(0, 0.2), (cc, w, h) => { cc.fillStyle = css([34, 26, 30], 1); cc.beginPath(); cc.roundRect(w / 2 - 3, h * 0.35, 6, 11, [3, 3, 0, 0]); cc.fill(); }), right: compose(stones([160, 148, 128], 32, 5)), top: solid([180, 170, 150], 1) });
  gableU(k, -1.12, 1.12, -0.98, 0.98, 34, 24, 0.16, roof, compose(solid(plaster, 0.76, 0.06), (cc, w, h) => { cc.fillStyle = css(TIMBER, 1); cc.fillRect(0, h - 3, w, 3); cc.fillRect(w / 2 - 1, 0, 2, h); }), 5);
  hip(k, -0.82, -0.12, -0.82, -0.12, 60, 24, 0.14, [140, 58, 50]);
  // banner on a pole
  const top = k.P(-0.47, -0.47, 84);
  c.strokeStyle = css([60, 42, 30], 1);
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(top.x, top.y);
  c.lineTo(top.x, top.y - 20);
  c.stroke();
  c.fillStyle = css([40, 30, 24], 0.9);
  c.beginPath();
  c.moveTo(top.x, top.y - 20);
  c.lineTo(top.x + 16, top.y - 15.5);
  c.lineTo(top.x, top.y - 9);
  c.fill();
  c.fillStyle = css([232, 168, 54], 1);
  c.beginPath();
  c.moveTo(top.x + 0.6, top.y - 19);
  c.lineTo(top.x + 14, top.y - 15.4);
  c.lineTo(top.x + 0.6, top.y - 10.2);
  c.fill();
  // crates, barrels at the foot
  for (const [u, v, s] of [
    [1.28, 1.2, 1],
    [1.5, 0.95, 0.8],
  ] as const) {
    k.box(u - 0.14 * s, u + 0.14 * s, v - 0.14 * s, v + 0.14 * s, 6, 6 + 11 * s, { left: compose(solid(WOOD, 1), planks(3, 0.3, 3)), right: compose(solid(WOOD, 0.74), planks(3, 0.3, 4)), top: solid(WOOD, 1.2) }, 0.55);
  }
  return k.art;
}

export function bakeStorage(snow = false): Art {
  const k = new Kit(2, 2, 70);
  k.snow = snow;
  const c = k.ctx;
  const wood: RGB = [152, 98, 70];
  const roof: RGB = [92, 100, 108];
  k.groundShadow(-0.85, 0.85, -0.85, 0.85, 0.9);
  k.box(-0.82, 0.82, -0.82, 0.82, 0, 3, { left: stones(STONE, 41, 5), right: stones([140, 134, 126], 42, 5), top: solid(STONE, 1) });
  k.wallLeft(-0.8, 0.8, 0.8, 3, 26, compose(solid(wood, 1, 0.1), planks(9, 0.28, 5), ao(0.04, 0.2), (cc, w, h) => {
    // big double doors with X bracing
    const dw = w * 0.42;
    const dx = w / 2 - dw / 2;
    cc.fillStyle = css([40, 28, 24], 1);
    cc.fillRect(dx - 1.5, h - 20, dw + 3, 20);
    cc.fillStyle = css(shadeRgb(wood, 0.74), 1);
    cc.fillRect(dx, h - 19, dw / 2 - 0.4, 19);
    cc.fillRect(dx + dw / 2 + 0.4, h - 19, dw / 2 - 0.4, 19);
    cc.strokeStyle = css([226, 196, 150], 0.9);
    cc.lineWidth = 1.2;
    for (const x0 of [dx, dx + dw / 2 + 0.4]) {
      cc.beginPath();
      cc.moveTo(x0 + 1, h - 18);
      cc.lineTo(x0 + dw / 2 - 1.4, h - 1.5);
      cc.moveTo(x0 + dw / 2 - 1.4, h - 18);
      cc.lineTo(x0 + 1, h - 1.5);
      cc.stroke();
    }
    cc.fillStyle = css([40, 28, 24], 1);
    cc.fillRect(w * 0.1, 5, 6, 8);
    cc.fillRect(w * 0.82, 5, 6, 8);
    cc.fillStyle = css([210, 170, 90], 0.6);
    cc.fillRect(w * 0.1 + 1, 6, 4, 6);
    cc.fillRect(w * 0.82 + 1, 6, 4, 6);
  }));
  k.wallRight(0.8, -0.8, 0.8, 3, 26, compose(solid(wood, 0.76, 0.1), planks(9, 0.3, 6), ao(0.04, 0.2), (cc, w) => {
    cc.fillStyle = css([40, 28, 24], 1);
    cc.fillRect(w * 0.2, 6, 6, 7);
    cc.fillRect(w * 0.65, 6, 6, 7);
  }));
  gableV(k, -0.8, 0.8, -0.8, 0.8, 26, 16, 0.14, roof, compose(solid(wood, 1, 0.1), planks(9, 0.28, 7), (cc, w, h) => {
    cc.fillStyle = css([40, 28, 24], 1);
    cc.beginPath();
    cc.arc(w / 2, h * 0.62, 3.2, 0, Math.PI * 2);
    cc.fill();
    cc.fillStyle = css([220, 180, 100], 0.6);
    cc.beginPath();
    cc.arc(w / 2, h * 0.62, 2.2, 0, Math.PI * 2);
    cc.fill();
  }), 4.4);
  void c;
  return k.art;
}

export function bakeWorkshop(snow = false): Art {
  const k = new Kit(2, 2, 78);
  k.snow = snow;
  const c = k.ctx;
  const roof: RGB = [110, 78, 60];
  k.groundShadow(-0.85, 0.85, -0.85, 0.85, 0.9);
  k.box(0.26, 0.6, -0.72, -0.38, 14, 66, { left: stones([142, 132, 124], 51, 4), right: stones([104, 98, 94], 52, 4), top: solid([56, 52, 54], 1) });
  k.wallLeft(-0.82, 0.82, 0.82, 0, 26, compose(stones([178, 170, 158], 53, 6), ao(0.04, 0.2), (cc, w, h) => {
    // open work bay with a bench
    const bx = w * 0.14;
    const bw = w * 0.5;
    cc.fillStyle = css([34, 26, 28], 1);
    cc.fillRect(bx, h - 20, bw, 20);
    cc.fillStyle = css([74, 56, 46], 1);
    cc.fillRect(bx + 1, h - 19, bw - 2, 5);
    cc.fillStyle = css([150, 110, 74], 1);
    cc.fillRect(bx + 2, h - 9, bw - 4, 2.4);
    cc.fillStyle = css([110, 78, 54], 1);
    cc.fillRect(bx + 3, h - 6.6, 1.6, 6.6);
    cc.fillRect(bx + bw - 4.6, h - 6.6, 1.6, 6.6);
    // hanging tools
    cc.strokeStyle = css([190, 194, 204], 1);
    cc.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      cc.beginPath();
      cc.moveTo(bx + 4 + i * 5.2, h - 18);
      cc.lineTo(bx + 4 + i * 5.2, h - 12 - (i % 2) * 2);
      cc.stroke();
    }
    cc.fillStyle = css([236, 168, 70], 0.8);
    cc.fillRect(bx + bw + 4, 6, 6, 8);
    windowPane(cc, bx + bw + 3.5, 6, 6, 8, {});
    // timber posts around the bay
    cc.fillStyle = css(TIMBER, 1);
    cc.fillRect(bx - 2, h - 22, 2.4, 22);
    cc.fillRect(bx + bw - 0.4, h - 22, 2.4, 22);
    cc.fillRect(bx - 2, h - 22, bw + 4.4, 2.6);
  }));
  k.wallRight(0.82, -0.82, 0.82, 0, 26, compose(stones([140, 132, 124], 54, 6), ao(0.04, 0.2), (cc, w) => {
    windowPane(cc, w * 0.3, 8, 7, 8, { shutters: [90, 66, 52] });
  }));
  gableU(k, -0.82, 0.82, -0.82, 0.82, 26, 17, 0.16, roof, compose(stones([140, 132, 124], 55, 6)), 4);
  k.top(0.18, 0.36, -0.44, -0.3, 66, solid([30, 26, 28], 1), 0);
  // anvil on a stump, grindstone
  const sx = 1.05;
  const sy = 0.58;
  k.box(sx - 0.14, sx + 0.14, sy - 0.14, sy + 0.14, 0, 8, { left: compose(solid([142, 100, 66], 1), planks(3, 0.3, 9)), right: compose(solid([142, 100, 66], 0.72), planks(3, 0.3, 10)), top: solid([196, 156, 108], 1) }, 0.55);
  k.box(sx - 0.16, sx + 0.18, sy - 0.1, sy + 0.1, 8, 13, { left: solid([88, 90, 100], 1), right: solid([88, 90, 100], 0.7), top: solid([128, 130, 142], 1) }, 0.55);
  c.fillStyle = css([88, 90, 100], 1);
  const horn = k.P(sx + 0.2, sy, 12);
  c.beginPath();
  c.moveTo(horn.x, horn.y - 1);
  c.lineTo(horn.x + 5, horn.y + 1);
  c.lineTo(horn.x, horn.y + 2.5);
  c.fill();
  const gp = k.P(-0.2, 1.08, 6);
  c.fillStyle = css([40, 34, 36], 1);
  c.beginPath();
  c.ellipse(gp.x, gp.y, 7, 7.6, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = css([160, 160, 170], 1);
  c.beginPath();
  c.ellipse(gp.x - 0.4, gp.y - 0.4, 5.6, 6.2, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = css([110, 112, 124], 1);
  c.beginPath();
  c.ellipse(gp.x, gp.y, 1.6, 1.8, 0, 0, Math.PI * 2);
  c.fill();
  return k.art;
}

// --- Farm ---------------------------------------------------------------------------------------

export function bakeFarm(stage: number): Art {
  const k = new Kit(3, 3, 40);
  const c = k.ctx;
  const winter = stage >= 5;
  const rng = mulberry32(77 + stage);
  const soil: RGB = winter ? [128, 112, 100] : [104, 74, 50];
  k.groundShadow(-1.5, 1.5, -1.5, 1.5, 0.5);
  // framed soil bed
  k.box(-1.5, 1.5, -1.5, 1.5, 0, 3, {
    left: compose(solid(WOOD, 1), planks(14, 0.3, 11)),
    right: compose(solid(WOOD, 0.74), planks(14, 0.3, 12)),
    top: compose(solid(soil, 1, 0.04), (cc, w, h) => {
      // furrows run along the u axis (local x)
      const rows = 7;
      for (let r = 0; r < rows; r++) {
        const y = ((r + 0.5) / rows) * h;
        cc.fillStyle = css(winter ? [96, 84, 78] : [66, 44, 30], 0.7);
        cc.fillRect(0, y - 1.6, w, 3.2);
        cc.fillStyle = css(winter ? [196, 184, 170] : [150, 108, 74], 0.55);
        cc.fillRect(0, y - 4.4, w, 1.6);
      }
      for (let i = 0; i < 160; i++) {
        cc.fillStyle = css(rng() < 0.5 ? [62, 42, 30] : [176, 134, 96], 0.35);
        cc.fillRect(rng() * w, rng() * h, 1, 1);
      }
    }),
  });
  // crops
  const rows = 7;
  const perRow = 12;
  for (let r = 0; r < rows; r++) {
    const v = -1.5 + ((r + 0.5) / rows) * 3;
    for (let i = 0; i < perRow; i++) {
      const u = -1.38 + (i / (perRow - 1)) * 2.76;
      const p = k.P(u, v - 0.02, 3);
      plant(c, p, stage, rng);
    }
  }
  if (winter) {
    c.fillStyle = css([240, 246, 255], 0.2);
    k.poly([k.P(-1.5, -1.5, 3), k.P(1.5, -1.5, 3), k.P(1.5, 1.5, 3), k.P(-1.5, 1.5, 3)]);
    c.fill();
  }
  // fence along the front two sides (gate gap on the +v side)
  const post = (u: number, v: number): void => {
    const a = k.P(u, v, 3);
    c.fillStyle = css([40, 30, 26], 1);
    c.fillRect(a.x - 1.6, a.y - 12, 3.2, 12.5);
    c.fillStyle = css([170, 126, 84], 1);
    c.fillRect(a.x - 1, a.y - 11.4, 2, 11.4);
  };
  const rail = (u0: number, v0: number, u1: number, v1: number): void => {
    for (const hh of [6, 10]) {
      const a = k.P(u0, v0, 3 + hh - 3);
      const b = k.P(u1, v1, 3 + hh - 3);
      c.strokeStyle = css([40, 30, 26], 1);
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(a.x, a.y - 3);
      c.lineTo(b.x, b.y - 3);
      c.stroke();
      c.strokeStyle = css([176, 132, 88], 1);
      c.lineWidth = 1.3;
      c.stroke();
    }
  };
  for (let i = 0; i <= 6; i++) {
    const t = -1.5 + (i / 6) * 3;
    if (i !== 3) post(t, 1.5);
    post(1.5, t);
  }
  rail(-1.5, 1.5, -0.25, 1.5);
  rail(0.25, 1.5, 1.5, 1.5);
  rail(1.5, 1.5, 1.5, -1.5);
  // scarecrow
  if (stage >= 1) {
    const sp = k.P(0.2, -0.2, 3);
    c.strokeStyle = css([70, 48, 34], 1);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(sp.x, sp.y);
    c.lineTo(sp.x, sp.y - 24);
    c.moveTo(sp.x - 8, sp.y - 17);
    c.lineTo(sp.x + 8, sp.y - 17);
    c.stroke();
    c.fillStyle = css([186, 96, 70], 1);
    c.beginPath();
    c.moveTo(sp.x - 5, sp.y - 18);
    c.lineTo(sp.x + 5, sp.y - 18);
    c.lineTo(sp.x + 4, sp.y - 9);
    c.lineTo(sp.x - 4, sp.y - 9);
    c.fill();
    c.fillStyle = css([226, 196, 120], 1);
    c.beginPath();
    c.arc(sp.x, sp.y - 23, 3.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = css([150, 106, 64], 1);
    c.beginPath();
    c.ellipse(sp.x, sp.y - 25.4, 6, 1.6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillRect(sp.x - 2.6, sp.y - 29, 5.2, 4);
  }
  return k.art;
}

function plant(c: CanvasRenderingContext2D, p: { x: number; y: number }, stage: number, rng: () => number): void {
  const j = (rng() - 0.5) * 1.6;
  switch (stage) {
    case 0:
      if (rng() < 0.2) {
        c.fillStyle = css([120, 170, 80], 0.8);
        c.fillRect(p.x, p.y - 1, 1.2, 1.2);
      }
      return;
    case 1:
      c.fillStyle = css([128, 184, 84], 1);
      c.fillRect(p.x - 0.6 + j, p.y - 2.6, 1.4, 2.8);
      c.fillRect(p.x - 1.6 + j, p.y - 3, 1.4, 1.2);
      c.fillRect(p.x + 0.4 + j, p.y - 3.2, 1.4, 1.2);
      return;
    case 2:
    case 3: {
      const h = stage === 2 ? 5.5 : 8.5;
      c.strokeStyle = css(stage === 2 ? [96, 164, 70] : [146, 178, 70], 1);
      c.lineWidth = 1.2;
      for (const dx of [-1.6, 0, 1.6]) {
        c.beginPath();
        c.moveTo(p.x + dx * 0.4, p.y);
        c.quadraticCurveTo(p.x + dx + j, p.y - h * 0.6, p.x + dx * 1.6 + j, p.y - h);
        c.stroke();
      }
      return;
    }
    case 4: {
      const h = 10.5;
      for (const dx of [-1.8, 0, 1.8]) {
        c.strokeStyle = css([196, 164, 70], 1);
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(p.x + dx * 0.4, p.y);
        c.quadraticCurveTo(p.x + dx + j, p.y - h * 0.6, p.x + dx * 1.4 + j, p.y - h);
        c.stroke();
        c.fillStyle = css([238, 200, 84], 1);
        c.beginPath();
        c.ellipse(p.x + dx * 1.4 + j, p.y - h - 1.4, 1.1, 2.4, 0, 0, Math.PI * 2);
        c.fill();
      }
      return;
    }
    default:
      if (rng() < 0.4) {
        c.strokeStyle = css([150, 126, 90], 0.9);
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x + j, p.y - 3.4);
        c.stroke();
      }
  }
}

// --- Lumber camp ------------------------------------------------------------------------------------

export function bakeLumberCamp(snow = false): Art {
  const k = new Kit(2, 2, 54);
  k.snow = snow;
  const c = k.ctx;
  const rng = mulberry32(91);
  // trampled earth with sawdust
  k.top(-0.98, 0.98, -0.98, 0.98, 0, compose(solid([142, 112, 76], 1, 0.02), (cc, w, h) => {
    for (let i = 0; i < 90; i++) {
      cc.fillStyle = css(rng() < 0.5 ? [206, 170, 114] : [96, 70, 48], 0.45);
      cc.beginPath();
      cc.ellipse(rng() * w, rng() * h, 1 + rng() * 2, 0.6 + rng(), rng() * 3, 0, Math.PI * 2);
      cc.fill();
    }
  }), 0);
  // tent (ridge along u)
  const u0 = -0.88;
  const u1 = 0.2;
  const v0 = -0.82;
  const v1 = 0.1;
  const vm = (v0 + v1) / 2;
  const rise = 30;
  k.groundShadow(u0, u1, v0, v1, 0.6);
  // back is hidden; gable end (+u) is the open flap
  const tri = [k.P(u1, v1, 0), k.P(u1, v0, 0), k.P(u1, vm, rise)];
  k.poly(tri);
  c.fillStyle = css([226, 204, 156], 1);
  c.fill();
  k.poly(tri);
  c.strokeStyle = css([60, 44, 34], 0.7);
  c.lineWidth = 1;
  c.stroke();
  // dark opening
  const d0 = k.P(u1, vm + 0.2, 0);
  const d1 = k.P(u1, vm - 0.2, 0);
  const d2 = k.P(u1, vm, 19);
  k.poly([d0, d1, d2]);
  c.fillStyle = css([40, 30, 28], 1);
  c.fill();
  // front slope
  const ro = k.P(u0, vm, rise);
  const ra = k.P(u1, vm, rise);
  const rb = k.P(u0, v1, 0);
  k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, compose(solid([230, 208, 160], 1, 0.12), (cc, w, h) => {
    cc.fillStyle = css([176, 70, 56], 0.9);
    cc.fillRect(0, h * 0.34, w, h * 0.12);
    cc.fillStyle = css([0, 0, 0], 0.08);
    for (let x = 6; x < w; x += 9) cc.fillRect(x, 0, 0.8, h);
  }, ao(0.05, 0.2)));
  if (snow) k.surface(ro, { x: ra.x - ro.x, y: ra.y - ro.y }, { x: rb.x - ro.x, y: rb.y - ro.y }, snowBlanket(0.8), 0);
  c.strokeStyle = css([120, 86, 56], 1);
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(ro.x, ro.y - 0.5);
  c.lineTo(ra.x + 0.5, ra.y - 0.5);
  c.stroke();
  // sawhorse with a log
  const horse = (u: number): void => {
    const a = k.P(u, 0.62, 0);
    const b = k.P(u, 0.62, 12);
    c.strokeStyle = css([60, 42, 30], 1);
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(a.x - 4, a.y);
    c.lineTo(b.x + 1, b.y);
    c.moveTo(a.x + 4, a.y);
    c.lineTo(b.x - 1, b.y);
    c.stroke();
  };
  horse(0.35);
  horse(0.95);
  const l0 = k.P(0.2, 0.62, 13);
  const l1 = k.P(1.1, 0.62, 13);
  c.strokeStyle = css([60, 40, 28], 1);
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(l0.x, l0.y);
  c.lineTo(l1.x, l1.y);
  c.stroke();
  c.strokeStyle = css([170, 124, 82], 1);
  c.lineWidth = 5.6;
  c.stroke();
  c.strokeStyle = css([210, 166, 116], 1);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(l0.x + 1, l0.y - 1.6);
  c.lineTo(l1.x - 1, l1.y - 1.6);
  c.stroke();
  c.fillStyle = css([232, 196, 140], 1);
  c.beginPath();
  c.ellipse(l1.x, l1.y, 2.4, 3, 0, 0, Math.PI * 2);
  c.fill();
  // chopping stump with axe
  const sp = k.P(-0.35, 0.82, 0);
  k.box(-0.5, -0.2, 0.68, 0.98, 0, 8, { left: compose(solid([150, 106, 70], 1), planks(4, 0.25, 21)), right: compose(solid([150, 106, 70], 0.7), planks(4, 0.25, 22)), top: compose(solid([214, 176, 126], 1), (cc, w, h) => { cc.strokeStyle = 'rgba(120,80,50,0.6)'; cc.lineWidth = 0.7; cc.beginPath(); cc.ellipse(w / 2, h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2); cc.stroke(); }) }, 0.5);
  c.strokeStyle = css([60, 40, 28], 1);
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(sp.x, sp.y - 9);
  c.lineTo(sp.x + 6, sp.y - 20);
  c.stroke();
  c.fillStyle = css([190, 196, 206], 1);
  c.beginPath();
  c.moveTo(sp.x + 3, sp.y - 19);
  c.lineTo(sp.x + 10, sp.y - 20);
  c.lineTo(sp.x + 8, sp.y - 14);
  c.fill();
  // chips
  for (let i = 0; i < 14; i++) {
    const p = k.P(0.1 + rng() * 0.9, 0.4 + rng() * 0.6, 0);
    c.fillStyle = css([222, 186, 130], 0.9);
    c.fillRect(p.x, p.y, 2, 1);
  }
  return k.art;
}

// --- Mine -----------------------------------------------------------------------------------------

export function bakeMine(snow = false): Art {
  const k = new Kit(2, 2, 76);
  k.snow = snow;
  const c = k.ctx;
  const rng = mulberry32(131);
  k.top(-0.98, 0.98, -0.98, 0.98, 0, compose(solid([132, 118, 100], 1, 0.02), (cc, w, h) => {
    for (let i = 0; i < 70; i++) {
      cc.fillStyle = css(rng() < 0.5 ? [90, 80, 70] : [176, 166, 150], 0.5);
      cc.beginPath();
      cc.ellipse(rng() * w, rng() * h, 1 + rng() * 2, 0.6 + rng(), rng() * 3, 0, Math.PI * 2);
      cc.fill();
    }
  }), 0);
  k.groundShadow(-0.92, 0.92, -0.92, 0.5, 0.8);
  const rock: RGB = [138, 134, 130];
  // the rock mass
  k.wallLeft(-0.92, 0.92, 0.5, 0, 44, compose(facets(rock, 61, 46), ao(0.0, 0.22), (cc, w, h) => {
    // timbered entrance
    const ew = 17;
    const ex = w / 2 - ew / 2;
    cc.fillStyle = css([20, 16, 18], 1);
    cc.beginPath();
    cc.moveTo(ex, h);
    cc.lineTo(ex, h - 22);
    cc.quadraticCurveTo(ex + ew / 2, h - 30, ex + ew, h - 22);
    cc.lineTo(ex + ew, h);
    cc.fill();
    const g = cc.createLinearGradient(0, h - 20, 0, h);
    g.addColorStop(0, 'rgba(120,90,50,0.0)');
    g.addColorStop(1, 'rgba(120,90,50,0.5)');
    cc.fillStyle = g;
    cc.fillRect(ex, h - 22, ew, 22);
    cc.fillStyle = css([138, 98, 62], 1);
    cc.fillRect(ex - 3, h - 24, 3.4, 24);
    cc.fillRect(ex + ew - 0.4, h - 24, 3.4, 24);
    cc.fillRect(ex - 4, h - 26, ew + 8, 3.6);
    cc.fillStyle = css([88, 60, 40], 1);
    cc.fillRect(ex - 4, h - 23, ew + 8, 1);
    // hanging lantern
    cc.fillStyle = css([255, 214, 120], 1);
    cc.beginPath();
    cc.arc(ex + ew + 6, h - 16, 1.8, 0, Math.PI * 2);
    cc.fill();
    cc.fillStyle = css([255, 214, 120], 0.25);
    cc.beginPath();
    cc.arc(ex + ew + 6, h - 16, 5, 0, Math.PI * 2);
    cc.fill();
  }));
  k.wallRight(0.92, -0.92, 0.5, 0, 44, compose(facets([112, 108, 106], 62, 40), ao(0, 0.25)));
  // irregular top: grassy rock
  k.top(-0.92, 0.92, -0.92, 0.5, 44, compose(solid([128, 124, 118], 1), (cc, w, h) => {
    for (let i = 0; i < 14; i++) {
      const g = cc.createRadialGradient(0, 0, 0, 0, 0, 1);
      void g;
      cc.fillStyle = css(rng() < 0.55 ? [112, 150, 82] : [158, 154, 146], 0.8);
      cc.beginPath();
      cc.ellipse(rng() * w, rng() * h, 5 + rng() * 10, 3 + rng() * 5, rng() * 3, 0, Math.PI * 2);
      cc.fill();
    }
  }));
  if (snow) {
    k.top(-0.92, 0.92, -0.92, 0.5, 44, (cc, w, h) => {
      const g = cc.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(252,254,255,0.96)');
      g.addColorStop(1, 'rgba(214,226,244,0.92)');
      cc.fillStyle = g;
      cc.beginPath();
      cc.roundRect(3, 3, w - 6, h - 5, 10);
      cc.fill();
    }, 0);
  }
  // rocks breaking the silhouette
  for (const [u, v, r] of [
    [-0.7, -0.6, 12],
    [0.7, -0.5, 11],
    [0.1, -0.8, 10],
    [-0.3, 0.1, 9],
    [0.5, 0.2, 8],
  ] as const) {
    const p = k.P(u, v, 46);
    c.fillStyle = css([50, 48, 54], 1);
    c.beginPath();
    c.ellipse(p.x, p.y - r * 0.3, r + 1, r * 0.7 + 1, 0, 0, Math.PI * 2);
    c.fill();
    const g = c.createRadialGradient(p.x - r * 0.3, p.y - r * 0.6, 1, p.x, p.y - r * 0.3, r);
    g.addColorStop(0, css([190, 186, 178], 1));
    g.addColorStop(1, css([110, 106, 108], 1));
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(p.x, p.y - r * 0.3, r, r * 0.7, 0, 0, Math.PI * 2);
    c.fill();
  }
  // rails and cart
  for (const u of [-0.22, 0.22]) {
    const a = k.P(u, 0.52, 0);
    const b = k.P(u, 1.0, 0);
    c.strokeStyle = css([70, 66, 70], 1);
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const a = k.P(-0.3, 0.58 + i * 0.1, 0);
    const b = k.P(0.3, 0.58 + i * 0.1, 0);
    c.strokeStyle = css([112, 78, 52], 1);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  }
  k.box(-0.3, 0.3, 0.7, 0.98, 3, 13, { left: compose(solid([118, 84, 58], 1), planks(4, 0.3, 31)), right: compose(solid([118, 84, 58], 0.72), planks(3, 0.3, 32)), top: solid([40, 34, 36], 1) }, 0.5);
  for (const [u, v, r] of [
    [-0.12, 0.84, 3.4],
    [0.1, 0.86, 3],
    [0.0, 0.78, 3.2],
  ] as const) {
    const p = k.P(u, v, 14);
    c.fillStyle = css([40, 40, 46], 1);
    c.beginPath();
    c.ellipse(p.x, p.y - 1, r + 0.8, r * 0.8 + 0.8, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = css([176, 172, 168], 1);
    c.beginPath();
    c.ellipse(p.x, p.y - 1, r, r * 0.8, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = css([30, 30, 36], 1);
  for (const u of [-0.22, 0.22]) {
    const p = k.P(u, 0.99, 3);
    c.beginPath();
    c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    c.fill();
  }
  return k.art;
}

// --- Well ---------------------------------------------------------------------------------------

export function bakeWell(snow = false): Art {
  const k = new Kit(1, 1, 64, 10);
  k.snow = snow;
  const c = k.ctx;
  const cx = k.P(0, 0, 0);
  const rx = 0.36 * 45.25;
  const ry = 0.36 * 22.6;
  const H = 14;
  k.groundShadow(-0.4, 0.4, -0.4, 0.4, 0.8);
  // posts behind the well first
  const post = (u: number, v: number): void => {
    const a = k.P(u, v, H - 1);
    c.fillStyle = css([40, 28, 24], 1);
    c.fillRect(a.x - 2.4, a.y - 33, 4.8, 34);
    c.fillStyle = css([150, 106, 70], 1);
    c.fillRect(a.x - 1.6, a.y - 32.4, 3.2, 33);
  };
  post(-0.34, 0.34);
  // body
  c.save();
  c.beginPath();
  c.moveTo(cx.x - rx, cx.y - H);
  c.lineTo(cx.x - rx, cx.y);
  c.ellipse(cx.x, cx.y, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(cx.x + rx, cx.y - H);
  c.closePath();
  c.clip();
  const g = c.createLinearGradient(cx.x - rx, 0, cx.x + rx, 0);
  g.addColorStop(0, css([204, 196, 184], 1));
  g.addColorStop(0.55, css([162, 154, 144], 1));
  g.addColorStop(1, css([108, 102, 98], 1));
  c.fillStyle = g;
  c.fillRect(cx.x - rx - 1, cx.y - H - ry, rx * 2 + 2, H + ry * 2 + 2);
  const rng = mulberry32(5);
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 9; i++) {
      const x = cx.x - rx + ((i + (row % 2) * 0.5) / 8) * rx * 2;
      const y = cx.y - H + row * 5 + (Math.sqrt(Math.max(0, 1 - Math.pow((x - cx.x) / rx, 2))) * ry);
      c.strokeStyle = css([60, 56, 56], 0.45);
      c.lineWidth = 0.7;
      c.strokeRect(x - 2.5, y - 4.8, 5.5, 4.8);
      c.fillStyle = css(rng() < 0.5 ? [255, 255, 255] : [0, 0, 0], 0.06);
      c.fillRect(x - 2.5, y - 4.8, 5.5, 4.8);
    }
  }
  c.restore();
  c.strokeStyle = css([40, 34, 36], 0.7);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(cx.x - rx, cx.y - H);
  c.lineTo(cx.x - rx, cx.y);
  c.ellipse(cx.x, cx.y, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(cx.x + rx, cx.y - H);
  c.stroke();
  // rim and water
  c.fillStyle = css([210, 202, 190], 1);
  c.beginPath();
  c.ellipse(cx.x, cx.y - H, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = css([60, 54, 54], 0.7);
  c.stroke();
  c.fillStyle = css([34, 56, 78], 1);
  c.beginPath();
  c.ellipse(cx.x, cx.y - H, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = css([92, 168, 220], 1);
  c.beginPath();
  c.ellipse(cx.x, cx.y - H + 1, rx * 0.64, ry * 0.58, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = css([210, 238, 252], 0.7);
  c.beginPath();
  c.ellipse(cx.x - 3, cx.y - H, 3.4, 1, 0, 0, Math.PI * 2);
  c.fill();
  post(0.34, -0.34);
  // little roof
  gableU(k, -0.46, 0.46, -0.46, 0.46, H + 32, 12, 0.14, [186, 92, 66], compose(solid([226, 208, 170], 0.76, 0.05)), 3.6);
  // rope and bucket
  const rp = k.P(0, 0, H + 28);
  c.strokeStyle = css([60, 44, 32], 1);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(rp.x, rp.y);
  c.lineTo(rp.x, rp.y + 10);
  c.stroke();
  c.fillStyle = css([40, 30, 24], 1);
  c.fillRect(rp.x - 3.4, rp.y + 9.6, 6.8, 6.2);
  c.fillStyle = css([170, 124, 82], 1);
  c.fillRect(rp.x - 2.8, rp.y + 10.2, 5.6, 5);
  return k.art;
}
