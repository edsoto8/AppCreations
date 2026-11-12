import type * as THREE from 'three';
import type { CassetteId, ComponentId, KeypadKey } from '../core/types';

/**
 * Contract between the procedural ATM model (models/) and the rest of the app.
 *
 * Coordinate system: metres, +Y up, the ATM front faces +Z, centred on x=0, base on y=0.
 * Every mesh that belongs to an inspectable part has `mesh.userData.componentId = <ComponentId>`
 * so a raycast hit can be resolved to a part. Decorative meshes with no component may omit it.
 */
export interface AtmModel {
  root: THREE.Group;

  /** One group per inspectable component. Exploded view moves these groups. */
  parts: Map<ComponentId, THREE.Object3D>;

  /** Offset (in the part's parent space) applied at 100% exploded view. */
  explodeOffsets: Map<ComponentId, THREE.Vector3>;

  /** Plane whose UVs span 0..1 across the visible display area. Its material.map is set by the app (CanvasTexture 1024x768). */
  screenMesh: THREE.Mesh;

  /** Physical keypad keys (each a mesh with userData.key = KeypadKey). */
  keys: Map<KeypadKey, THREE.Mesh>;

  /** Doors that open on a hinge. `setOpen(0..1)` positions them; the app tweens the value. */
  doors: {
    /** Upper fascia / service door: exposes card reader, printer, PC, comms, power supply. */
    service: Door;
    /** Lower safe door: exposes cassettes, dispenser, reject/retract, deposit module. */
    vault: Door;
  };

  /** Customer lead-through indicator lights (flash to guide the customer). */
  leds: Record<'card' | 'cash' | 'receipt' | 'deposit' | 'contactless' | 'status', Led>;

  /** Interactive props in the lobby. */
  props: {
    /** The fictional training card on the counter shelf, clickable / draggable. userData.prop = 'card'. */
    card: THREE.Object3D;
  };

  /**
   * Named world-space anchors used by the mechanism animator. All are Object3Ds inside `root`,
   * so they follow doors/explosion. Read positions with getWorldPosition.
   */
  anchors: AtmAnchors;

  /** Meshes that make up the outer shell; hidden or made transparent by X-ray / cutaway views. */
  shellMeshes: THREE.Mesh[];

  /** Per-frame update (real dt seconds): spins active rollers, LED blinking, etc. */
  update(dtSec: number): void;

  /** Spin the rollers of a mechanism (visual only). */
  setMotor(group: 'picker-A' | 'picker-B' | 'picker-C' | 'transport' | 'stacker' | 'presenter' | 'printer' | 'card' | 'deposit', on: boolean): void;

  /** Visual fill level (0..1) of a cassette or bin; the app calls this on every inventory change. */
  setFill(bin: CassetteId | 'reject' | 'retract' | 'deposit', ratio: number): void;

  /** Release GPU resources. */
  dispose(): void;
}

export interface Door {
  pivot: THREE.Object3D;
  /** 0 = closed, 1 = fully open. */
  setOpen(amount: number): void;
  readonly open: number;
}

export interface Led {
  mesh: THREE.Mesh;
  set(state: 'off' | 'on' | 'blink', color?: number): void;
}

export interface AtmAnchors {
  cardSlot: THREE.Object3D; // mouth of the card slot (outside)
  cardReaderInside: THREE.Object3D; // card resting position inside the reader module
  cardRetainBin: THREE.Object3D;
  contactless: THREE.Object3D; // tap target in front of the contactless reader
  receiptSlot: THREE.Object3D;
  printerHead: THREE.Object3D;
  depositSlot: THREE.Object3D;
  escrow: THREE.Object3D;
  depositBin: THREE.Object3D;
  /** Top note position of each cassette, where the picker lifts notes off. */
  cassettePick: Record<CassetteId, THREE.Object3D>;
  /** Ordered waypoints from the picker exit up the vertical transport to the stacker entry. */
  transportPath: THREE.Object3D[];
  /** Sensor gate on the transport (thickness / double-detect / skew). */
  sensor: THREE.Object3D;
  /** Diverter gate + path end into the reject cassette. */
  rejectEntry: THREE.Object3D;
  stacker: THREE.Object3D; // staged bundle position
  presenterPath: THREE.Object3D[]; // stacker → shutter
  shutterOutside: THREE.Object3D; // where the bundle sits when presented, half outside the fascia
  retractEntry: THREE.Object3D;
  /** Camera targets for focus moves. */
  focus: Record<'front' | 'screen' | 'keypad' | 'upper' | 'dispenser' | 'safe' | 'side', { position: THREE.Vector3; target: THREE.Vector3 }>;
}
