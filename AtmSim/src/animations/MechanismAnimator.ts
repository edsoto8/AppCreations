import * as THREE from 'three';
import type { CassetteId, ComponentId, DeviceStatus, MechanismDriver, Note, ValidationResult } from '../core/types';
import type { AtmModel } from '../models/types';
import type { Sfx } from '../audio/sfx';
import { Easing, type AnimClock } from './AnimClock';
import { NOTE_GAP, NOTE_H, NOTE_W, NotePool } from '../models/notes';
import { CARD_W } from '../models/card';
import { getAtmExtras, type AtmModelExtras } from '../models/buildAtm';
import { FONT } from '../models/materials';

type Curve = THREE.CatmullRomCurve3;

const X = new THREE.Vector3(1, 0, 0);
const BELT_SPEED = 1.7; // m/s along the vertical transport
const PRESENTER_SPEED = 0.7; // m/s

const ALERT_COLORS: Record<DeviceStatus, number> = { OK: 0x22dd66, WARNING: 0xffb020, FAULT: 0xff3344, OFFLINE: 0x8a96a8 };

interface RealTween {
  t: number;
  dur: number;
  fn: (p: number) => void;
  resolve: () => void;
}

interface Alert {
  id: ComponentId;
  level: DeviceStatus;
  group: THREE.Group;
  fillMat: THREE.MeshBasicMaterial;
  lineMat: THREE.LineBasicMaterial;
}

interface Receipt {
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  mat: THREE.MeshStandardMaterial;
  geo: THREE.BufferGeometry;
  fullLen: number;
}

/** World-space basis → quaternion for a sheet whose long edge runs along X and that travels along `tangent`. */
function sheetQuat(tangent: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const y = tangent.clone().addScaledVector(X, -tangent.dot(X)).normalize();
  if (y.lengthSq() < 1e-6) y.set(0, 1, 0);
  const z = new THREE.Vector3().crossVectors(X, y).normalize();
  const m = new THREE.Matrix4().makeBasis(X, y, z);
  return out.setFromRotationMatrix(m);
}

/** Quaternion of a note lying flat in the stacker / presenter (travel +Z, face normal -Y). */
const FLAT_FWD = sheetQuat(new THREE.Vector3(0, 0, 1));
/** Card flat, face up, chip end leading into the slot (-Z). */
const CARD_INSERT_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
/** Card upright, front facing the customer (+Z) — for contactless taps. */
const CARD_TAP_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12));

function wp(o: THREE.Object3D): THREE.Vector3 {
  return o.getWorldPosition(new THREE.Vector3());
}

/** Place an object at a world pose regardless of its parent. */
function setWorldPose(o: THREE.Object3D, pos: THREE.Vector3, quat?: THREE.Quaternion): void {
  const parent = o.parent;
  if (!parent) {
    o.position.copy(pos);
    if (quat) o.quaternion.copy(quat);
    return;
  }
  parent.updateWorldMatrix(true, false);
  const inv = parent.matrixWorld.clone().invert();
  o.position.copy(pos).applyMatrix4(inv);
  if (quat) {
    const pq = new THREE.Quaternion();
    parent.matrixWorld.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
    o.quaternion.copy(pq.invert().multiply(quat));
  }
}

function nearestU(curve: Curve, p: THREE.Vector3, samples = 240): number {
  let best = 0;
  let bd = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    curve.getPointAt(u, v);
    const d = v.distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

/**
 * Animates every MechanismDriver call on the sim clock: banknotes are individual meshes that travel
 * along the model's anchors (picker → transport → sensor → stacker → presenter → shutter, reject and
 * retract paths, deposit escrow), plus card, receipt, shutter, motors and component alerts.
 */
export class MechanismAnimator implements MechanismDriver {
  private readonly model: AtmModel;
  private readonly scene: THREE.Scene;
  private readonly clock: AnimClock;
  private readonly sfx: Sfx;
  private readonly extras: AtmModelExtras;
  private readonly layer = new THREE.Group();
  private readonly pool = new NotePool();
  private gen = 0;

  /** Notes in the transport / stacker, by note id. */
  private readonly notes = new Map<number, THREE.Mesh>();
  private stackerNotes: THREE.Mesh[] = [];
  private bundle: THREE.Group | null = null;
  private escrow: THREE.Group | null = null;
  private receipt: Receipt | null = null;
  private readonly alerts = new Map<ComponentId, Alert>();
  private readonly jamMarkers: THREE.Mesh[] = [];
  private readonly realTweens: RealTween[] = [];

  private vibration = false;
  private lastTransportUse = -1e9;
  private lastMotorSfx = -1e9;
  private time = 0;
  private sensorFlash = 0;
  private scanFlash = 0;

  // model handles
  private readonly shutter?: THREE.Object3D;
  private readonly shutterRestY: number;
  private readonly clamp?: THREE.Object3D;
  private readonly clampRestY: number;
  private readonly diverter?: THREE.Object3D;
  private readonly diverterRest: number;
  private readonly sensorMat?: THREE.MeshStandardMaterial;
  private readonly sensorBase = new THREE.Color();
  private readonly scanMat?: THREE.MeshStandardMaterial;
  private readonly scanBase = new THREE.Color();

  private cardState: 'rest' | 'moving' | 'inside' | 'ejected' | 'retained' = 'rest';
  private readonly alertBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly alertEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

  constructor(opts: { model: AtmModel; scene: THREE.Scene; clock: AnimClock; sfx: Sfx }) {
    this.model = opts.model;
    this.scene = opts.scene;
    this.clock = opts.clock;
    this.sfx = opts.sfx;
    const ex = getAtmExtras(opts.model);
    if (!ex) throw new Error('MechanismAnimator needs a model built by buildAtm()');
    this.extras = ex;
    this.layer.name = 'mechanism-transients';
    this.scene.add(this.layer);
    const root = this.model.root;
    this.shutter = root.getObjectByName('shutter');
    this.shutterRestY = this.shutter?.position.y ?? 0;
    this.clamp = root.getObjectByName('stackerClamp');
    this.clampRestY = this.clamp?.position.y ?? 0;
    this.diverter = root.getObjectByName('diverter');
    this.diverterRest = this.diverter?.rotation.x ?? 0;
    const sl = root.getObjectByName('sensorLight') as THREE.Mesh | undefined;
    this.sensorMat = sl?.material as THREE.MeshStandardMaterial | undefined;
    if (this.sensorMat) this.sensorBase.copy(this.sensorMat.emissive);
    const sc = root.getObjectByName('depositScan') as THREE.Mesh | undefined;
    this.scanMat = sc?.material as THREE.MeshStandardMaterial | undefined;
    if (this.scanMat) this.scanBase.copy(this.scanMat.emissive);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private get card(): THREE.Object3D {
    return this.model.props.card;
  }

  private alive(g: number): boolean {
    return g === this.gen;
  }

  private tween(ms: number, fn: (p: number) => void, ease = Easing.inOut): Promise<void> {
    return this.clock.tween(ms, fn, ease);
  }

  private realTween(ms: number, fn: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      fn(0);
      this.realTweens.push({ t: 0, dur: ms / 1000, fn, resolve });
    });
  }

  private useTransport(): void {
    this.lastTransportUse = this.clock.now();
    this.model.setMotor('transport', true);
  }

  /** Full path for a note picked from a cassette: lift off the stack → onto the belts → up to the stacker entry. */
  private pickCurve(c: CassetteId): Curve {
    const pick = wp(this.model.anchors.cassettePick[c]);
    const tp = this.model.anchors.transportPath.map(wp);
    const tz = tp[0].z;
    const c0 = pick.clone().add(new THREE.Vector3(0, -NOTE_H / 2, 0));
    const pts = [
      c0,
      c0.clone().add(new THREE.Vector3(0, 0.03, -0.001)),
      new THREE.Vector3(c0.x, c0.y + 0.052, (c0.z + tz) / 2 - 0.004),
      new THREE.Vector3(c0.x, c0.y + 0.078, tz),
    ];
    for (const p of tp) if (p.y > c0.y + 0.11 || p.z > tz + 0.002) pts.push(p.clone());
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }

  private transportCurve(): Curve {
    return new THREE.CatmullRomCurve3(this.model.anchors.transportPath.map(wp), false, 'centripetal');
  }

  private presenterCurve(): Curve {
    return new THREE.CatmullRomCurve3(this.model.anchors.presenterPath.map(wp), false, 'centripetal');
  }

  private placeOnCurve(m: THREE.Object3D, curve: Curve, u: number): void {
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    m.position.copy(p);
    sheetQuat(t, m.quaternion);
  }

  private async travel(m: THREE.Object3D, curve: Curve, u0: number, u1: number, speed: number, ease = Easing.linear, minMs = 60): Promise<void> {
    const dist = Math.abs(u1 - u0) * curve.getLength();
    const ms = Math.max(minMs, (dist / speed) * 1000);
    await this.tween(ms, (p) => this.placeOnCurve(m, curve, u0 + (u1 - u0) * p), ease);
  }

  private noteMesh(note: Note): THREE.Mesh {
    let m = this.notes.get(note.id);
    if (!m) {
      m = this.pool.acquire(note.denom);
      m.userData.noteId = note.id;
      this.layer.add(m);
      this.notes.set(note.id, m);
      // appear just below the sensor
      const tc = this.transportCurve();
      const us = nearestU(tc, wp(this.model.anchors.sensor));
      m.userData.curve = tc;
      m.userData.u = Math.max(0, us - 0.05 / tc.getLength());
      this.placeOnCurve(m, tc, m.userData.u as number);
    }
    return m;
  }

  private releaseNote(m: THREE.Mesh): void {
    const ghost = m.userData.ghost as THREE.Mesh | undefined;
    if (ghost) this.pool.release(ghost);
    for (const c of [...m.children]) {
      if ((c as THREE.Mesh).userData.jamMarker) {
        m.remove(c);
        const i = this.jamMarkers.indexOf(c as THREE.Mesh);
        if (i >= 0) this.jamMarkers.splice(i, 1);
        ((c as THREE.Mesh).material as THREE.Material).dispose();
      }
    }
    const id = m.userData.noteId as number | undefined;
    if (id !== undefined) this.notes.delete(id);
    this.pool.release(m);
  }

  private flashSensor(color: number): void {
    if (!this.sensorMat) return;
    this.sensorMat.emissive.set(color);
    this.sensorMat.emissiveIntensity = 4;
    this.sensorFlash = 0.35;
  }

  // ───────────────────────────── banknote path ─────────────────────────────

  async pickNote(note: Note, cassette: CassetteId): Promise<void> {
    const g = this.gen;
    const pickerGroup = `picker-${cassette}` as const;
    this.model.setMotor(pickerGroup, true);
    this.useTransport();
    if (this.clock.now() - this.lastMotorSfx > 1500) {
      this.lastMotorSfx = this.clock.now();
      this.sfx.play('motor', { volume: 0.35, durationMs: 1200 });
    }
    const prev = this.notes.get(note.id);
    if (prev) this.releaseNote(prev);
    const m = this.pool.acquire(note.denom);
    m.userData.noteId = note.id;
    this.notes.set(note.id, m);
    this.layer.add(m);
    const curve = this.pickCurve(cassette);
    m.userData.curve = curve;
    const len = curve.getLength();
    const uJoin = Math.min(1, 0.085 / len);
    const uSensor = nearestU(curve, wp(this.model.anchors.sensor));
    const uBefore = Math.max(uJoin, uSensor - 0.035 / len);
    this.placeOnCurve(m, curve, 0);
    // picker lifts the rearmost note and feeds it onto the belts
    await this.tween(200, (p) => this.placeOnCurve(m, curve, uJoin * p), Easing.inOut);
    if (!this.alive(g)) return;
    this.model.setMotor(pickerGroup, false);
    this.useTransport();
    await this.travel(m, curve, uJoin, uBefore, BELT_SPEED);
    if (!this.alive(g)) return;
    m.userData.u = uBefore;
    this.useTransport();
  }

  async validateNote(note: Note, result: ValidationResult): Promise<void> {
    const g = this.gen;
    const m = this.noteMesh(note);
    const curve = m.userData.curve as Curve;
    const len = curve.getLength();
    const u0 = (m.userData.u as number) ?? 0;
    const uS = nearestU(curve, wp(this.model.anchors.sensor));
    const u1 = Math.min(1, uS + 0.035 / len);
    this.useTransport();
    if (result === 'DOUBLE' && !m.userData.ghost) {
      const ghost = this.pool.acquire(note.denom);
      ghost.position.set(0.004, 0.012, -0.0012);
      ghost.rotation.z = 0.03;
      m.add(ghost);
      m.userData.ghost = ghost;
    }
    let flashed = false;
    await this.tween(
      190,
      (p) => {
        const u = u0 + (u1 - u0) * p;
        this.placeOnCurve(m, curve, u);
        if (result === 'SKEW') m.rotateZ(Math.min(1, p * 2) * 0.16);
        if (!flashed && u >= uS) {
          flashed = true;
          this.flashSensor(result === 'OK' ? 0x22ff88 : 0xff2a2a);
          if (result === 'OK') this.sfx.play('count', { volume: 0.6 });
          else this.sfx.play('error', { volume: 0.4 });
        }
      },
      Easing.linear,
    );
    if (!this.alive(g)) return;
    if (!flashed) this.flashSensor(result === 'OK' ? 0x22ff88 : 0xff2a2a);
    m.userData.u = u1;
    m.userData.skew = result === 'SKEW';
    this.useTransport();
  }

  async divertToReject(note: Note): Promise<void> {
    const g = this.gen;
    const m = this.noteMesh(note);
    this.useTransport();
    // diverter gate flips towards the reject channel
    const d = this.diverter;
    const from = this.diverterRest;
    if (d) await this.tween(110, (p) => (d.rotation.x = from + (-0.55 - from) * p), Easing.out);
    if (!this.alive(g)) return;
    const curve = m.userData.curve as Curve;
    const start = m.position.clone();
    const div = d ? wp(d) : curve.getPointAt(Math.min(1, ((m.userData.u as number) ?? 0) + 0.05));
    const rej = this.extras.rejectPath.map(wp);
    const entry = wp(this.model.anchors.rejectEntry);
    const pts = [start, new THREE.Vector3(start.x, div.y + 0.012, start.z - 0.004), ...rej, entry, entry.clone().add(new THREE.Vector3(0, -0.035, 0.01))];
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    await this.travel(m, path, 0, 1, BELT_SPEED * 1.1);
    if (!this.alive(g)) return;
    this.releaseNote(m);
    if (d) void this.tween(140, (p) => (d.rotation.x = -0.55 + (from + 0.55) * p), Easing.out);
    this.useTransport();
  }

  async stackNote(note: Note): Promise<void> {
    const g = this.gen;
    const m = this.noteMesh(note);
    const curve = m.userData.curve as Curve;
    const u0 = (m.userData.u as number) ?? 0;
    this.useTransport();
    this.model.setMotor('stacker', true);
    await this.travel(m, curve, u0, 1, BELT_SPEED);
    if (!this.alive(g)) return;
    // stacker wheel lays the note onto the staged bundle
    const startP = m.position.clone();
    const startQ = m.quaternion.clone();
    const base = wp(this.model.anchors.stacker);
    const n = this.stackerNotes.length;
    const endP = base.clone().add(new THREE.Vector3((n % 2 ? 1 : -1) * 0.0008, 0.0008 + n * NOTE_GAP, 0));
    const ctrl = new THREE.Vector3(startP.x, startP.y + 0.01, (startP.z + endP.z) / 2 + 0.03);
    const q = new THREE.Quaternion();
    await this.tween(
      170,
      (p) => {
        const a = 1 - p;
        m.position.set(a * a * startP.x + 2 * a * p * ctrl.x + p * p * endP.x, a * a * startP.y + 2 * a * p * ctrl.y + p * p * endP.y, a * a * startP.z + 2 * a * p * ctrl.z + p * p * endP.z);
        m.quaternion.copy(q.slerpQuaternions(startQ, FLAT_FWD, p));
      },
      Easing.out,
    );
    if (!this.alive(g)) return;
    m.position.copy(endP);
    m.quaternion.copy(FLAT_FWD);
    m.userData.inStacker = true;
    this.stackerNotes.push(m);
    this.model.setMotor('stacker', false);
    this.useTransport();
  }

  async jamNote(note: Note): Promise<void> {
    const g = this.gen;
    const m = this.noteMesh(note);
    const curve = m.userData.curve as Curve;
    const u0 = (m.userData.u as number) ?? 0;
    const u1 = Math.min(1, u0 + 0.05 / curve.getLength());
    this.useTransport();
    await this.tween(
      260,
      (p) => {
        this.placeOnCurve(m, curve, u0 + (u1 - u0) * Easing.out(p));
        m.rotateZ(0.32 * p);
        m.position.x += 0.018 * p;
      },
      Easing.linear,
    );
    if (!this.alive(g)) return;
    m.userData.u = u1;
    m.userData.jammed = true;
    this.model.setMotor('transport', false);
    this.lastTransportUse = -1e9;
    this.vibration = false;
    this.sfx.play('error');
    this.flashSensor(0xff2a2a);
    // red halo on the stuck note
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const marker = new THREE.Mesh(new THREE.PlaneGeometry(NOTE_W * 1.25, NOTE_H * 1.5), mat);
    marker.userData.jamMarker = true;
    marker.renderOrder = 20;
    m.add(marker);
    this.jamMarkers.push(marker);
  }

  async presentBundle(notes: Note[]): Promise<void> {
    const g = this.gen;
    // the card is always handed back before cash: if the UI never called takeCard(), tidy it away now
    if (this.cardState === 'ejected') this.takeCard();
    // make sure every note has a mesh in the stacker
    for (const n of notes) {
      if (!this.notes.get(n.id)?.userData.inStacker) {
        const old = this.notes.get(n.id);
        if (old) this.releaseNote(old);
        const m = this.pool.acquire(n.denom);
        m.userData.noteId = n.id;
        m.userData.inStacker = true;
        this.notes.set(n.id, m);
        this.layer.add(m);
        const base = wp(this.model.anchors.stacker);
        m.position.copy(base).add(new THREE.Vector3(0, 0.0008 + this.stackerNotes.length * NOTE_GAP, 0));
        m.quaternion.copy(FLAT_FWD);
        this.stackerNotes.push(m);
      }
    }
    const bundle = new THREE.Group();
    bundle.name = 'presented-bundle';
    this.layer.add(bundle);
    const curve = this.presenterCurve();
    this.placeOnCurve(bundle, curve, 0);
    bundle.updateMatrixWorld(true);
    for (const m of this.stackerNotes) bundle.attach(m);
    this.stackerNotes = [];
    this.bundle = bundle;
    // clamp + transport off; presenter belts start
    this.model.setMotor('transport', false);
    this.lastTransportUse = -1e9;
    const clamp = this.clamp;
    if (clamp) await this.tween(160, (p) => (clamp.position.y = this.clampRestY - 0.026 * p), Easing.out);
    if (!this.alive(g)) return;
    this.sfx.play('motor', { volume: 0.5, durationMs: 1200 });
    this.model.setMotor('presenter', true);
    if (clamp) void this.tween(200, (p) => (clamp.position.y = this.clampRestY - 0.026 * (1 - p)));
    const len = curve.getLength();
    const travelMs = (len / PRESENTER_SPEED) * 1000;
    const shutterAt = Math.max(0, travelMs - 600);
    await Promise.all([
      this.travel(bundle, curve, 0, 1, PRESENTER_SPEED, Easing.inOut),
      this.clock.wait(shutterAt).then(() => (this.alive(g) ? this.moveShutter(true) : undefined)),
    ]);
    if (!this.alive(g)) return;
    // push the bundle out through the slot
    const outP = wp(this.model.anchors.shutterOutside);
    const fromP = bundle.position.clone();
    const fromQ = bundle.quaternion.clone();
    const q = new THREE.Quaternion();
    await this.tween(
      320,
      (p) => {
        bundle.position.lerpVectors(fromP, outP, p);
        bundle.quaternion.copy(q.slerpQuaternions(fromQ, FLAT_FWD, p));
      },
      Easing.out,
    );
    if (!this.alive(g)) return;
    this.model.setMotor('presenter', false);
    bundle.userData.prop = 'cash';
    bundle.traverse((o) => (o.userData.prop = 'cash'));
    this.model.leds.cash.set('blink', 0x35e0c8);
  }

  private async moveShutter(open: boolean): Promise<void> {
    const s = this.shutter;
    this.sfx.play('shutter');
    if (!s) return;
    const from = s.position.y;
    const to = open ? this.shutterRestY - 0.047 : this.shutterRestY;
    await this.tween(600, (p) => (s.position.y = from + (to - from) * p), Easing.inOut);
  }

  private takeBundle(): THREE.Group | null {
    const b = this.bundle;
    this.bundle = null;
    if (b) b.userData.prop = undefined;
    b?.traverse((o) => (o.userData.prop = undefined));
    return b;
  }

  private releaseBundle(b: THREE.Group): void {
    for (const c of [...b.children]) this.releaseNote(c as THREE.Mesh);
    b.removeFromParent();
  }

  async bundleCollected(_notes: Note[]): Promise<void> {
    const g = this.gen;
    this.model.leds.cash.set('off');
    const b = this.takeBundle();
    if (b) {
      const from = b.position.clone();
      await this.tween(
        380,
        (p) => {
          b.position.set(from.x, from.y + 0.03 * p, from.z + 0.22 * p);
          b.scale.setScalar(1 - 0.3 * p);
        },
        Easing.in,
      );
      if (!this.alive(g)) return;
      this.releaseBundle(b);
    }
    await this.moveShutter(false);
  }

  async retractBundle(_notes: Note[]): Promise<void> {
    const g = this.gen;
    this.model.leds.cash.set('off');
    const b = this.takeBundle();
    if (!b) {
      await this.moveShutter(false);
      return;
    }
    this.model.setMotor('presenter', true);
    this.sfx.play('motor', { volume: 0.5, durationMs: 1200 });
    const curve = this.presenterCurve();
    const end = curve.getPointAt(1);
    const fromP = b.position.clone();
    await this.tween(300, (p) => b.position.lerpVectors(fromP, end, p), Easing.inOut);
    if (!this.alive(g)) return;
    const entry = wp(this.model.anchors.retractEntry);
    const uR = nearestU(curve, new THREE.Vector3(entry.x, curve.getPointAt(0).y, entry.z));
    await Promise.all([this.travel(b, curve, 1, uR, PRESENTER_SPEED, Easing.inOut), this.moveShutter(false)]);
    if (!this.alive(g)) return;
    // gate opens: the bundle drops into the retract bin
    const p0 = b.position.clone();
    const p1 = entry.clone().add(new THREE.Vector3(0, -0.04, 0));
    await this.tween(300, (p) => b.position.lerpVectors(p0, p1, p), Easing.in);
    if (!this.alive(g)) return;
    this.model.setMotor('presenter', false);
    this.releaseBundle(b);
  }

  async purge(notes: Note[], to: 'reject' | 'retract'): Promise<void> {
    const g = this.gen;
    this.useTransport();
    if (to === 'retract') this.model.setMotor('presenter', true);
    this.sfx.play('motor', { volume: 0.5, durationMs: 900 });
    const bundleNotes = new Set(this.bundle ? this.bundle.children : []);
    if (this.bundle && notes.some((n) => bundleNotes.has(this.notes.get(n.id)!))) {
      // a presented bundle being purged: pull it back first
      const b = this.takeBundle()!;
      this.layer.attach(b);
      for (const c of [...b.children]) this.layer.attach(c);
      b.removeFromParent();
      void this.moveShutter(false);
    }
    const moves = notes.map(async (n, i) => {
      await this.clock.wait(i * 140);
      if (!this.alive(g)) return;
      let m = this.notes.get(n.id);
      if (!m) {
        m = this.pool.acquire(n.denom);
        m.userData.noteId = n.id;
        this.notes.set(n.id, m);
        this.layer.add(m);
        m.position.copy(wp(this.model.anchors.stacker)).add(new THREE.Vector3(0, 0.002 + i * NOTE_GAP, 0));
        m.quaternion.copy(FLAT_FWD);
      }
      if (m.parent !== this.layer) this.layer.attach(m);
      const idx = this.stackerNotes.indexOf(m);
      if (idx >= 0) this.stackerNotes.splice(idx, 1);
      for (const c of [...m.children]) {
        if (c.userData.jamMarker) {
          m.remove(c);
          ((c as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
      const start = m.position.clone();
      let pts: THREE.Vector3[];
      if (to === 'reject') {
        const div = this.diverter ? wp(this.diverter) : wp(this.model.anchors.sensor);
        const entry = wp(this.model.anchors.rejectEntry);
        pts = [start, new THREE.Vector3(start.x, div.y + 0.02, div.z), ...this.extras.rejectPath.map(wp), entry, entry.clone().add(new THREE.Vector3(0, -0.035, 0.01))];
      } else {
        const pc = this.presenterCurve();
        const entry = wp(this.model.anchors.retractEntry);
        const uR = nearestU(pc, new THREE.Vector3(entry.x, pc.getPointAt(0).y, entry.z));
        pts = [start, pc.getPointAt(0).add(new THREE.Vector3(0, 0.006, 0)), pc.getPointAt(uR * 0.5), pc.getPointAt(uR), entry, entry.clone().add(new THREE.Vector3(0, -0.04, 0))];
      }
      // de-duplicate coincident points (CatmullRom dislikes zero-length segments)
      const clean = pts.filter((p, k) => k === 0 || p.distanceTo(pts[k - 1]) > 0.004);
      const path = new THREE.CatmullRomCurve3(clean, false, 'centripetal');
      await this.travel(m, path, 0, 1, BELT_SPEED);
      if (!this.alive(g)) return;
      this.releaseNote(m);
    });
    const d = this.diverter;
    if (to === 'reject' && d) d.rotation.x = -0.55;
    await Promise.all(moves);
    if (!this.alive(g)) return;
    if (d) d.rotation.x = this.diverterRest;
    if (to === 'retract') this.model.setMotor('presenter', false);
    this.model.setMotor('transport', false);
    this.lastTransportUse = -1e9;
  }

  // ───────────────────────────── receipt ─────────────────────────────

  async printReceipt(lines: string[]): Promise<void> {
    const g = this.gen;
    this.removeReceipt();
    const W = 384;
    const lineH = 26;
    const H = 96 + lines.length * lineH + 70;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#fbfaf5';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#111';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `800 26px ${FONT}`;
    c.fillText('MERIDIAN TRAINING BANK', W / 2, 34);
    c.font = `500 16px ${FONT}`;
    c.fillText('Training ATM · fictional transaction', W / 2, 64);
    c.textAlign = 'left';
    c.font = `500 19px 'DejaVu Sans Mono', 'Courier New', monospace`;
    lines.forEach((l, i) => c.fillText(l.slice(0, 32), 18, 100 + i * lineH));
    c.textAlign = 'center';
    c.font = `700 15px ${FONT}`;
    c.fillText('TRAINING RECEIPT — NOT A REAL TRANSACTION', W / 2, H - 34);
    c.strokeStyle = '#999';
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(10, H - 60);
    c.lineTo(W - 10, H - 60);
    c.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const paperW = 0.074;
    const fullLen = Math.min(0.125, (H / W) * paperW);
    const SEG = 28;
    const geo = new THREE.PlaneGeometry(paperW, 1, 1, SEG);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'receipt';
    mesh.frustumCulled = false;
    this.layer.add(mesh);
    const rec: Receipt = { mesh, tex, mat, geo, fullLen };
    this.receipt = rec;
    this.layoutReceipt(rec, 0);
    this.model.setMotor('printer', true);
    const dur = 500 + lines.length * 110;
    this.sfx.play('print', { durationMs: dur });
    await this.tween(dur, (p) => this.layoutReceipt(rec, p), Easing.linear);
    if (!this.alive(g)) return;
    this.model.setMotor('printer', false);
    await this.clock.wait(150);
    if (!this.alive(g)) return;
    this.sfx.play('click', { volume: 0.6 });
    mesh.userData.prop = 'receipt';
  }

  /** Paper strip out of the slot, drooping slightly and resting on the shelf; `p` = fraction fed out. */
  private layoutReceipt(r: Receipt, p: number): void {
    const slot = wp(this.model.anchors.receiptSlot);
    const shelfY = wp(this.extras.cardRest.parent).y + this.extras.cardRest.position.y - 0.0002;
    const len = Math.max(0.002, r.fullLen * p);
    const pos = r.geo.attributes.position as THREE.BufferAttribute;
    const uv = r.geo.attributes.uv as THREE.BufferAttribute;
    const SEG = pos.count / 2 - 1;
    // PlaneGeometry rows go from top (v=1) to bottom (v=0); row 0 = far end
    let y = slot.y;
    let z = slot.z;
    const step = len / SEG;
    const pts: Array<[number, number]> = [[y, z]];
    for (let i = 1; i <= SEG; i++) {
      const s = i * step;
      const ang = 0.12 + Math.min(1, s / 0.1) * 0.35;
      y -= Math.sin(ang) * step;
      z += Math.cos(ang) * step;
      if (y < shelfY) y = shelfY;
      pts.push([y, z]);
    }
    const half = 0.037;
    for (let row = 0; row <= SEG; row++) {
      const k = SEG - row; // distance index from the slot
      const [py, pz] = pts[k];
      // upright for the customer: header nearest the slot, footer at the free end
      const vv = r.fullLen > 0 ? (len * (1 - k / SEG)) / r.fullLen : 0;
      for (let col = 0; col < 2; col++) {
        const i = row * 2 + col;
        pos.setXYZ(i, slot.x + (col === 0 ? -half : half), py, pz);
        uv.setXY(i, col, vv);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    r.geo.computeVertexNormals();
  }

  private removeReceipt(): void {
    const r = this.receipt;
    if (!r) return;
    r.mesh.removeFromParent();
    r.geo.dispose();
    r.mat.dispose();
    r.tex.dispose();
    this.receipt = null;
  }

  /** Customer takes the printed receipt (real-time, not sim-time: it is a user action). */
  takeReceipt(): void {
    const r = this.receipt;
    if (!r) return;
    r.mesh.userData.prop = undefined;
    this.model.leds.receipt.set('off');
    const from = r.mesh.position.clone();
    void this.realTween(350, (p) => {
      r.mesh.position.set(from.x, from.y + 0.04 * p, from.z + 0.2 * p);
    }).then(() => {
      if (this.receipt === r) this.removeReceipt();
    });
  }

  // ───────────────────────────── card ─────────────────────────────

  private cardToRoot(): void {
    const c = this.card;
    if (c.parent !== this.model.root) this.model.root.attach(c);
  }

  private async moveCard(ms: number, toP: THREE.Vector3, toQ: THREE.Quaternion, ease = Easing.inOut, real = false): Promise<void> {
    const c = this.card;
    c.updateWorldMatrix(true, false);
    const fromP = new THREE.Vector3();
    const fromQ = new THREE.Quaternion();
    c.matrixWorld.decompose(fromP, fromQ, new THREE.Vector3());
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const fn = (k: number): void => {
      const e = real ? ease(k) : k;
      p.lerpVectors(fromP, toP, e);
      q.slerpQuaternions(fromQ, toQ, e);
      setWorldPose(c, p, q);
    };
    if (real) await this.realTween(ms, fn);
    else await this.tween(ms, fn, ease);
  }

  private setCardProp(prop: string): void {
    this.card.traverse((o) => (o.userData.prop = prop));
  }

  private restWorld(): { p: THREE.Vector3; q: THREE.Quaternion } {
    const r = this.extras.cardRest;
    r.parent.updateWorldMatrix(true, false);
    const p = r.position.clone().applyMatrix4(r.parent.matrixWorld);
    const pq = new THREE.Quaternion();
    r.parent.matrixWorld.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
    return { p, q: pq.multiply(r.quaternion) };
  }

  private cardToRest(): void {
    const c = this.card;
    const r = this.extras.cardRest;
    r.parent.add(c);
    c.position.copy(r.position);
    c.quaternion.copy(r.quaternion);
    this.cardState = 'rest';
    this.setCardProp('card');
  }

  async cardIn(method: 'chip' | 'contactless'): Promise<void> {
    const g = this.gen;
    this.cardToRoot();
    this.setCardProp('card-moving');
    if (method === 'contactless') {
      const tap = wp(this.model.anchors.contactless);
      this.cardState = 'moving';
      await this.moveCard(650, tap.clone().add(new THREE.Vector3(0, 0, 0.012)), CARD_TAP_Q);
      if (!this.alive(g)) return;
      this.sfx.play('beep');
      this.model.leds.contactless.set('on', 0x22ff88);
      await this.clock.wait(450);
      if (!this.alive(g)) return;
      this.model.leds.contactless.set('off');
      const rest = this.restWorld();
      await this.moveCard(650, rest.p, rest.q);
      if (!this.alive(g)) return;
      this.cardToRest();
      return;
    }
    const slot = wp(this.model.anchors.cardSlot);
    const inside = wp(this.model.anchors.cardReaderInside);
    this.cardState = 'moving';
    // bring the card to the mouth, chip end first
    const approach = slot.clone().add(new THREE.Vector3(0, 0, CARD_W / 2 + 0.012));
    if (wp(this.card).distanceTo(approach) > 0.01) await this.moveCard(550, approach, CARD_INSERT_Q);
    if (!this.alive(g)) return;
    this.sfx.play('card');
    this.model.setMotor('card', true);
    await this.moveCard(650, inside, CARD_INSERT_Q, Easing.inOut);
    if (!this.alive(g)) return;
    this.model.setMotor('card', false);
    this.cardState = 'inside';
    this.setCardProp('card-inside');
  }

  async cardEject(): Promise<void> {
    const g = this.gen;
    if (this.cardState === 'rest') return; // contactless session: nothing to eject
    this.cardToRoot();
    const slot = wp(this.model.anchors.cardSlot);
    const out = slot.clone().add(new THREE.Vector3(0, 0, 0.05 - CARD_W / 2));
    this.sfx.play('card');
    this.model.setMotor('card', true);
    await this.moveCard(700, out, CARD_INSERT_Q, Easing.out);
    if (!this.alive(g)) return;
    this.model.setMotor('card', false);
    this.cardState = 'ejected';
    this.setCardProp('card-ejected');
  }

  async cardRetain(): Promise<void> {
    const g = this.gen;
    if (this.cardState === 'rest') return;
    this.cardToRoot();
    this.setCardProp('card-retained');
    this.sfx.play('card');
    this.model.setMotor('card', true);
    const inside = wp(this.model.anchors.cardReaderInside);
    if (this.cardState === 'ejected') await this.moveCard(450, inside, CARD_INSERT_Q, Easing.in);
    if (!this.alive(g)) return;
    const bin = wp(this.model.anchors.cardRetainBin);
    const behind = new THREE.Vector3(inside.x, inside.y, bin.z + 0.02);
    await this.moveCard(450, behind, CARD_INSERT_Q, Easing.linear);
    if (!this.alive(g)) return;
    const tilt = CARD_INSERT_Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5));
    await this.moveCard(350, bin, tilt, Easing.in);
    if (!this.alive(g)) return;
    this.model.setMotor('card', false);
    this.cardState = 'retained';
  }

  /** Customer took the ejected card: it goes back to the shelf (real-time user action). */
  takeCard(): void {
    if (this.cardState !== 'ejected') return;
    this.cardState = 'moving';
    this.setCardProp('card-moving');
    const rest = this.restWorld();
    const slot = wp(this.model.anchors.cardSlot);
    const pull = slot.clone().add(new THREE.Vector3(0, 0.01, 0.12));
    void this.moveCard(260, pull, CARD_INSERT_Q, Easing.out, true)
      .then(() => this.moveCard(480, rest.p, rest.q, Easing.inOut, true))
      .then(() => {
        if (this.cardState === 'moving') this.cardToRest();
      });
  }

  setCardAppearance(holder: string, masked: string, color: number): void {
    const fn = this.card.userData.setAppearance as ((a: { holder: string; masked: string; color: number }) => void) | undefined;
    fn?.({ holder, masked, color });
  }

  // ───────────────────────────── deposit ─────────────────────────────

  async depositIntake(notes: Note[]): Promise<void> {
    const g = this.gen;
    if (!notes.length) return;
    const slot = wp(this.model.anchors.depositSlot);
    const escrowP = wp(this.model.anchors.escrow);
    const inQ = sheetQuat(new THREE.Vector3(0, 0, -1));
    if (!this.escrow) {
      this.escrow = new THREE.Group();
      this.escrow.name = 'escrow-bundle';
      this.layer.add(this.escrow);
      this.escrow.position.copy(escrowP);
      this.escrow.quaternion.copy(inQ);
    }
    const escrow = this.escrow;
    // customer pushes the bundle into the slot
    const hand = new THREE.Group();
    this.layer.add(hand);
    hand.quaternion.copy(inQ);
    const meshes = notes.map((n, i) => {
      const m = this.pool.acquire(n.denom);
      m.userData.noteId = n.id;
      m.userData.suspect = !!n.suspect;
      m.position.set((i % 2 ? 1 : -1) * 0.001, 0, 0.0008 + i * NOTE_GAP);
      hand.add(m);
      return m;
    });
    const outside = slot.clone().add(new THREE.Vector3(0, 0, 0.1));
    const mouth = slot.clone().add(new THREE.Vector3(0, 0, NOTE_H / 2 - 0.02));
    await this.tween(450, (p) => hand.position.lerpVectors(outside, mouth, p), Easing.out);
    if (!this.alive(g)) return;
    this.model.setMotor('deposit', true);
    this.sfx.play('motor', { volume: 0.45, durationMs: 300 + notes.length * 200 });
    // validator takes the notes one by one (top of the bundle first)
    const valP = slot.clone().setZ((slot.z + escrowP.z) / 2 + 0.05);
    for (let i = meshes.length - 1; i >= 0; i--) {
      const m = meshes[i];
      this.layer.attach(m);
      const a = m.position.clone();
      const target = escrowP.clone().add(new THREE.Vector3(0, 0.002 + escrow.children.length * NOTE_GAP, 0));
      let scanned = false;
      await this.tween(
        230,
        (p) => {
          if (p < 0.5) m.position.lerpVectors(a, valP, p * 2);
          else m.position.lerpVectors(valP, target, (p - 0.5) * 2);
          m.quaternion.copy(inQ);
          if (!scanned && p > 0.45) {
            scanned = true;
            this.scanFlash = 0.25;
            this.scanMat?.emissive.set(m.userData.suspect ? 0xffb020 : 0x22ff88);
            if (this.scanMat) this.scanMat.emissiveIntensity = 4;
            this.sfx.play('count', { volume: 0.5 });
          }
        },
        Easing.linear,
      );
      if (!this.alive(g)) return;
      escrow.attach(m);
    }
    hand.removeFromParent();
    this.model.setMotor('deposit', false);
  }

  async depositStore(_notes: Note[]): Promise<void> {
    const g = this.gen;
    const e = this.escrow;
    if (!e) return;
    this.escrow = null;
    this.model.setMotor('deposit', true);
    this.sfx.play('motor', { volume: 0.45, durationMs: 1000 });
    const bin = wp(this.model.anchors.depositBin);
    const p0 = e.position.clone();
    const p1 = new THREE.Vector3(bin.x, p0.y, bin.z);
    const p2 = bin.clone().add(new THREE.Vector3(0, -0.06, 0));
    await this.tween(450, (p) => e.position.lerpVectors(p0, p1, p), Easing.inOut);
    if (!this.alive(g)) return;
    await this.tween(500, (p) => e.position.lerpVectors(p1, p2, p), Easing.in);
    if (!this.alive(g)) return;
    this.model.setMotor('deposit', false);
    for (const c of [...e.children]) this.pool.release(c as THREE.Mesh);
    e.removeFromParent();
  }

  async depositReturn(_notes: Note[]): Promise<void> {
    const g = this.gen;
    const e = this.escrow;
    if (!e) return;
    this.escrow = null;
    this.model.setMotor('deposit', true);
    this.sfx.play('motor', { volume: 0.45, durationMs: 700 });
    const slot = wp(this.model.anchors.depositSlot);
    const p0 = e.position.clone();
    const p1 = slot.clone().add(new THREE.Vector3(0, 0, 0.012));
    await this.tween(650, (p) => e.position.lerpVectors(p0, p1, p), Easing.inOut);
    if (!this.alive(g)) return;
    this.model.setMotor('deposit', false);
    this.model.leds.deposit.set('blink', 0xffb020);
    await this.clock.wait(1200);
    if (!this.alive(g)) return;
    const p2 = slot.clone().add(new THREE.Vector3(0, 0.03, 0.25));
    await this.tween(400, (p) => e.position.lerpVectors(p1, p2, p), Easing.in);
    if (!this.alive(g)) return;
    this.model.leds.deposit.set('off');
    for (const c of [...e.children]) this.pool.release(c as THREE.Mesh);
    e.removeFromParent();
  }

  // ───────────────────────────── alerts / vibration ─────────────────────────────

  setComponentAlert(id: ComponentId, level: DeviceStatus): void {
    const existing = this.alerts.get(id);
    if (level === 'OK') {
      if (existing) this.removeAlert(existing);
      return;
    }
    if (existing) {
      existing.level = level;
      existing.fillMat.color.set(ALERT_COLORS[level]);
      existing.lineMat.color.set(ALERT_COLORS[level]);
      return;
    }
    const part = this.model.parts.get(id);
    if (!part) return;
    const group = new THREE.Group();
    group.name = `alert-${id}`;
    const fillMat = new THREE.MeshBasicMaterial({ color: ALERT_COLORS[level], transparent: true, opacity: 0.18, depthWrite: false, depthTest: false });
    const lineMat = new THREE.LineBasicMaterial({ color: ALERT_COLORS[level], transparent: true, opacity: 0.9, depthTest: false });
    const box = new THREE.Mesh(this.alertBox, fillMat);
    box.renderOrder = 30;
    box.userData.noPick = true;
    const edges = new THREE.LineSegments(this.alertEdges, lineMat);
    edges.renderOrder = 31;
    edges.userData.noPick = true;
    group.add(box, edges);
    group.raycast = () => {};
    box.raycast = () => {};
    edges.raycast = () => {};
    this.layer.add(group);
    const a: Alert = { id, level, group, fillMat, lineMat };
    this.alerts.set(id, a);
    this.fitAlert(a);
    if (level === 'FAULT') this.sfx.play('error', { volume: 0.5 });
  }

  private fitAlert(a: Alert): void {
    const part = this.model.parts.get(a.id);
    if (!part) return;
    const bb = new THREE.Box3().setFromObject(part);
    if (bb.isEmpty()) return;
    const size = bb.getSize(new THREE.Vector3()).addScalar(0.02);
    bb.getCenter(a.group.position);
    a.group.scale.copy(size);
  }

  private removeAlert(a: Alert): void {
    a.group.removeFromParent();
    a.fillMat.dispose();
    a.lineMat.dispose();
    this.alerts.delete(a.id);
  }

  setVibration(on: boolean): void {
    this.vibration = on;
  }

  // ───────────────────────────── per-frame / lifecycle ─────────────────────────────

  /** Real-time per-frame visuals (vibration, pulsing alerts, sensor flashes, user-action tweens). */
  update(dtSec: number): void {
    this.time += dtSec;
    // user-action tweens
    for (let i = this.realTweens.length - 1; i >= 0; i--) {
      const tw = this.realTweens[i];
      tw.t += dtSec;
      const p = Math.min(1, tw.t / tw.dur);
      tw.fn(p);
      if (p >= 1) {
        this.realTweens.splice(i, 1);
        tw.resolve();
      }
    }
    // transport motor auto-stops when idle (sim time)
    const transportBusy = this.clock.now() - this.lastTransportUse < 450;
    if (!transportBusy && this.lastTransportUse > -1e8) {
      this.model.setMotor('transport', false);
      this.lastTransportUse = -1e9;
    }
    const shake = (this.vibration || transportBusy) && !this.clock.paused;
    for (const t of this.extras.vibrationTargets) {
      if (shake) t.position.set((Math.random() - 0.5) * 0.0007, (Math.random() - 0.5) * 0.0007, (Math.random() - 0.5) * 0.0005);
      else if (t.position.lengthSq() > 0) t.position.set(0, 0, 0);
    }
    // sensor + scan flash decay
    if (this.sensorMat && this.sensorFlash > 0) {
      this.sensorFlash -= dtSec;
      if (this.sensorFlash <= 0) {
        this.sensorMat.emissive.copy(this.sensorBase);
        this.sensorMat.emissiveIntensity = 1.2;
      }
    }
    if (this.scanMat && this.scanFlash > 0) {
      this.scanFlash -= dtSec;
      if (this.scanFlash <= 0) {
        this.scanMat.emissive.copy(this.scanBase);
        this.scanMat.emissiveIntensity = 1;
      }
    }
    // pulsing alerts
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    for (const a of this.alerts.values()) {
      this.fitAlert(a);
      a.fillMat.opacity = 0.08 + 0.16 * pulse;
      a.lineMat.opacity = 0.45 + 0.5 * pulse;
    }
    for (const j of this.jamMarkers) (j.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.35 * pulse;
  }

  /** Clickable transient objects: presented cash, ejected card, printed receipt. */
  getInteractive(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    if (this.bundle?.userData.prop === 'cash') out.push(this.bundle);
    if (this.cardState === 'ejected') out.push(this.card);
    if (this.receipt?.mesh.userData.prop === 'receipt') out.push(this.receipt.mesh);
    return out;
  }

  /** Remove every transient mesh and put the mechanism back to its idle state. */
  reset(): void {
    this.gen++;
    for (const m of [...this.notes.values()]) this.releaseNote(m);
    this.notes.clear();
    this.stackerNotes = [];
    if (this.bundle) this.releaseBundle(this.bundle);
    this.bundle = null;
    if (this.escrow) {
      for (const c of [...this.escrow.children]) this.pool.release(c as THREE.Mesh);
      this.escrow.removeFromParent();
      this.escrow = null;
    }
    for (const c of [...this.layer.children]) {
      if (c.name === 'escrow-bundle' || c.name === 'presented-bundle') c.removeFromParent();
      else if ((c as THREE.Mesh).userData?.note) this.pool.release(c as THREE.Mesh);
      else if (c.type === 'Group' && !c.name.startsWith('alert-')) c.removeFromParent();
    }
    this.removeReceipt();
    for (const a of [...this.alerts.values()]) this.removeAlert(a);
    for (const j of this.jamMarkers) {
      j.removeFromParent();
      (j.material as THREE.Material).dispose();
    }
    this.jamMarkers.length = 0;
    this.realTweens.length = 0;
    this.cardToRest();
    if (this.shutter) this.shutter.position.y = this.shutterRestY;
    if (this.clamp) this.clamp.position.y = this.clampRestY;
    if (this.diverter) this.diverter.rotation.x = this.diverterRest;
    for (const g of ['picker-A', 'picker-B', 'picker-C', 'transport', 'stacker', 'presenter', 'printer', 'card', 'deposit'] as const) this.model.setMotor(g, false);
    this.lastTransportUse = -1e9;
    this.vibration = false;
    for (const t of this.extras.vibrationTargets) t.position.set(0, 0, 0);
    if (this.sensorMat) {
      this.sensorMat.emissive.copy(this.sensorBase);
      this.sensorMat.emissiveIntensity = 1.2;
    }
    this.model.leds.cash.set('off');
    this.model.leds.contactless.set('off');
  }

  dispose(): void {
    this.reset();
    this.layer.removeFromParent();
    this.alertBox.dispose();
    this.alertEdges.dispose();
  }
}
