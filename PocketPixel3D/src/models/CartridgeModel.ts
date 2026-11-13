import * as THREE from 'three';
import type { CartridgeDefinition } from '../games/GameInterface';
import { CART } from './Layout';
import type { Materials } from './Materials';
import { makeCartridgeLabelTexture } from './PrintTextures';
import { corners, extrude, roundedRectShape } from './Shapes';

/** Geometry shared by every cartridge (built once, disposed by the rig). */
export class CartridgeGeometry {
  readonly body: THREE.ExtrudeGeometry;
  readonly ridge: THREE.BoxGeometry;
  readonly backWall: THREE.BoxGeometry;
  readonly pcb: THREE.BoxGeometry;
  readonly contact: THREE.BoxGeometry;
  readonly label: THREE.PlaneGeometry;
  readonly labelFrame: THREE.PlaneGeometry;
  readonly arrow: THREE.ExtrudeGeometry;

  constructor() {
    const w = CART.width;
    const h = CART.height;
    const slot = 5;
    const main = roundedRectShape(0, slot / 2, w, h - slot, corners(1, { tl: 2.6, tr: 2.6 }));
    const legL = roundedRectShape(-w / 2 + 1.75, -h / 2 + slot / 2, 3.5, slot, corners(0.8, { tl: 0, tr: 0 }));
    const legR = roundedRectShape(w / 2 - 1.75, -h / 2 + slot / 2, 3.5, slot, corners(0.8, { tl: 0, tr: 0 }));
    this.body = extrude([main, legL, legR], CART.depth - 1.2, 0.6, 3, 8);
    this.body.translate(0, 0, -CART.depth / 2 + 0.6);
    this.ridge = new THREE.BoxGeometry(46, 0.9, 0.6);
    this.backWall = new THREE.BoxGeometry(w - 7, slot, 2.2);
    this.pcb = new THREE.BoxGeometry(w - 7.2, slot + 0.4, 1.1);
    this.contact = new THREE.BoxGeometry(1.05, 4, 0.08);
    this.label = new THREE.PlaneGeometry(48, 40);
    this.labelFrame = new THREE.PlaneGeometry(50, 42);
    const arrow = new THREE.Shape();
    arrow.moveTo(0, -6);
    arrow.lineTo(-5, 0);
    arrow.lineTo(-1.8, 0);
    arrow.lineTo(-1.8, 6);
    arrow.lineTo(1.8, 6);
    arrow.lineTo(1.8, 0);
    arrow.lineTo(5, 0);
    arrow.closePath();
    this.arrow = extrude(arrow, 0.35);
  }

  dispose(): void {
    for (const g of [this.body, this.ridge, this.backWall, this.pcb, this.contact, this.label, this.labelFrame, this.arrow]) g.dispose();
  }
}

/**
 * One physical cartridge. Origin at its centre; label side faces -z, the top edge is +y.
 */
export class CartridgeModel {
  readonly group = new THREE.Group();
  private readonly labelTexture: THREE.CanvasTexture;
  private readonly labelMaterial: THREE.MeshStandardMaterial;
  private readonly contacts: THREE.InstancedMesh;

  constructor(
    readonly definition: CartridgeDefinition,
    shared: CartridgeGeometry,
    m: Materials,
    anisotropy: number,
  ) {
    this.group.name = `cartridge-${definition.id}`;
    const body = new THREE.Mesh(shared.body, m.cartridgePlastic);
    body.castShadow = body.receiveShadow = true;
    this.group.add(body);

    const back = new THREE.Mesh(shared.backWall, m.cartridgePlastic);
    back.position.set(0, -CART.height / 2 + 2.5, CART.depth / 2 - 1.1);
    this.group.add(back);

    // Label (sticker) on the -z face, inside a slightly darker moulded frame.
    const frameMat = m.own(new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const frame = new THREE.Mesh(shared.labelFrame, frameMat);
    frame.rotation.y = Math.PI;
    frame.position.set(0, -4.5, -CART.depth / 2 - 0.01);
    this.group.add(frame);
    this.labelTexture = m.own(makeCartridgeLabelTexture(definition.title, definition.label, anisotropy, 48, 40));
    this.labelMaterial = m.own(
      new THREE.MeshPhysicalMaterial({ map: this.labelTexture, roughness: 0.42, clearcoat: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    const label = new THREE.Mesh(shared.label, this.labelMaterial);
    label.rotation.y = Math.PI;
    label.position.set(0, -4.5, -CART.depth / 2 - 0.03);
    this.group.add(label);

    // Grip ridges above the label.
    for (let i = 0; i < 5; i++) {
      const ridge = new THREE.Mesh(shared.ridge, m.cartridgePlastic);
      ridge.position.set(0, 19 + i * 2.6, -CART.depth / 2 - 0.2);
      ridge.castShadow = true;
      this.group.add(ridge);
    }
    // Insertion arrow on the back face.
    const arrow = new THREE.Mesh(shared.arrow, m.cartridgePlastic);
    arrow.position.set(0, 8, CART.depth / 2 - 0.05);
    this.group.add(arrow);

    // Edge connector PCB with gold fingers.
    const pcb = new THREE.Mesh(shared.pcb, m.pcb);
    pcb.position.set(0, -CART.height / 2 + 2.3, -0.6);
    this.group.add(pcb);
    this.contacts = new THREE.InstancedMesh(shared.contact, m.gold, 32);
    const d = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      d.position.set(-24 + i * (48 / 31), -CART.height / 2 + 2.2, -1.2);
      d.updateMatrix();
      this.contacts.setMatrixAt(i, d.matrix);
    }
    this.contacts.instanceMatrix.needsUpdate = true;
    this.group.add(this.contacts);

    this.group.traverse((o) => {
      o.userData.part = 'cartridge';
      o.userData.cartridgeId = definition.id;
    });
  }

  dispose(): void {
    this.contacts.dispose();
    this.group.removeFromParent();
  }
}
