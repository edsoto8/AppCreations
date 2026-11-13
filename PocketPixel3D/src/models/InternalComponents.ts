import * as THREE from 'three';
import { bodyOutline } from './BodyOutline';
import {
  BATTERY_BAY,
  BAY,
  BUTTON_A,
  BUTTON_B,
  CONTRAST_WHEEL,
  DPAD,
  LCD_WINDOW,
  PILL,
  SELECT,
  SPEAKER,
  START,
  VOLUME_WHEEL,
} from './Layout';
import type { Materials } from './Materials';
import { capsuleShape, corners, crossShape, extrude, holeFromPoints, roundedRectShape, shapeFromPoints } from './Shapes';

export interface Internals {
  /** Front board: button contacts and the LCD connector. */
  lcdBoard: THREE.Group;
  /** Silicone membrane with conductive domes under the buttons. */
  membrane: THREE.Group;
  /** Main board: CPU, memory, regulators, cartridge connector, potentiometers. */
  cpuBoard: THREE.Group;
  speaker: THREE.Group;
  batteries: THREE.Group;
}

const LCD_BOARD_Z = 9.2;
const CPU_BOARD_Z = -1.2;
const BOARD_THICKNESS = 1.2;

/**
 * Simplified internal components for the exploded and transparent views. Uses instancing for the
 * repeated parts (IC pins, contacts) to keep draw calls down.
 */
export function buildInternals(m: Materials, track: (g: THREE.BufferGeometry) => void): Internals {
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    track(g);
    return g;
  };
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material, shadows = true): THREE.Mesh => {
    const mm = new THREE.Mesh(geo(g), mat);
    mm.castShadow = shadows;
    mm.receiveShadow = true;
    return mm;
  };

  // ---- LCD (front) board ----
  const lcdBoard = new THREE.Group();
  lcdBoard.name = 'lcd-board';
  const boardShape = shapeFromPoints(bodyOutline(3.2));
  // Window for the LCD module and the speaker.
  boardShape.holes.push(
    holeFromPoints(rectPoints(LCD_WINDOW.cx, LCD_WINDOW.cy, LCD_WINDOW.width + 9, LCD_WINDOW.height + 9)),
    holeFromPoints(circlePoints(SPEAKER.x, SPEAKER.y, 12.5)),
  );
  const lcdPcb = mesh(extrude(boardShape, BOARD_THICKNESS), m.pcb);
  lcdPcb.position.z = LCD_BOARD_Z;
  lcdBoard.add(lcdPcb);
  // Carbon contact pads.
  const padZ = LCD_BOARD_Z + BOARD_THICKNESS + 0.05;
  const padGeo = geo(new THREE.CircleGeometry(2.6, 24));
  const pads: [number, number][] = [
    [DPAD.x, DPAD.y + 8],
    [DPAD.x, DPAD.y - 8],
    [DPAD.x - 8, DPAD.y],
    [DPAD.x + 8, DPAD.y],
    [BUTTON_A.x, BUTTON_A.y],
    [BUTTON_B.x, BUTTON_B.y],
    [SELECT.x, SELECT.y],
    [START.x, START.y],
  ];
  for (const [x, y] of pads) {
    const ring = new THREE.Mesh(padGeo, m.copper);
    ring.position.set(x, y, padZ);
    const inner = new THREE.Mesh(padGeo, m.carbon);
    inner.scale.setScalar(0.65);
    inner.position.set(x, y, padZ + 0.02);
    lcdBoard.add(ring, inner);
  }
  // A few SMD parts and traces.
  addChips(lcdBoard, m, geo, [
    [-30, -58, 8, 5, 1.2],
    [-12, -64, 5, 3, 1],
    [32, -2, 6, 4, 1],
  ], padZ);
  const traceMat = m.copper;
  const traceGeo = geo(new THREE.PlaneGeometry(1, 0.35));
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(traceGeo, traceMat);
    t.scale.x = 18 + (i % 3) * 6;
    t.position.set(-18 + (i % 3) * 4, -6 - i * 1.6, padZ);
    lcdBoard.add(t);
  }
  // Ribbon cable from the LCD to the board.
  const ribbon = mesh(new THREE.BoxGeometry(30, 7, 0.25), m.copper, false);
  ribbon.position.set(LCD_WINDOW.cx, LCD_WINDOW.cy - LCD_WINDOW.height / 2 - 6, padZ + 0.6);
  ribbon.rotation.x = -0.25;
  lcdBoard.add(ribbon);

  // ---- Membrane ----
  const membrane = new THREE.Group();
  membrane.name = 'membrane';
  const memZ = LCD_BOARD_Z + BOARD_THICKNESS + 0.4;
  const memShapes = [
    crossShape(DPAD.x, DPAD.y, DPAD.span + 4, DPAD.arm + 4, 2),
    roundedRectShape((BUTTON_A.x + BUTTON_B.x) / 2, (BUTTON_A.y + BUTTON_B.y) / 2, 30, 12, corners(6)),
    capsuleShape(SELECT.x, SELECT.y, PILL.length + 4, PILL.width + 5, PILL.angle),
    capsuleShape(START.x, START.y, PILL.length + 4, PILL.width + 5, PILL.angle),
  ];
  const ab = memShapes[1]!;
  // Rotate the A/B membrane strip to follow the button diagonal.
  const abAngle = Math.atan2(BUTTON_A.y - BUTTON_B.y, BUTTON_A.x - BUTTON_B.x);
  const abPts = ab.getPoints(4).map((p) => {
    const cx = (BUTTON_A.x + BUTTON_B.x) / 2;
    const cy = (BUTTON_A.y + BUTTON_B.y) / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    return [cx + dx * Math.cos(abAngle) - dy * Math.sin(abAngle), cy + dx * Math.sin(abAngle) + dy * Math.cos(abAngle)] as [number, number];
  });
  memShapes[1] = shapeFromPoints(abPts);
  const sheet = mesh(extrude(memShapes, 0.6), m.membrane, false);
  sheet.position.z = memZ;
  membrane.add(sheet);
  const domeGeo = geo(new THREE.SphereGeometry(2.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  domeGeo.rotateX(Math.PI / 2);
  for (const [x, y] of pads) {
    const d = new THREE.Mesh(domeGeo, m.membrane);
    d.scale.z = 0.7;
    d.position.set(x, y, memZ + 0.6);
    membrane.add(d);
  }

  // ---- CPU board ----
  const cpuBoard = new THREE.Group();
  cpuBoard.name = 'cpu-board';
  const cpuShape = shapeFromPoints(bodyOutline(3.2));
  const cpuPcb = mesh(extrude(cpuShape, BOARD_THICKNESS), m.pcb);
  cpuPcb.position.z = CPU_BOARD_Z;
  cpuBoard.add(cpuPcb);
  const top = CPU_BOARD_Z + BOARD_THICKNESS;
  // CPU (QFP) with instanced pins.
  const cpu = mesh(new THREE.BoxGeometry(15, 15, 2), m.chip);
  cpu.position.set(0, -26, top + 1);
  cpuBoard.add(cpu);
  const pinGeo = geo(new THREE.BoxGeometry(0.35, 1.6, 0.3));
  const pinsPerSide = 18;
  const pins = new THREE.InstancedMesh(pinGeo, m.steel, pinsPerSide * 4);
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < pinsPerSide; i++) {
      const along = -6.8 + (13.6 * i) / (pinsPerSide - 1);
      const a = (side * Math.PI) / 2;
      dummy.position.set(Math.cos(a) * 8.1 + -Math.sin(a) * along, -26 + Math.sin(a) * 8.1 + Math.cos(a) * along, top + 0.3);
      dummy.rotation.set(0, 0, a + Math.PI / 2);
      dummy.updateMatrix();
      pins.setMatrixAt(idx++, dummy.matrix);
    }
  }
  pins.instanceMatrix.needsUpdate = true;
  cpuBoard.add(pins);
  addChips(cpuBoard, m, geo, [
    [-22, -48, 12, 7, 1.8],
    [20, -46, 12, 7, 1.8],
    [-24, -8, 8, 6, 1.4],
    [24, -14, 6, 6, 1.2],
    [0, -6, 9, 4, 1],
  ], top);
  // Electrolytic capacitors.
  const capGeo = geo(new THREE.CylinderGeometry(2.4, 2.4, 5, 20));
  capGeo.rotateX(Math.PI / 2);
  const capMat = m.batteryWrap;
  for (const [x, y] of [
    [-33, -30],
    [33, -30],
    [-8, -62],
    [10, -60],
  ] as const) {
    const c = new THREE.Mesh(capGeo, capMat);
    c.position.set(x, y, top + 2.5);
    c.castShadow = true;
    cpuBoard.add(c);
  }
  // Crystal.
  const xtal = mesh(new THREE.CapsuleGeometry(1.5, 6, 4, 12), m.steel);
  xtal.rotation.z = Math.PI / 2;
  xtal.position.set(-6, -40, top + 1.5);
  cpuBoard.add(xtal);
  // Potentiometers behind the thumb wheels.
  const potGeo = geo(new THREE.BoxGeometry(7, 9, 4));
  for (const [x, y] of [
    [38, VOLUME_WHEEL.y],
    [-38, CONTRAST_WHEEL.y],
  ] as const) {
    const pot = new THREE.Mesh(potGeo, m.chip);
    pot.position.set(x * 0.82, y, top + 2);
    cpuBoard.add(pot);
  }
  // Cartridge connector (edge connector with gold fingers).
  const conn = mesh(new THREE.BoxGeometry(BAY.halfWidth * 2 - 2, 5, 5), m.chip);
  conn.position.set(0, BAY.bottom - 1, top + 2.5);
  cpuBoard.add(conn);
  const fingerGeo = geo(new THREE.BoxGeometry(0.9, 0.3, 3));
  const fingers = new THREE.InstancedMesh(fingerGeo, m.gold, 32);
  for (let i = 0; i < 32; i++) {
    dummy.position.set(-25 + i * (50 / 31), BAY.bottom + 1.6, top + 2.5);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    fingers.setMatrixAt(i, dummy.matrix);
  }
  fingers.instanceMatrix.needsUpdate = true;
  cpuBoard.add(fingers);

  // ---- Speaker (visible through the grille) ----
  const speaker = new THREE.Group();
  speaker.name = 'speaker';
  const felt = mesh(new THREE.CircleGeometry(13, 40), m.black, false);
  felt.position.set(SPEAKER.x, SPEAKER.y, 11.0);
  const cone = mesh(new THREE.CylinderGeometry(12, 5, 3, 40, 1, true), m.speakerCone, false);
  cone.rotation.x = -Math.PI / 2;
  cone.position.set(SPEAKER.x, SPEAKER.y, 9.6);
  (cone.material as THREE.Material).side = THREE.DoubleSide;
  const magnet = mesh(new THREE.CylinderGeometry(5, 5, 3.4, 28), m.steel);
  magnet.rotation.x = Math.PI / 2;
  magnet.position.set(SPEAKER.x, SPEAKER.y, 6.6);
  const rim = mesh(new THREE.TorusGeometry(12.6, 0.6, 8, 40), m.steel, false);
  rim.position.set(SPEAKER.x, SPEAKER.y, 11.1);
  speaker.add(cone, magnet, rim, felt);
  felt.position.z = 8.2;

  // ---- Batteries (4 × AA, alternating) ----
  const batteries = new THREE.Group();
  batteries.name = 'batteries';
  const bb = BATTERY_BAY;
  const r = 6.3;
  const len = 46;
  const cellGeo = geo(new THREE.CylinderGeometry(r, r, len, 32));
  cellGeo.rotateZ(Math.PI / 2);
  const bandGeo = geo(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 6, 32, 1, true));
  bandGeo.rotateZ(Math.PI / 2);
  const nubGeo = geo(new THREE.CylinderGeometry(2.4, 2.4, 1.4, 16));
  nubGeo.rotateZ(Math.PI / 2);
  const springGeo = geo(new THREE.TubeGeometry(new HelixCurve(3.2, 4.5, 4.5), 80, 0.35, 6, false));
  springGeo.rotateY(Math.PI / 2);
  const z = -2.4 - r;
  for (let i = 0; i < 4; i++) {
    const y = bb.cy - bb.height / 2 + 3 + r + i * (2 * r + 0.6);
    const dir = i % 2 === 0 ? 1 : -1;
    const cell = new THREE.Mesh(cellGeo, m.batteryWrap);
    cell.position.set(0, y, z);
    cell.castShadow = cell.receiveShadow = true;
    const band = new THREE.Mesh(bandGeo, m.steel);
    band.position.set(dir * (len / 2 - 3), y, z);
    const nub = new THREE.Mesh(nubGeo, m.steel);
    nub.position.set(dir * (len / 2 + 0.7), y, z);
    const spring = new THREE.Mesh(springGeo, m.steel);
    spring.position.set(-dir * (len / 2 + 0.2), y, z);
    spring.scale.x = -dir;
    batteries.add(cell, band, nub, spring);
  }

  return { lcdBoard, membrane, cpuBoard, speaker, batteries };
}

function addChips(
  parent: THREE.Group,
  m: Materials,
  geo: <T extends THREE.BufferGeometry>(g: T) => T,
  chips: readonly (readonly [number, number, number, number, number])[],
  z: number,
): void {
  for (const [x, y, w, h, d] of chips) {
    const chip = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m.chip);
    chip.position.set(x, y, z + d / 2);
    chip.castShadow = true;
    parent.add(chip);
  }
}

function rectPoints(cx: number, cy: number, w: number, h: number): [number, number][] {
  return [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2],
    [cx - w / 2, cy + h / 2],
  ];
}

function circlePoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** Helix along +z: used for battery springs. */
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly radius: number,
    private readonly length: number,
    private readonly turns: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, (t - 0.5) * this.length);
  }
}
