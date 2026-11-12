import {
  BoxGeometry,
  BufferAttribute,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { BuildContext } from '../shared/context';
import { extrudeY, extrudeZ, mat, roundedRectXY, roundedRectXZ, superEllipsoid } from '../shared/geometry';
import { createRng } from '../shared/rng';
import type { StatusDisplay } from './display';
import {
  BODY_TOP,
  DECK_TOP,
  HW,
  LID_Y0,
  PANEL_X0,
  PANEL_X1,
  PANEL_Z,
  TOP,
  TRIM,
  TX0,
  TX1,
  TXC,
} from './layout';

/** Slab facing X (front/back panel) spanning z0..z1, y0..y1 and x0..x1 with rounded corners. */
function slabX(z0: number, z1: number, y0: number, y1: number, x0: number, x1: number, r: number, bevel: number, curve: number): BufferGeometry {
  const g = extrudeZ(roundedRectXY(-z1, -z0, y0, y1, r), x0, x1, { bevel, bevelSegments: 2, curveSegments: curve });
  g.rotateY(Math.PI / 2);
  return g;
}

/** Slab facing Z (side panel) spanning x0..x1, y0..y1 and z0..z1. */
function slabZ(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number, bevel: number, curve: number): BufferGeometry {
  return extrudeZ(roundedRectXY(x0, x1, y0, y1, r), z0, z1, { bevel, bevelSegments: 2, curveSegments: curve });
}

export interface HousingParts {
  root: Group;
  /** Objects hidden by the cutaway (the +Z half of the housing). */
  nearHalf: Group;
  /** Section caps shown only in cutaway. */
  caps: Group;
}

/** Tower frame: corner extrusions, back panel with exhaust grille, internal back wall and tank deck. */
export function buildHousing(ctx: BuildContext): HousingParts {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'dockHousing';
  const nearHalf = new Group();
  const farHalf = new Group();
  const caps = new Group();
  caps.visible = false;
  root.add(nearHalf, farHalf, caps);
  const trimH = BODY_TOP - 0.012;
  for (const half of [1, -1] as const) {
    const parent = half > 0 ? nearHalf : farHalf;
    const b = ctx.builder();
    for (const x of [TX0 + TRIM / 2, TX1 - TRIM / 2]) {
      b.add(new RoundedBoxGeometry(TRIM, trimH, TRIM, 3, 0.011), mats.brushedAlu, mat(x, 0.012 + trimH / 2, half * (HW - TRIM / 2)));
    }
    b.add(slabX(half > 0 ? 0.0012 : -PANEL_Z, half > 0 ? PANEL_Z : -0.0012, 0.012, BODY_TOP, TX1 - 0.008, TX1, 0.004, 0.0015, q.curve), mats.pearl);
    // Exhaust grille on the back panel.
    const gz0 = half > 0 ? 0.006 : -0.13;
    const gz1 = half > 0 ? 0.13 : -0.006;
    b.add(new BoxGeometry(0.003, 0.07, gz1 - gz0), mats.blackMatte, mat(TX1 + 0.0002, 0.085, (gz0 + gz1) / 2));
    for (let k = 0; k < 9; k++) {
      b.add(new BoxGeometry(0.004, 0.0035, gz1 - gz0), mats.titanium, mat(TX1 + 0.001, 0.056 + k * 0.0075, (gz0 + gz1) / 2, 0, 0, -0.5));
    }
    b.build(parent, { castShadow: true, receiveShadow: true, xray: true, name: `housing-${half}` });
  }
  const core = ctx.builder();
  core.add(new BoxGeometry(0.004, BODY_TOP - 0.012, 2 * PANEL_Z), mats.graphite, mat(TX1 - 0.012, (BODY_TOP + 0.012) / 2, 0));
  core.add(new RoundedBoxGeometry(TX1 - TX0, DECK_TOP - BODY_TOP, 2 * HW, 2, 0.003), mats.graphite, mat(TXC, (BODY_TOP + DECK_TOP) / 2, 0));
  // Throat: rubber-lined port where the base-plate channel enters the tower.
  core.add(new BoxGeometry(0.016, 0.026, 0.12), mats.blackMatte, mat(TX0 + 0.007, 0.026, 0));
  core.add(new RoundedBoxGeometry(0.004, 0.003, 0.124, 1, 0.001), mats.rubber, mat(TX0 - 0.0005, 0.0395, 0));
  core.add(new BoxGeometry(0.002, 0.08, 0.06), mats.connector, mat(TX1 + 0.0004, 0.2, -0.15));
  core.add(new BoxGeometry(0.003, 0.022, 0.03), mats.blackMatte, mat(TX1 + 0.001, 0.2, -0.15));
  core.build(farHalf, { castShadow: true, receiveShadow: true, name: 'housing-core' });

  const cap = ctx.builder();
  cap.add(new PlaneGeometry(0.008, BODY_TOP - 0.012), mats.hatch, mat(TX1 - 0.004, (BODY_TOP + 0.012) / 2, 0.0002));
  cap.add(new PlaneGeometry(0.008, 0.256), mats.hatch, mat(TX0 + 0.004, 0.168, 0.0002));
  cap.add(new PlaneGeometry(TX1 - TX0, TOP - LID_Y0), mats.hatch, mat(TXC, (TOP + LID_Y0) / 2, 0.0002));
  cap.build(caps, { name: 'section-caps' });
  return { root, nearHalf, caps };
}

/** Removable front panel in two halves (the +Z half hides in cutaway). */
export function buildFrontPanel(ctx: BuildContext): { root: Group; near: Group; slide: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'frontPanel';
  const slide = new Group();
  root.add(slide);
  const near = new Group();
  const far = new Group();
  slide.add(near, far);
  const y0 = 0.04;
  const y1 = 0.296;
  for (const half of [1, -1] as const) {
    const b = ctx.builder();
    b.add(slabX(half > 0 ? 0.0012 : -PANEL_Z, half > 0 ? PANEL_Z : -0.0012, y0, y1, TX0, TX0 + 0.008, 0.006, 0.002, q.curve), mats.pearl);
    for (let row = 0; row < 3; row++) {
      for (let k = 1; k <= 14; k++) {
        const z = half * (k * 0.0085 + (row % 2) * 0.004);
        b.add(new CylinderGeometry(0.0013, 0.0013, 0.001, 8), mats.blackMatte, mat(TX0 - 0.0002, 0.075 + row * 0.0075, z, 0, 0, Math.PI / 2));
      }
    }
    b.build(half > 0 ? near : far, { castShadow: true, receiveShadow: true, xray: true, name: `front-${half}` });
  }
  const accent = ctx.builder();
  accent.add(new RoundedBoxGeometry(0.004, y1 - y0 - 0.03, 0.005, 2, 0.0015), mats.champagne, mat(TX0 - 0.0005, (y0 + y1) / 2 + 0.01, 0));
  accent.build(far, { name: 'front-accent' });
  return { root, near, slide };
}

/** Left/right removable side panels with recessed grips. */
export function buildSidePanels(ctx: BuildContext): { root: Group; left: Group; right: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'sidePanels';
  const left = new Group();
  const right = new Group();
  root.add(left, right);
  for (const s of [1, -1] as const) {
    const b = ctx.builder();
    const z0 = s > 0 ? HW - 0.008 : -HW;
    b.add(slabZ(PANEL_X0 + 0.001, PANEL_X1 - 0.001, 0.02, BODY_TOP - 0.004, z0, z0 + 0.008, 0.006, 0.002, q.curve), mats.pearl);
    b.add(new RoundedBoxGeometry(0.08, 0.012, 0.003, 2, 0.0015), mats.blackMatte, mat(TXC, BODY_TOP - 0.03, s * (HW + 0.0003)));
    b.add(new RoundedBoxGeometry(0.15, 0.0016, 0.0014, 1, 0.0005), mats.champagne, mat(TXC, 0.06, s * (HW + 0.0002)));
    b.build(s > 0 ? left : right, { castShadow: true, receiveShadow: true, xray: true, name: `side-${s}` });
  }
  return { root, left, right };
}

/** Black-glass fascia with the status display and touch keys. */
export function buildFascia(ctx: BuildContext, display: StatusDisplay): { root: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'statusDisplay';
  const b = ctx.builder();
  b.add(slabX(-PANEL_Z, PANEL_Z, 0.297, BODY_TOP - 0.001, TX0 - 0.003, TX0 + 0.012, 0.004, 0.0015, q.curve), mats.darkGlass);
  for (const s of [1, -1]) {
    b.add(new TorusGeometry(0.0042, 0.0006, 6, q.radialSmall), mats.iconGlow, mat(TX0 - 0.0032, 0.3135, s * 0.115, 0, Math.PI / 2, 0));
  }
  b.add(new CylinderGeometry(0.0012, 0.0012, 0.0006, 8), mats.iconGlow, mat(TX0 - 0.0032, 0.3135, 0.115, 0, 0, Math.PI / 2));
  b.build(root, { castShadow: true, name: 'fascia' });
  const screen = new Mesh(ctx.track.track(new PlaneGeometry(0.14, 0.028)), display.material);
  screen.position.set(TX0 - 0.0034, 0.3135, 0);
  screen.rotation.y = -Math.PI / 2;
  screen.name = 'display';
  root.add(screen);
  return { root };
}

/** Accent light strips (fascia underline + base halo). */
export function buildLightStrip(ctx: BuildContext): { root: Group } {
  const { mats } = ctx;
  const root = new Group();
  root.name = 'lightStrip';
  const b = ctx.builder();
  b.add(new RoundedBoxGeometry(0.003, 0.0026, 2 * PANEL_Z - 0.02, 1, 0.0009), mats.lightStrip, mat(TX0 - 0.0035, 0.2985, 0));
  for (const s of [1, -1]) {
    b.add(new RoundedBoxGeometry(0.003, 0.0022, 0.1, 1, 0.0008), mats.lightStrip, mat(TX0 - 0.001, 0.0175, s * 0.125));
  }
  b.build(root, { name: 'strip' });
  return { root };
}

/** Pearl top lid in two halves with a smoked window over the bag. */
export function buildTopLid(ctx: BuildContext): { root: Group; near: Group } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'topLid';
  const near = new Group();
  const far = new Group();
  root.add(near, far);
  for (const half of [1, -1] as const) {
    const b = ctx.builder();
    const z0 = half > 0 ? 0.0008 : -HW;
    const z1 = half > 0 ? HW : -0.0008;
    b.add(extrudeY(roundedRectXZ(TX0, TX1, z0, z1, 0.012), LID_Y0, TOP, { bevel: 0.003, bevelSegments: q.bevel, curveSegments: q.curve }), mats.pearl);
    const w0 = half > 0 ? 0.0008 : -0.058;
    const w1 = half > 0 ? 0.058 : -0.0008;
    b.add(extrudeY(roundedRectXZ(TX0 + 0.03, TX1 - 0.03, w0, w1, 0.004), TOP - 0.0006, TOP + 0.0006, { curveSegments: q.curve }), mats.darkGlass);
    b.build(half > 0 ? near : far, { castShadow: true, receiveShadow: true, xray: true, name: `lid-${half}` });
  }
  return { root, near };
}

export interface TankParts {
  root: Group;
  water: Mesh;
}

const TANK_Y0 = DECK_TOP + 0.0008;
const TANK_H = LID_Y0 - TANK_Y0 - 0.001;
const TANK_Z0 = 0.071;
const TANK_Z1 = HW - 0.003;
export const WATER_MAX_H = TANK_H - 0.014;

/** Translucent water tank (clean = +Z, dirty = -Z) with an internal stand-pipe. */
export function buildTank(ctx: BuildContext, side: 1 | -1): TankParts {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = side > 0 ? 'cleanTank' : 'dirtyTank';
  const zc = side * (TANK_Z0 + TANK_Z1) / 2;
  const shellMat: Material = side > 0 ? mats.clearPoly : mats.amberPoly;
  const b = ctx.builder();
  b.add(new RoundedBoxGeometry(TX1 - TX0 - 0.004, TANK_H, TANK_Z1 - TANK_Z0, 4, 0.014), shellMat, mat(TXC, TANK_Y0 + TANK_H / 2, zc));
  b.build(root, { castShadow: true, name: `${root.name}-shell`, renderOrder: 3 });
  const d = ctx.builder();
  d.add(new CylinderGeometry(0.0055, 0.0055, TANK_H - 0.012, q.radialSmall), mats.titanium, mat(TX1 - 0.03, TANK_Y0 + TANK_H / 2, side * (TANK_Z1 - 0.028)));
  d.add(new CylinderGeometry(0.012, 0.014, 0.008, q.radialSmall * 2), mats.graphite, mat(0.4, TANK_Y0 + 0.004, side * 0.13));
  d.add(new RoundedBoxGeometry(0.07, 0.008, 0.018, 2, 0.003), mats.graphite, mat(TXC, TANK_Y0 + TANK_H - 0.006, zc));
  d.build(root, { name: `${root.name}-detail` });
  const wg = extrudeY(roundedRectXZ(TX0 + 0.007, TX1 - 0.007, side > 0 ? TANK_Z0 + 0.005 : -TANK_Z1 + 0.005, side > 0 ? TANK_Z1 - 0.005 : -TANK_Z0 - 0.005, 0.01), 0, 1, { curveSegments: q.curve });
  const water = new Mesh(ctx.track.track(wg), side > 0 ? mats.waterClean : mats.waterDirty);
  water.position.y = TANK_Y0 + 0.004;
  water.renderOrder = 1;
  water.name = `${root.name}-water`;
  root.add(water);
  return { root, water };
}

/** Dust-bag compartment with a translucent non-woven bag and debris mass scaled by fill. */
export function buildDustBag(ctx: BuildContext): { root: Group; bag: Mesh; dust: Mesh } {
  const { q, mats } = ctx;
  const root = new Group();
  root.name = 'dustBag';
  const b = ctx.builder();
  for (const s of [1, -1]) {
    b.add(new BoxGeometry(TX1 - TX0 - 0.01, TANK_H, 0.003), mats.graphite, mat(TXC + 0.004, TANK_Y0 + TANK_H / 2, s * 0.0675));
  }
  b.add(new BoxGeometry(0.004, TANK_H, 0.135), mats.graphite, mat(TX1 - 0.004, TANK_Y0 + TANK_H / 2, 0));
  b.add(new RoundedBoxGeometry(0.004, 0.012, 0.135, 2, 0.002), mats.graphite, mat(TX0 + 0.003, TANK_Y0 + 0.006, 0));
  b.add(new RoundedBoxGeometry(0.1, 0.004, 0.11, 2, 0.0015), mats.connector, mat(DUCT_COLLAR_X, TANK_Y0 + 0.004, 0));
  b.add(new TorusGeometry(0.02, 0.003, 8, q.radialSmall * 2), mats.rubber, mat(DUCT_COLLAR_X - 0.03, TANK_Y0 + 0.0065, 0, Math.PI / 2, 0, 0));
  b.build(root, { name: 'bag-bay' });
  const w = ctx.builder();
  w.add(new RoundedBoxGeometry(0.004, TANK_H - 0.004, 0.134, 2, 0.0018), mats.smokedGlass, mat(TX0 + 0.002, TANK_Y0 + TANK_H / 2 + 0.002, 0));
  w.build(root, { name: 'bag-window', renderOrder: 4 });

  const bagGeo = superEllipsoid(0.088, 0.06, 0.054, 0.42, q.level === 'low' ? 18 : 36, q.level === 'low' ? 12 : 24);
  const p = bagGeo.attributes.position as BufferAttribute;
  const rnd = createRng(31);
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (rnd() - 0.5) * 0.025;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * (1 + (rnd() - 0.5) * 0.02), p.getZ(i) * k);
  }
  bagGeo.computeVertexNormals();
  const bag = new Mesh(ctx.track.track(bagGeo), mats.fabricBag);
  bag.position.set(0.335, TANK_Y0 + 0.074, 0);
  bag.renderOrder = 2;
  bag.name = 'bag';
  root.add(bag);
  const dustGeo = superEllipsoid(0.078, 0.5, 0.046, 0.5, q.level === 'low' ? 16 : 28, 12);
  dustGeo.translate(0, 0.5, 0);
  const dust = new Mesh(ctx.track.track(dustGeo), mats.dust);
  dust.position.set(0.335, TANK_Y0 + 0.016, 0);
  dust.name = 'bag-dust';
  root.add(dust);
  return { root, bag, dust };
}

export const DUCT_COLLAR_X = 0.33;
