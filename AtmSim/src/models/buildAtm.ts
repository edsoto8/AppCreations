import * as THREE from 'three';
import type { CassetteId, ComponentId, Denomination } from '../core/types';
import type { AtmAnchors, AtmModel } from './types';
import { buildCard } from './card';
import { createCtx, type FillBin, type MotorGroup } from './context';
import { buildExterior } from './atmExterior';
import { buildInternals } from './atmInternals';
import { createMaterials, createShellMaterials, disposeSet } from './materials';
import { disposeDeep, mergeStatic } from './util';

export interface BuildAtmOptions {
  /** Denomination shown on each cassette's label / stack face (cosmetic). Default A $20 · B $50 · C $100. */
  cassetteDenoms?: Record<CassetteId, Denomination>;
  /** Merge static meshes per part/material to cut draw calls (default true). */
  mergeStatic?: boolean;
}

/** Extra, non-contract handles the MechanismAnimator uses (read from `root.userData.atm`). */
export interface AtmModelExtras {
  vibrationTargets: THREE.Object3D[];
  /** Parent + local pose of the card when resting on the wallet shelf. */
  cardRest: { parent: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion };
  /** Extra waypoints: diverter → reject channel → reject cassette entry. */
  rejectPath: THREE.Object3D[];
  /** Fill ratio last set per bin (for animators). */
  fill: Partial<Record<FillBin, number>>;
}

export function getAtmExtras(model: AtmModel): AtmModelExtras | undefined {
  return model.root.userData.atm as AtmModelExtras | undefined;
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/**
 * Build the procedural lobby ATM. Front faces +Z, base at y = 0, centred on x = 0 (metres).
 */
export function buildAtm(opts: BuildAtmOptions = {}): AtmModel {
  const denoms = opts.cassetteDenoms ?? { A: 20, B: 50, C: 100 };
  const m = createMaterials();
  const s = createShellMaterials();
  const ctx = createCtx(m, s);
  const root = ctx.root;
  root.name = 'atm';

  const ext = buildExterior(ctx);
  const int = buildInternals(ctx, denoms);

  // training card prop on the wallet shelf (child of the service door so it follows it)
  const card = buildCard();
  const restParent = ext.serviceInner;
  card.root.position.copy(ext.cardRest.position);
  card.root.quaternion.copy(ext.cardRest.quaternion);
  restParent.add(card.root);
  card.root.userData.setAppearance = card.setAppearance;

  // component ids: every mesh inherits the id of its nearest part group
  const assign = (o: THREE.Object3D, id: ComponentId | undefined): void => {
    const pid = (o.userData.partId as ComponentId | undefined) ?? id;
    if ((o as THREE.Mesh).isMesh && pid && !o.userData.componentId) o.userData.componentId = pid;
    for (const c of o.children) assign(c, pid);
  };
  assign(root, undefined);

  if (opts.mergeStatic !== false) mergeStatic(root, ctx.shell);

  // shadows: only big shell panels cast; everything receives
  root.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (mm.isMesh) mm.receiveShadow = true;
  });

  const a = (name: string): THREE.Object3D => {
    const o = ctx.anchors.get(name);
    if (!o) throw new Error(`missing anchor ${name}`);
    return o;
  };
  const series = (prefix: string): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    for (let i = 0; ctx.anchors.has(`${prefix}-${i}`); i++) out.push(a(`${prefix}-${i}`));
    return out;
  };

  const anchors: AtmAnchors = {
    cardSlot: a('cardSlot'),
    cardReaderInside: a('cardReaderInside'),
    cardRetainBin: a('cardRetainBin'),
    contactless: a('contactless'),
    receiptSlot: a('receiptSlot'),
    printerHead: a('printerHead'),
    depositSlot: a('depositSlot'),
    escrow: a('escrow'),
    depositBin: a('depositBin'),
    cassettePick: { A: a('pick-A'), B: a('pick-B'), C: a('pick-C') },
    transportPath: series('transport'),
    sensor: a('sensor'),
    rejectEntry: a('rejectEntry'),
    stacker: a('stacker'),
    presenterPath: series('presenter'),
    shutterOutside: a('shutterOutside'),
    retractEntry: a('retractEntry'),
    focus: {
      front: { position: v(0.3, 1.45, 2.75), target: v(0, 0.98, 0.05) },
      screen: { position: v(0.0, 1.36, 0.95), target: v(0, 1.31, 0.32) },
      keypad: { position: v(0.08, 1.52, 1.25), target: v(0.03, 1.08, 0.4) },
      upper: { position: v(0.38, 1.45, 1.3), target: v(-0.02, 1.2, -0.1) },
      dispenser: { position: v(0.75, 0.95, 1.1), target: v(0.1, 0.5, -0.05) },
      safe: { position: v(0.25, 0.85, 1.55), target: v(0.0, 0.45, 0.0) },
      side: { position: v(2.1, 1.25, 0.55), target: v(0, 0.9, 0) },
    },
  };

  const parts = ctx.parts;
  const E: Partial<Record<ComponentId, THREE.Vector3>> = {
    // exterior skin moves back / aside so every module stands free in front of it
    cabinet: v(0, 0, -1.05),
    safe: v(0, 0, -1.05),
    'topper-sign': v(0, 0.32, -1.05),
    'locks-hinges': v(0, 0, -1.05),
    'service-door': v(-0.95, 0.05, 0.1),
    'vault-door': v(-0.95, 0, 0.1),
    display: v(0, 0.16, 0.5),
    keypad: v(0, 0.02, 0.62),
    'card-reader': v(0.22, 0.04, 0.5),
    'contactless-reader': v(0.22, 0.1, 0.45),
    'receipt-slot': v(0.22, -0.02, 0.5),
    speakers: v(0, 0.08, 0.38),
    camera: v(0, 0.2, 0.42),
    'status-leds': v(0.12, 0.2, 0.42),
    accessibility: v(-0.2, 0.04, 0.42),
    'cash-slot': v(0.08, -0.02, 0.5),
    'deposit-slot': v(-0.1, -0.02, 0.5),
    // internal: cash
    'cassette-A': v(0.0, 0.1, 0.52),
    'cassette-B': v(0.0, 0.05, 0.4),
    'cassette-C': v(0.0, 0.0, 0.28),
    'reject-cassette': v(0.0, -0.04, 0.16),
    'retract-bin': v(0.0, 0.16, 0.62),
    dispenser: v(0.42, 0, -0.1),
    'picker-rollers': v(0.22, 0.0, -0.2),
    transport: v(0.22, 0.0, -0.36),
    'validation-sensors': v(0.22, 0.08, -0.5),
    stacker: v(0.22, 0.22, -0.26),
    'presenter-shutter': v(0.22, 0.3, 0.1),
    'deposit-module': v(-0.4, 0.0, 0.18),
    // internal: upper module
    'card-reader-module': v(0.42, 0.14, 0.2),
    'receipt-printer': v(0.42, -0.04, 0.3),
    'controller-pc': v(-0.12, 0.32, -0.2),
    'power-supply': v(-0.48, 0.18, -0.12),
    comms: v(0.28, 0.5, -0.2),
  };
  const explodeOffsets = new Map<ComponentId, THREE.Vector3>();
  for (const id of parts.keys()) explodeOffsets.set(id, E[id] ?? v(0, 0, 0));

  // motors / fills
  const active = new Set<MotorGroup>();
  const fillState: Partial<Record<FillBin, number>> = {};
  const setFill = (bin: FillBin, ratio: number): void => {
    const f = ctx.fills[bin];
    if (!f) return;
    const r = Math.min(1, Math.max(0, ratio));
    fillState[bin] = r;
    const len = Math.max(f.min ?? 0.0005, r * f.max);
    f.stack.scale[f.axis] = len;
    f.stack.visible = r > 0.0005;
    if (f.pusher && f.pusherBase !== undefined) f.pusher.position.z = f.pusherBase + (r > 0.0005 ? len : 0);
  };
  setFill('A', 0.8);
  setFill('B', 0.5);
  setFill('C', 0.25);
  setFill('reject', 0);
  setFill('retract', 0);
  setFill('deposit', 0);

  const extras: AtmModelExtras = {
    vibrationTargets: int.vibrationTargets,
    cardRest: { parent: restParent, position: ext.cardRest.position.clone(), quaternion: ext.cardRest.quaternion.clone() },
    rejectPath: series('reject'),
    fill: fillState,
  };
  root.userData.atm = extras;

  const leds = ctx.leds as Required<typeof ctx.leds>;
  leds.status.set('on', 0x22dd66);
  let t = 0;

  const model: AtmModel = {
    root,
    parts,
    explodeOffsets,
    screenMesh: ext.screenMesh,
    keys: ext.keys,
    doors: ext.doors,
    leds,
    props: { card: card.root },
    anchors,
    shellMeshes: [...ctx.shell],
    update(dt: number) {
      t += dt;
      for (const l of Object.values(leds)) l.tick(t);
      for (const g of active) {
        for (const sp of ctx.spinners[g]) sp.obj.rotation.x += sp.speed * dt;
        for (const b of ctx.belts[g]) b.offset.y -= dt * 1.2 * 30;
      }
    },
    setMotor(group, on) {
      if (on) active.add(group);
      else active.delete(group);
    },
    setFill,
    dispose() {
      card.dispose();
      disposeDeep(root);
      disposeSet(m as unknown as { textures: THREE.Texture[] } & Record<string, unknown>);
      disposeSet(s as unknown as { textures: THREE.Texture[] } & Record<string, unknown>);
      for (const mm of ctx.ownedMaterials) mm.dispose();
      for (const tx of ctx.ownedTextures) tx.dispose();
    },
  };
  return model;
}
