import * as THREE from 'three';
import type { Ctx } from '../ui/context';
import type { KeypadKey } from '../core/types';

/**
 * Helpers exposed on `window.atmTest` so browser tests (and curious trainers in the console) can find
 * where things are on screen and click the real 3D objects instead of calling the domain directly.
 */
export function installTestHooks(ctx: Ctx): void {
  const canvas = ctx.stage.renderer.domElement;
  const toClient = (world: THREE.Vector3) => {
    const p = world.clone().project(ctx.stage.camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
  };
  const center = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());

  const hooks = {
    objectPoint(o: THREE.Object3D) {
      return toClient(center(o));
    },
    partPoint(id: string) {
      const o = ctx.model.parts.get(id as never);
      return o ? toClient(center(o)) : null;
    },
    keyPoint(key: KeypadKey) {
      const m = ctx.model.keys.get(key);
      return m ? toClient(center(m)) : null;
    },
    cardPoint() {
      return toClient(center(ctx.model.props.card));
    },
    propPoint(prop: string) {
      const o = ctx.mech.getInteractive().find((x) => x.userData.prop === prop);
      return o ? toClient(center(o)) : null;
    },
    /** Client coordinates of an on-screen ATM button (maps the button's UV onto the screen plane). */
    screenButtonPoint(id: string) {
      const uv = ctx.screen.buttonUv(id);
      if (!uv) return null;
      const mesh = ctx.model.screenMesh;
      const g = mesh.geometry;
      const pos = g.getAttribute('position');
      const uvs = g.getAttribute('uv');
      // Bilinear search over the mesh's vertices: find local point whose UV matches (works for planes).
      let best: THREE.Vector3 | null = null;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const ua = new THREE.Vector2(), ub = new THREE.Vector2(), uc = new THREE.Vector2();
      const index = g.index;
      const triCount = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount && !best; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        ua.fromBufferAttribute(uvs, i0); ub.fromBufferAttribute(uvs, i1); uc.fromBufferAttribute(uvs, i2);
        // barycentric coordinates of uv in the uv-triangle
        const v0 = ub.clone().sub(ua), v1 = uc.clone().sub(ua), v2 = uv.clone().sub(ua);
        const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1);
        const den = d00 * d11 - d01 * d01;
        if (Math.abs(den) < 1e-12) continue;
        const v = (d11 * d20 - d01 * d21) / den;
        const w = (d00 * d21 - d01 * d20) / den;
        const u = 1 - v - w;
        if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) best = a.clone().multiplyScalar(u).add(b.clone().multiplyScalar(v)).add(c.clone().multiplyScalar(w));
      }
      if (!best) return null;
      mesh.updateWorldMatrix(true, false);
      return toClient(mesh.localToWorld(best));
    },
    state() {
      const t = ctx.sys.journal.transactions[ctx.sys.journal.transactions.length - 1];
      return {
        screen: ctx.sys.app.screen.id,
        busy: ctx.sys.app.busy,
        txnState: t?.state ?? null,
        waitingForCash: ctx.port.waitingForCash,
        waitingForCard: ctx.port.waitingForCard,
        cassettes: ctx.sys.inventory.snapshot().cassettes.map((c) => ({ id: c.id, counter: c.counter })),
        invariants: ctx.sys.checkInvariants(),
        fps: ctx.stage.fps,
      };
    },
    /** Jump the camera instantly to a focus preset (tests don't need the smooth move). */
    camera(name: 'front' | 'screen' | 'keypad' | 'upper' | 'dispenser' | 'safe' | 'side') {
      const f = ctx.model.anchors.focus[name];
      ctx.stage.camera.position.copy(f.position);
      ctx.stage.controls.target.copy(f.target);
      ctx.stage.controls.update();
    },
  };
  (window as unknown as { atmTest: typeof hooks }).atmTest = hooks;
}
