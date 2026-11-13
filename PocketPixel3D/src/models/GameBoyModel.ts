import * as THREE from 'three';
import { AnimatedValue, Ease, progressBetween } from '../animation/Tween';
import type { ButtonId } from '../games/GameInterface';
import { bodyOutline } from './BodyOutline';
import { buildInternals, type Internals } from './InternalComponents';
import {
  BACK_Z,
  BATTERY_BAY,
  BAY,
  BODY,
  BUTTON_A,
  BUTTON_B,
  CONTRAST_WHEEL,
  DC_JACK,
  DPAD,
  FRONT_Z,
  HALF_H,
  HALF_W,
  LCD_ACTIVE,
  LCD_WINDOW,
  LED,
  LENS,
  LINK_PORT,
  PHONES_JACK,
  PILL,
  POWER_SWITCH,
  SELECT,
  SPEAKER,
  START,
  VOLUME_WHEEL,
} from './Layout';
import type { Materials } from './Materials';
import { makeBackStickerTexture, makeFrontPrintTexture, makeLensTexture, makeSideLabelTexture } from './PrintTextures';
import {
  capsuleHole,
  capsuleShape,
  circleHole,
  corners,
  crossHole,
  crossShape,
  extrude,
  holeFromPoints,
  knurledWheel,
  roundedRectHole,
  roundedRectShape,
  shapeFromPoints,
} from './Shapes';

export type PartId =
  | 'front-shell'
  | 'back-shell'
  | 'lens'
  | 'screen'
  | 'led'
  | 'dpad'
  | 'button-a'
  | 'button-b'
  | 'button-start'
  | 'button-select'
  | 'power-switch'
  | 'volume-wheel'
  | 'contrast-wheel'
  | 'link-port'
  | 'phones-jack'
  | 'dc-jack'
  | 'speaker'
  | 'battery-cover'
  | 'batteries'
  | 'cartridge-bay'
  | 'lcd-board'
  | 'cpu-board'
  | 'membrane'
  | 'screws';

interface Explodable {
  object: THREE.Object3D;
  rest: THREE.Vector3;
  offset: THREE.Vector3;
  /** Normalised start of this part's motion within the explode timeline. */
  start: number;
}

const PRESS_TRAVEL: Record<Exclude<ButtonId, 'up' | 'down' | 'left' | 'right'>, number> = {
  a: 1.5,
  b: 1.5,
  start: 0.9,
  select: 0.9,
};
const DPAD_TILT = 0.085;
const BUTTON_PART: Record<'a' | 'b' | 'start' | 'select', PartId> = {
  a: 'button-a',
  b: 'button-b',
  start: 'button-start',
  select: 'button-select',
};

/**
 * The procedural console. Owns all of its meshes, the per-part animation state (button travel,
 * switch, wheels, battery door, exploded view, transparency) and frees its geometry on dispose.
 */
export class GameBoyModel {
  /** Pivot for presentation motion (idle sway). */
  readonly root = new THREE.Group();
  /** The device itself in body coordinates (mm). */
  readonly device = new THREE.Group();
  readonly parts = new Map<PartId, THREE.Object3D>();
  readonly internals: Internals;
  /** Mesh that shows the LCD texture. */
  readonly screen: THREE.Mesh;
  /** Where the cartridge sits when inserted, in device space. */
  readonly cartridgeAnchor = new THREE.Object3D();

  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly explodables: Explodable[] = [];
  private readonly shadowCasters: THREE.Mesh[] = [];
  private readonly fadeMaterials: { material: THREE.Material; opacity: number }[] = [];

  private readonly dpadPivot = new THREE.Group();
  private readonly buttonGroups = new Map<'a' | 'b' | 'start' | 'select', THREE.Group>();
  private readonly buttonPress = new Map<'a' | 'b' | 'start' | 'select', AnimatedValue>();
  private readonly dpadTiltX = new AnimatedValue(0);
  private readonly dpadTiltY = new AnimatedValue(0);
  private readonly dpadSink = new AnimatedValue(0);
  private readonly dpadHeld = new Set<ButtonId>();
  private readonly powerKnob = new THREE.Group();
  private readonly powerPos = new AnimatedValue(0);
  private readonly volumeWheel: THREE.Mesh;
  private readonly contrastWheel: THREE.Mesh;
  private readonly volumeAngle = new AnimatedValue(0);
  private readonly contrastAngle = new AnimatedValue(0);
  private readonly batteryCover = new THREE.Group();
  private readonly coverOpen = new AnimatedValue(0);
  private readonly explode = new AnimatedValue(0);
  private readonly transparency = new AnimatedValue(0);
  private readonly ledLevel = new AnimatedValue(0);
  private readonly lcdBacking: THREE.Mesh;
  private explodeSlow = false;

  constructor(
    private readonly mats: Materials,
    private readonly anisotropy: number,
  ) {
    this.root.name = 'console-root';
    this.device.name = 'console';
    this.root.add(this.device);

    const front = this.group('front-shell', 'front-shell');
    const back = this.group('back-shell', 'back-shell');
    const lens = this.group('lens', 'lens');
    const buttons = this.group('buttons');
    const lcdModule = this.group('screen', 'screen');
    const controls = this.group('controls');
    const cover = this.batteryCover;
    cover.name = 'battery-cover';
    this.device.add(cover);
    this.tag(cover, 'battery-cover');
    this.parts.set('battery-cover', cover);
    const screws = this.group('screws', 'screws');

    this.buildFrontShell(front);
    this.buildLens(lens);
    this.buildButtons(buttons);
    const { screen, backing } = this.buildLcdModule(lcdModule);
    this.screen = screen;
    this.lcdBacking = backing;
    const wheels = this.buildControls(controls);
    this.volumeWheel = wheels.volume;
    this.contrastWheel = wheels.contrast;
    this.buildBackShell(back);
    this.buildBatteryCover(cover);
    this.buildScrews(screws);

    this.internals = buildInternals(mats, (g) => this.trackGeometry(g));
    this.device.add(this.internals.lcdBoard, this.internals.membrane, this.internals.cpuBoard, this.internals.speaker, this.internals.batteries);
    this.tag(this.internals.lcdBoard, 'lcd-board');
    this.tag(this.internals.membrane, 'membrane');
    this.tag(this.internals.cpuBoard, 'cpu-board');
    this.tag(this.internals.speaker, 'speaker');
    this.tag(this.internals.batteries, 'batteries');
    this.parts.set('lcd-board', this.internals.lcdBoard);
    this.parts.set('membrane', this.internals.membrane);
    this.parts.set('cpu-board', this.internals.cpuBoard);
    this.parts.set('speaker', this.internals.speaker);
    this.parts.set('batteries', this.internals.batteries);

    this.cartridgeAnchor.position.set(0, HALF_H + 3 - 65 / 2, BACK_Z + 0.6 + 4);
    this.device.add(this.cartridgeAnchor);

    // Exploded-view choreography: outer parts leave first. Offsets in mm (device space).
    this.addExplodable(cover, new THREE.Vector3(0, -6, -105), 0);
    this.addExplodable(screws, new THREE.Vector3(0, 0, -128), 0.04);
    this.addExplodable(this.internals.batteries, new THREE.Vector3(0, 0, -80), 0.12);
    this.addExplodable(back, new THREE.Vector3(0, 0, -46), 0.2);
    this.addExplodable(lens, new THREE.Vector3(0, 0, 112), 0.08);
    this.addExplodable(front, new THREE.Vector3(0, 0, 86), 0.18);
    this.addExplodable(buttons, new THREE.Vector3(0, 0, 62), 0.28);
    this.addExplodable(this.internals.membrane, new THREE.Vector3(0, 0, 44), 0.34);
    this.addExplodable(this.internals.speaker, new THREE.Vector3(0, 0, 30), 0.38);
    this.addExplodable(lcdModule, new THREE.Vector3(0, 0, 22), 0.4);
    this.addExplodable(this.internals.lcdBoard, new THREE.Vector3(0, 0, 18), 0.42);

    this.device.traverse((o) => {
      if (o instanceof THREE.Mesh && o.castShadow) this.shadowCasters.push(o);
    });
    this.updateInternalsVisibility();
  }

  // ---------------------------------------------------------------------------------------------
  // Public state setters (animated)

  setButton(button: ButtonId, down: boolean): void {
    if (button === 'up' || button === 'down' || button === 'left' || button === 'right') {
      if (down) this.dpadHeld.add(button);
      else this.dpadHeld.delete(button);
      const tx = (this.dpadHeld.has('down') ? DPAD_TILT : 0) - (this.dpadHeld.has('up') ? DPAD_TILT : 0);
      const ty = (this.dpadHeld.has('right') ? DPAD_TILT : 0) - (this.dpadHeld.has('left') ? DPAD_TILT : 0);
      this.dpadTiltX.animateTo(tx, 0.06, Ease.outCubic);
      this.dpadTiltY.animateTo(ty, 0.06, Ease.outCubic);
      this.dpadSink.animateTo(this.dpadHeld.size > 0 ? 0.5 : 0, 0.06, Ease.outCubic);
      return;
    }
    this.buttonPress.get(button)?.animateTo(down ? 1 : 0, down ? 0.045 : 0.09, Ease.outCubic);
  }

  setPower(on: boolean, immediate = false): void {
    if (immediate) {
      this.powerPos.snap(on ? 1 : 0);
      this.ledLevel.snap(on ? 1 : 0);
    } else {
      this.powerPos.animateTo(on ? 1 : 0, 0.16, Ease.inOutCubic);
      this.ledLevel.animateTo(on ? 1 : 0, on ? 0.25 : 0.4, Ease.outCubic);
    }
  }

  setVolume(value: number): void {
    this.volumeAngle.animateTo(value * Math.PI * 1.6, 0.12, Ease.outCubic);
  }

  setContrast(value: number): void {
    this.contrastAngle.animateTo(-value * Math.PI * 1.6, 0.12, Ease.outCubic);
  }

  setBatteryCover(open: boolean): void {
    this.coverOpen.animateTo(open ? 1 : 0, 0.9, Ease.inOutCubic);
  }

  setExploded(exploded: boolean, slowMotion: boolean): void {
    this.explodeSlow = slowMotion;
    this.explode.animateTo(exploded ? 1 : 0, slowMotion ? 6 : 1.8, Ease.linear);
  }

  get explodeProgress(): number {
    return this.explode.value;
  }

  get isExploding(): boolean {
    return this.explode.active;
  }

  setTransparent(on: boolean): void {
    this.transparency.animateTo(on ? 1 : 0, 0.5, Ease.inOutSine);
  }

  get transparencyLevel(): number {
    return this.transparency.value;
  }

  /** How much the LCD appears lit (it is reflective; this just keeps it readable in dim presets). */
  setScreenGlow(level: number): void {
    (this.screen.material as THREE.MeshBasicMaterial).color.setScalar(level);
  }

  /** LCD backing colour (follows the LCD palette so the border matches the pixels). */
  setLcdBackingColor(r: number, g: number, b: number): void {
    (this.lcdBacking.material as THREE.MeshStandardMaterial).color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }

  /** World-space centre of the LCD (for camera focus). */
  /** Where the LCD centre is once the console is assembled (ignores any exploded offset). */
  screenWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    this.device.updateWorldMatrix(true, false);
    return this.device.localToWorld(target.copy(this.screen.position));
  }

  update(dt: number): void {
    for (const [id, value] of this.buttonPress) {
      value.update(dt);
      const g = this.buttonGroups.get(id);
      if (g) g.position.z = (g.userData.restZ as number) - value.value * PRESS_TRAVEL[id];
    }
    this.dpadTiltX.update(dt);
    this.dpadTiltY.update(dt);
    this.dpadSink.update(dt);
    this.dpadPivot.rotation.x = this.dpadTiltX.value;
    this.dpadPivot.rotation.y = this.dpadTiltY.value;
    this.dpadPivot.position.z = (this.dpadPivot.userData.restZ as number) - this.dpadSink.value;

    this.powerPos.update(dt);
    this.powerKnob.position.x = POWER_SWITCH.offX + (POWER_SWITCH.onX - POWER_SWITCH.offX) * this.powerPos.value;
    this.ledLevel.update(dt);
    this.mats.led.emissiveIntensity = this.ledLevel.value * 3.2;

    this.volumeAngle.update(dt);
    this.contrastAngle.update(dt);
    this.volumeWheel.rotation.z = this.volumeAngle.value;
    this.contrastWheel.rotation.z = this.contrastAngle.value;

    this.coverOpen.update(dt);
    const p = this.coverOpen.value;
    const slide = Ease.inOutCubic(progressBetween(p, 0, 0.4));
    const lift = Ease.inOutCubic(progressBetween(p, 0.35, 1));
    const rest = this.batteryCover.userData.rest as THREE.Vector3;
    this.batteryCover.position.set(rest.x, rest.y - slide * 7 - lift * 26, rest.z - lift * 30);
    this.batteryCover.rotation.x = -lift * 0.55;

    // Apply on every frame the animation was running, including the frame it reaches its target.
    const wasExploding = this.explode.active;
    this.explode.update(dt);
    if (wasExploding || this.explode.value > 0) this.applyExplode();
    const wasFading = this.transparency.active;
    this.transparency.update(dt);
    if (wasFading) this.applyTransparency();
    this.updateInternalsVisibility();
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.clear();
    this.root.removeFromParent();
  }

  // ---------------------------------------------------------------------------------------------
  // Construction

  private buildFrontShell(front: THREE.Group): void {
    const m = this.mats;
    const bevel = BODY.bevel;
    const shape = shapeFromPoints(bodyOutline(bevel));
    // Openings (sized at the front face; the bevel narrows them by `bevel` inside).
    shape.holes.push(
      roundedRectHole(LENS.cx, LENS.cy, LENS.width + 1 + bevel * 2, LENS.height + 1 + bevel * 2, corners(LENS.radius + bevel, { br: LENS.bottomRightRadius + bevel })),
      crossHole(DPAD.x, DPAD.y, DPAD.span + 1.2 + bevel * 2, DPAD.arm + 1.2 + bevel * 2, 1.2),
      circleHole(BUTTON_A.x, BUTTON_A.y, BUTTON_A.radius + 0.6 + bevel),
      circleHole(BUTTON_B.x, BUTTON_B.y, BUTTON_B.radius + 0.6 + bevel),
      capsuleHole(SELECT.x, SELECT.y, PILL.length + 1.2 + bevel * 2, PILL.width + 1.2 + bevel * 2, PILL.angle),
      capsuleHole(START.x, START.y, PILL.length + 1.2 + bevel * 2, PILL.width + 1.2 + bevel * 2, PILL.angle),
    );
    const plate = this.mesh(extrude(shape, BODY.plate, bevel, 4, 16), m.shell, 'front-plate');
    plate.position.z = FRONT_Z - BODY.plate - bevel;
    front.add(plate);

    // Side wall ring.
    const ringShape = shapeFromPoints(bodyOutline(0));
    ringShape.holes.push(holeFromPoints(bodyOutline(BODY.wall)));
    const ringDepth = FRONT_Z - BODY.plate - bevel + BODY.plate * 0.5 - BODY.seam;
    const ring = this.mesh(extrude(ringShape, ringDepth, 0, 1, 16), m.shell, 'front-ring');
    ring.position.z = BODY.seam;
    front.add(ring);

    // Seam groove: a dark band just inside the moulding gap.
    const seamShape = shapeFromPoints(bodyOutline(0.5));
    seamShape.holes.push(holeFromPoints(bodyOutline(BODY.wall + 0.5)));
    const seam = this.mesh(extrude(seamShape, BODY.seam * 2 + 0.2, 0, 1, 16), m.recess, 'seam', false);
    seam.position.z = -BODY.seam - 0.1;
    front.add(seam);

    // Speaker grille: slots are drawn as dark inlays (a bevelled hole this narrow would close up).
    const slotShapes = [];
    for (let i = 0; i < SPEAKER.slots; i++) {
      const off = (i - (SPEAKER.slots - 1) / 2) * SPEAKER.spacing;
      const px = SPEAKER.x + Math.cos(SPEAKER.angle + Math.PI / 2) * off;
      const py = SPEAKER.y + Math.sin(SPEAKER.angle + Math.PI / 2) * off;
      slotShapes.push(capsuleShape(px, py, SPEAKER.slotLength, SPEAKER.slotWidth, SPEAKER.angle));
    }
    const slotMat = this.ownMat(new THREE.MeshStandardMaterial({ color: 0x2c2c31, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.fadeMaterials.push({ material: slotMat, opacity: 1 });
    const slots = this.mesh(this.geo(new THREE.ShapeGeometry(slotShapes, 8)), slotMat, 'speaker-slots', false);
    slots.position.z = FRONT_Z + 0.015;
    slots.userData.part = 'speaker';
    front.add(slots);

    // Dark wells behind the button openings and the speaker grille.
    const wellZ = FRONT_Z - BODY.plate - bevel * 2 - 0.6;
    const wellShapes = [
      crossShape(DPAD.x, DPAD.y, DPAD.span + 3, DPAD.arm + 3, 1.2),
      roundedRectShape(BUTTON_A.x, BUTTON_A.y, 13, 13, corners(6.5)),
      roundedRectShape(BUTTON_B.x, BUTTON_B.y, 13, 13, corners(6.5)),
      capsuleShape(SELECT.x, SELECT.y, PILL.length + 4, PILL.width + 4, PILL.angle),
      capsuleShape(START.x, START.y, PILL.length + 4, PILL.width + 4, PILL.angle),
    ];
    const wells = this.mesh(extrude(wellShapes, 0.4), m.recess, 'wells', false);
    wells.position.z = wellZ;
    front.add(wells);

    // Printed graphics.
    const printTex = this.own(makeFrontPrintTexture(this.anisotropy));
    const printMat = this.ownMat(
      new THREE.MeshStandardMaterial({ map: printTex, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    this.fadeMaterials.push({ material: printMat, opacity: 1 });
    const prints = this.mesh(this.geo(new THREE.PlaneGeometry(BODY.width, BODY.height)), printMat, 'front-prints', false);
    prints.position.z = FRONT_Z + 0.02;
    prints.raycast = () => undefined;
    front.add(prints);

    // Side labels.
    this.sideLabel(front, 'CONTRAST', new THREE.Vector3(-HALF_W - 0.03, CONTRAST_WHEEL.y - 12, CONTRAST_WHEEL.z), 'left');
    this.sideLabel(front, 'EXT. LINK', new THREE.Vector3(-HALF_W - 0.03, LINK_PORT.y - 8.5, LINK_PORT.z), 'left');
    this.sideLabel(front, 'DC IN 6V', new THREE.Vector3(-HALF_W - 0.03, DC_JACK.y + 5, DC_JACK.z), 'left');
    this.sideLabel(front, '◄ VOL ►', new THREE.Vector3(HALF_W + 0.03, VOLUME_WHEEL.y + 11.5, VOLUME_WHEEL.z), 'right');
    this.sideLabel(front, 'PHONES', new THREE.Vector3(PHONES_JACK.x - 9, -HALF_H - 0.03, PHONES_JACK.z), 'bottom');
  }

  private buildLens(lens: THREE.Group): void {
    const m = this.mats;
    lens.position.set(LENS.cx, LENS.cy, 0);
    const outer = roundedRectShape(0, 0, LENS.width, LENS.height, corners(LENS.radius, { br: LENS.bottomRightRadius }));
    outer.holes.push(roundedRectHole(LCD_WINDOW.cx - LENS.cx, LCD_WINDOW.cy - LENS.cy, LCD_WINDOW.width, LCD_WINDOW.height, corners(0.6)));
    const lensTex = this.own(makeLensTexture(this.anisotropy));
    lensTex.repeat.set(1 / LENS.width, 1 / LENS.height);
    lensTex.offset.set(0.5, 0.5);
    const lensMat = this.ownMat(m.lens.clone());
    lensMat.map = lensTex;
    this.fadeMaterials.push({ material: lensMat, opacity: 1 });
    const thickness = 1.1;
    const lensMesh = this.mesh(extrude(outer, thickness, 0.35, 2, 16), [lensMat, m.lensEdge], 'lens-plate');
    lensMesh.position.z = FRONT_Z - 0.55 - thickness - 0.35;
    lens.add(lensMesh);

    // Reflective glass over the LCD window (additive: only adds reflections).
    const glass = this.mesh(
      this.geo(new THREE.PlaneGeometry(LCD_WINDOW.width, LCD_WINDOW.height)),
      m.glass,
      'lens-glass',
      false,
    );
    glass.position.set(LCD_WINDOW.cx - LENS.cx, LCD_WINDOW.cy - LENS.cy, FRONT_Z - 0.5);
    glass.renderOrder = 2;
    glass.userData.part = 'screen';
    lens.add(glass);

    // Power LED: a small domed lens.
    const led = this.mesh(this.geo(new THREE.SphereGeometry(1.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), m.led, 'led');
    led.rotation.x = Math.PI / 2;
    led.position.set(LED.x - LENS.cx, LED.y - LENS.cy, FRONT_Z - 0.5);
    led.scale.set(1, 0.45, 1);
    this.tag(led, 'led');
    this.parts.set('led', led);
    lens.add(led);
  }

  private buildLcdModule(group: THREE.Group): { screen: THREE.Mesh; backing: THREE.Mesh } {
    const m = this.mats;
    const z = FRONT_Z - 0.55 - 1.1 - 0.7 - 1.4;
    const backingMat = this.ownMat(m.lcdBacking.clone());
    const backing = this.mesh(this.geo(new THREE.PlaneGeometry(LCD_WINDOW.width + 4, LCD_WINDOW.height + 4)), backingMat, 'lcd-backing', false);
    backing.position.set(LCD_WINDOW.cx, LCD_WINDOW.cy, z - 0.05);
    group.add(backing);
    // Screen material gets its map from ScreenTexture (see main).
    // Unlit so the four LCD shades read exactly as designed under any lighting preset; the glass
    // layer above adds the reflections and setScreenGlow() scales brightness with the ambience.
    const screenMat = this.ownMat(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const screen = this.mesh(this.geo(new THREE.PlaneGeometry(LCD_ACTIVE.width, LCD_ACTIVE.height)), screenMat, 'lcd-screen', false);
    screen.position.set(LCD_WINDOW.cx, LCD_WINDOW.cy, z);
    screen.receiveShadow = true;
    group.add(screen);
    // Module frame behind.
    const frame = this.mesh(this.geo(new THREE.BoxGeometry(LCD_WINDOW.width + 8, LCD_WINDOW.height + 8, 2.2)), m.steel, 'lcd-frame', false);
    frame.position.set(LCD_WINDOW.cx, LCD_WINDOW.cy, z - 1.25);
    group.add(frame);
    return { screen, backing };
  }

  private buildButtons(buttons: THREE.Group): void {
    const m = this.mats;
    // D-pad.
    const pad = this.mesh(extrude(crossShape(0, 0, DPAD.span, DPAD.arm, 1.1), 4.2, 0.7, 3, 8), m.darkPlastic, 'dpad-cross');
    this.dpadPivot.add(pad);
    const dimpleMat = this.ownMat(new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.3 }));
    const dimple = this.mesh(this.geo(new THREE.CircleGeometry(2.6, 32)), dimpleMat, 'dpad-dimple', false);
    dimple.position.z = 4.92;
    this.dpadPivot.add(dimple);
    const arrowMat = this.ownMat(new THREE.MeshStandardMaterial({ color: 0x3b3b42, roughness: 0.45 }));
    const tri = new THREE.Shape();
    tri.moveTo(0, 1.3);
    tri.lineTo(-1.3, -0.6);
    tri.lineTo(1.3, -0.6);
    tri.closePath();
    const triGeo = extrude(tri, 0.22);
    this.trackGeometry(triGeo);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const arrow = new THREE.Mesh(triGeo, arrowMat);
      arrow.position.set(Math.sin(a) * -8.6, Math.cos(a) * 8.6, 4.9);
      arrow.rotation.z = -a;
      this.dpadPivot.add(arrow);
    }
    const dpadRestZ = FRONT_Z + 2.4 - 4.9;
    this.dpadPivot.position.set(DPAD.x, DPAD.y, dpadRestZ);
    this.dpadPivot.userData.restZ = dpadRestZ;
    this.tag(this.dpadPivot, 'dpad');
    this.parts.set('dpad', this.dpadPivot);
    buttons.add(this.dpadPivot);

    // A / B: lathe profile from the rim to the domed centre (v = 1 at the centre for wear mapping).
    const r = BUTTON_A.radius;
    const profile = [
      new THREE.Vector2(r, 0),
      new THREE.Vector2(r, 3.0),
      new THREE.Vector2(r - 0.18, 3.5),
      new THREE.Vector2(r - 0.6, 3.85),
      new THREE.Vector2(r - 1.4, 4.08),
      new THREE.Vector2(r - 2.6, 4.22),
      new THREE.Vector2(0.001, 4.3),
    ];
    const abGeo = this.geo(new THREE.LatheGeometry(profile, 56));
    abGeo.rotateX(Math.PI / 2);
    for (const [id, pos] of [
      ['a', BUTTON_A],
      ['b', BUTTON_B],
    ] as const) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(abGeo, m.burgundy);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      const restZ = FRONT_Z + 2.7 - 4.3;
      g.position.set(pos.x, pos.y, restZ);
      g.userData.restZ = restZ;
      this.registerButton(id, g, buttons);
    }

    // Select / Start rubber pills.
    const pillGeo = extrude(capsuleShape(0, 0, PILL.length, PILL.width, 0), 1.6, 0.85, 4, 10);
    this.trackGeometry(pillGeo);
    for (const [id, pos] of [
      ['select', SELECT],
      ['start', START],
    ] as const) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(pillGeo, m.rubber);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      g.rotation.z = PILL.angle;
      const restZ = FRONT_Z + 1.7 - 2.45;
      g.position.set(pos.x, pos.y, restZ);
      g.userData.restZ = restZ;
      this.registerButton(id, g, buttons);
    }
  }

  private registerButton(id: 'a' | 'b' | 'start' | 'select', g: THREE.Group, parent: THREE.Group): void {
    g.name = `button-${id}`;
    this.buttonGroups.set(id, g);
    this.buttonPress.set(id, new AnimatedValue(0));
    this.tag(g, BUTTON_PART[id]);
    this.parts.set(BUTTON_PART[id], g);
    parent.add(g);
  }

  private buildControls(controls: THREE.Group): { volume: THREE.Mesh; contrast: THREE.Mesh } {
    const m = this.mats;
    // Power switch: dark track on the top face + ridged slider.
    const track = this.mesh(this.geo(new THREE.BoxGeometry(POWER_SWITCH.trackMaxX - POWER_SWITCH.trackMinX, 1, 4.2)), m.recess, 'power-track', false);
    track.position.set((POWER_SWITCH.trackMinX + POWER_SWITCH.trackMaxX) / 2, HALF_H - 0.48, POWER_SWITCH.z);
    controls.add(track);
    const knobMat = this.ownMat(new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.55 }));
    const knob = this.mesh(this.geo(new THREE.BoxGeometry(5.6, 2.4, 3.4)), knobMat, 'power-knob');
    knob.position.y = 0.7;
    this.powerKnob.add(knob);
    const ridgeGeo = this.geo(new THREE.BoxGeometry(0.55, 0.7, 3.4));
    for (let i = -2; i <= 2; i++) {
      const ridge = new THREE.Mesh(ridgeGeo, knobMat);
      ridge.position.set(i * 1.05, 2.1, 0);
      this.powerKnob.add(ridge);
    }
    this.powerKnob.position.set(POWER_SWITCH.offX, HALF_H, POWER_SWITCH.z);
    this.tag(this.powerKnob, 'power-switch');
    this.parts.set('power-switch', this.powerKnob);
    controls.add(this.powerKnob);

    // Thumb wheels (protrude ~1.8 mm through slots in the side walls).
    const wheelMat = this.ownMat(new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.6 }));
    const wheelGeo = this.geo(knurledWheel(VOLUME_WHEEL.radius, VOLUME_WHEEL.thickness, 30));
    const slotGeo = this.geo(new THREE.BoxGeometry(0.4, VOLUME_WHEEL.radius * 1.5, VOLUME_WHEEL.thickness + 1.4));
    const make = (side: -1 | 1, y: number, z: number, part: PartId): THREE.Mesh => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      wheel.name = part;
      wheel.position.set(side * (HALF_W - VOLUME_WHEEL.radius + 1.8), y, z);
      const slot = new THREE.Mesh(slotGeo, m.recess);
      slot.position.set(side * (HALF_W + 0.02), y, z);
      const group = new THREE.Group();
      group.add(wheel, slot);
      this.tag(group, part);
      this.parts.set(part, group);
      controls.add(group);
      return wheel;
    };
    const volume = make(1, VOLUME_WHEEL.y, VOLUME_WHEEL.z, 'volume-wheel');
    const contrast = make(-1, CONTRAST_WHEEL.y, CONTRAST_WHEEL.z, 'contrast-wheel');

    // Link port: frame + insert + contacts.
    const link = new THREE.Group();
    const frame = this.mesh(this.geo(new THREE.BoxGeometry(0.6, LINK_PORT.height, LINK_PORT.depth)), m.recess, 'link-frame', false);
    const insert = this.mesh(this.geo(new THREE.BoxGeometry(0.5, LINK_PORT.height - 3, LINK_PORT.depth - 2.6)), m.black, 'link-insert', false);
    insert.position.x = -0.2;
    link.add(frame, insert);
    const pinGeo = this.geo(new THREE.BoxGeometry(0.3, 0.5, 1.6));
    for (let i = 0; i < 6; i++) {
      const pin = new THREE.Mesh(pinGeo, m.gold);
      pin.position.set(-0.3, -3 + i * 1.2, 0);
      link.add(pin);
    }
    link.position.set(-HALF_W - 0.05, LINK_PORT.y, LINK_PORT.z);
    this.tag(link, 'link-port');
    this.parts.set('link-port', link);
    controls.add(link);

    // Jacks.
    const jack = (radius: number, axis: 'x' | 'y', pos: THREE.Vector3, part: PartId): void => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(radius, radius, 0.5, 24)), m.recess);
      const hole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 0.6, 20)), m.black);
      g.add(ring, hole);
      if (axis === 'x') g.rotation.z = Math.PI / 2;
      g.position.copy(pos);
      this.tag(g, part);
      this.parts.set(part, g);
      controls.add(g);
    };
    jack(DC_JACK.radius, 'x', new THREE.Vector3(-HALF_W - 0.05, DC_JACK.y, DC_JACK.z), 'dc-jack');
    jack(PHONES_JACK.radius, 'y', new THREE.Vector3(PHONES_JACK.x, -HALF_H - 0.05, PHONES_JACK.z), 'phones-jack');
    return { volume, contrast };
  }

  private buildBackShell(back: THREE.Group): void {
    const m = this.mats;
    const bevel = BODY.bevel;
    const notch = { halfWidth: BAY.halfWidth, bottom: BAY.bottom };
    const plateShape = shapeFromPoints(bodyOutline(bevel, { halfWidth: notch.halfWidth + bevel, bottom: notch.bottom - bevel }));
    const bb = BATTERY_BAY;
    plateShape.holes.push(roundedRectHole(bb.cx, bb.cy, bb.width + bevel * 2, bb.height + bevel * 2, corners(1.5 + bevel)));
    const plate = this.mesh(extrude(plateShape, BODY.plate, bevel, 4, 16), m.shell, 'back-plate');
    plate.position.z = BACK_Z + bevel;
    back.add(plate);

    const ringShape = shapeFromPoints(bodyOutline(0, notch));
    ringShape.holes.push(holeFromPoints(bodyOutline(BODY.wall, notch)));
    const ringDepth = -BODY.seam - (BACK_Z + bevel + BODY.plate * 0.5);
    const ring = this.mesh(extrude(ringShape, ringDepth, 0, 1, 16), m.shell, 'back-ring');
    ring.position.z = BACK_Z + bevel + BODY.plate * 0.5;
    back.add(ring);

    // Cartridge bay: floor, top lip and connector.
    const bayH = HALF_H - BAY.bottom;
    const floor = this.mesh(this.geo(new THREE.BoxGeometry(BAY.halfWidth * 2, bayH, 0.8)), m.shellInner, 'bay-floor');
    floor.position.set(0, BAY.bottom + bayH / 2, BAY.floorZ - 0.4);
    const lipDepth = -BAY.floorZ + BODY.seam;
    const lip = this.mesh(this.geo(new THREE.BoxGeometry(BAY.halfWidth * 2, 3.2, lipDepth)), m.shell, 'bay-lip');
    lip.position.set(0, HALF_H - 1.6, BAY.floorZ + lipDepth / 2 - 0.01);
    const connector = this.mesh(this.geo(new THREE.BoxGeometry(BAY.halfWidth * 2 - 1, 4, 7.4)), m.black, 'bay-connector');
    connector.position.set(0, BAY.bottom + 0.8, BAY.floorZ - 3.7 - 0.8);
    const bay = new THREE.Group();
    bay.add(floor, lip, connector);
    this.tag(bay, 'cartridge-bay');
    this.parts.set('cartridge-bay', bay);
    back.add(bay);

    // Battery compartment liner.
    const liner = new THREE.Group();
    const linerFloorZ = -1.8;
    const linerDepth = linerFloorZ - (BACK_Z + 1);
    const fl = this.mesh(this.geo(new THREE.BoxGeometry(bb.width, bb.height, 0.8)), m.shellInner, 'battery-floor', false);
    fl.position.set(bb.cx, bb.cy, linerFloorZ);
    liner.add(fl);
    const wallX = this.geo(new THREE.BoxGeometry(1.2, bb.height, linerDepth));
    const wallY = this.geo(new THREE.BoxGeometry(bb.width, 1.2, linerDepth));
    for (const s of [-1, 1]) {
      const wx = new THREE.Mesh(wallX, m.shellInner);
      wx.position.set(bb.cx + s * (bb.width / 2 - 0.6), bb.cy, linerFloorZ - linerDepth / 2);
      const wy = new THREE.Mesh(wallY, m.shellInner);
      wy.position.set(bb.cx, bb.cy + s * (bb.height / 2 - 0.6), linerFloorZ - linerDepth / 2);
      liner.add(wx, wy);
    }
    back.add(liner);

    // Model sticker between the bay and the battery door.
    const sw = 54;
    const sh = 11.5;
    const stickerTex = this.own(makeBackStickerTexture(this.anisotropy, sw, sh));
    const stickerMat = this.ownMat(new THREE.MeshStandardMaterial({ map: stickerTex, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.fadeMaterials.push({ material: stickerMat, opacity: 1 });
    const sticker = this.mesh(this.geo(new THREE.PlaneGeometry(sw, sh)), stickerMat, 'back-sticker', false);
    sticker.rotation.y = Math.PI;
    sticker.position.set(0, (BAY.bottom + bb.cy + bb.height / 2) / 2, BACK_Z - 0.02);
    back.add(sticker);
  }

  private buildBatteryCover(cover: THREE.Group): void {
    const m = this.mats;
    const bb = BATTERY_BAY;
    const g = new THREE.Group();
    const plate = this.mesh(extrude(roundedRectShape(0, 0, bb.width - 0.6, bb.height - 0.6, corners(1.5)), 1.2, 0.4, 2, 8), m.shell, 'cover-plate');
    plate.position.z = -0.4;
    g.add(plate);
    // Grip ridges near the bottom edge and a slide arrow.
    const ridgeGeo = this.geo(new THREE.BoxGeometry(24, 0.8, 0.7));
    for (let i = 0; i < 6; i++) {
      const ridge = new THREE.Mesh(ridgeGeo, m.shell);
      ridge.castShadow = true;
      ridge.position.set(0, -bb.height / 2 + 5 + i * 2.2, -0.75);
      g.add(ridge);
    }
    const arrow = new THREE.Shape();
    arrow.moveTo(0, -3.2);
    arrow.lineTo(-3, 0.4);
    arrow.lineTo(-1, 0.4);
    arrow.lineTo(-1, 3.2);
    arrow.lineTo(1, 3.2);
    arrow.lineTo(1, 0.4);
    arrow.lineTo(3, 0.4);
    arrow.closePath();
    const arrowMesh = this.mesh(extrude(arrow, 0.45), m.shell, 'cover-arrow');
    arrowMesh.rotation.y = Math.PI;
    arrowMesh.position.set(0, 6, -0.4);
    g.add(arrowMesh);
    // Ridges and arrow are on the -z side, which faces out of the back.
    cover.add(g);
    const rest = new THREE.Vector3(bb.cx, bb.cy, BACK_Z + 1.2);
    cover.position.copy(rest);
    cover.userData.rest = rest.clone();
  }

  private buildScrews(screws: THREE.Group): void {
    const m = this.mats;
    const head = this.geo(new THREE.CylinderGeometry(2.1, 2.1, 0.7, 24));
    head.rotateX(Math.PI / 2);
    const well = this.geo(new THREE.CylinderGeometry(2.8, 2.8, 0.3, 24));
    well.rotateX(Math.PI / 2);
    const slot = this.geo(new THREE.BoxGeometry(2.6, 0.5, 0.3));
    for (const [x, y] of [
      [-38, 64],
      [38, 64],
      [-38, 0],
      [38, 0],
      [-36, -66],
      [36, -42],
    ] as const) {
      const g = new THREE.Group();
      const w = new THREE.Mesh(well, m.recess);
      w.position.z = -0.1;
      const h = new THREE.Mesh(head, m.steel);
      h.position.z = -0.25;
      const s1 = new THREE.Mesh(slot, m.black);
      s1.position.z = -0.62;
      const s2 = s1.clone();
      s2.rotation.z = Math.PI / 2;
      g.add(w, h, s1, s2);
      g.position.set(x, y, BACK_Z);
      screws.add(g);
    }
  }

  private sideLabel(parent: THREE.Group, text: string, pos: THREE.Vector3, side: 'left' | 'right' | 'bottom'): void {
    const { tex, wmm, hmm } = makeSideLabelTexture(text, this.anisotropy);
    this.own(tex);
    const mat = this.ownMat(new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6 }));
    this.fadeMaterials.push({ material: mat, opacity: 1 });
    const mesh = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(wmm, hmm)), mat);
    // Text runs along the side (y for left/right, x for bottom) and faces outward.
    if (side === 'left') {
      mesh.rotation.set(0, -Math.PI / 2, -Math.PI / 2);
    } else if (side === 'right') {
      mesh.rotation.set(0, Math.PI / 2, Math.PI / 2);
    } else {
      mesh.rotation.set(Math.PI / 2, 0, 0);
    }
    mesh.position.copy(pos);
    mesh.raycast = () => undefined;
    parent.add(mesh);
  }

  // ---------------------------------------------------------------------------------------------
  // Animation helpers

  private addExplodable(object: THREE.Object3D, offset: THREE.Vector3, start: number): void {
    this.explodables.push({ object, rest: object.position.clone(), offset, start });
  }

  private applyExplode(): void {
    const p = this.explode.value;
    const span = this.explodeSlow ? 0.5 : 0.62;
    for (const e of this.explodables) {
      // Exploding: parts leave in order. Assembling (p falling): the same windows run backwards,
      // so the last part out is the first part back in.
      const t = Ease.inOutCubic(progressBetween(p, e.start, e.start + span));
      if (e.object === this.batteryCover) {
        // The battery door has its own open animation (set earlier this frame); add the offset on top.
        this.batteryCover.position.addScaledVector(e.offset, t);
      } else {
        e.object.position.copy(e.rest).addScaledVector(e.offset, t);
      }
    }
  }

  private applyTransparency(): void {
    const t = this.transparency.value;
    for (const mat of this.mats.shellGroup) setFade(mat, 1 - t * 0.84);
    for (const f of this.fadeMaterials) setFade(f.material, f.opacity * (1 - t * 0.9));
    for (const mesh of this.shadowCasters) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat && this.mats.shellGroup.includes(mat)) mesh.castShadow = t < 0.5;
    }
  }

  private updateInternalsVisibility(): void {
    const show = this.explode.value > 0.001 || this.transparency.value > 0.001;
    this.internals.lcdBoard.visible = show;
    this.internals.membrane.visible = show;
    this.internals.cpuBoard.visible = show;
  }

  // ---------------------------------------------------------------------------------------------
  // Bookkeeping

  private group(name: string, part?: PartId): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    this.device.add(g);
    if (part) {
      g.userData.part = part;
      this.parts.set(part, g);
    }
    return g;
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], name: string, shadows = true): THREE.Mesh {
    this.trackGeometry(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    return mesh;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.trackGeometry(g);
    return g;
  }

  private trackGeometry(g: THREE.BufferGeometry): void {
    this.geometries.add(g);
  }

  private own<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private ownMat<T extends THREE.Material>(mat: T): T {
    this.ownMaterials.push(mat);
    return mat;
  }

  /** Marks an object and all its descendants as belonging to an interactive part. */
  private tag(obj: THREE.Object3D, part: PartId): void {
    obj.traverse((o) => {
      o.userData.part = part;
    });
    obj.userData.part = part;
  }
}

function setFade(mat: THREE.Material, opacity: number): void {
  // Remember whether the material was transparent to begin with (decals stay transparent).
  if (mat.userData.baseTransparent === undefined) {
    mat.userData.baseTransparent = mat.transparent;
    mat.userData.baseDepthWrite = mat.depthWrite;
  }
  const base = mat.userData.baseTransparent as boolean;
  const want = base || opacity < 0.999;
  if (mat.transparent !== want) {
    mat.transparent = want;
    mat.depthWrite = base ? (mat.userData.baseDepthWrite as boolean) : !want;
    mat.needsUpdate = true;
  }
  mat.opacity = opacity;
}
