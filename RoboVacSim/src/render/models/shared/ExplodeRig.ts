import { Vector3, type Object3D } from 'three';

interface Entry {
  object: Object3D;
  base: Vector3;
  offset: Vector3;
  /** 0..1: when (within the explode progress) this part starts moving. */
  delay: number;
}

function smooth(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

/** Moves part roots from their assembled position along an exploded-view offset. */
export class ExplodeRig {
  private readonly entries: Entry[] = [];
  private amount = 0;

  add(object: Object3D, offset: readonly [number, number, number], delay = 0): void {
    this.entries.push({ object, base: object.position.clone(), offset: new Vector3(...offset), delay });
  }

  get value(): number {
    return this.amount;
  }

  set(amount: number): void {
    this.amount = Math.min(Math.max(amount, 0), 1);
    for (const e of this.entries) {
      const t = smooth((this.amount - e.delay * 0.4) / (1 - e.delay * 0.4));
      e.object.position.copy(e.base).addScaledVector(e.offset, t);
    }
  }
}
