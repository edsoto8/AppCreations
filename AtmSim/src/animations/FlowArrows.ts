import * as THREE from 'three';
import type { AtmModel } from '../models/types';
import { getAtmExtras } from '../models/buildAtm';

export type FlowRoute = 'dispense' | 'reject' | 'retract' | 'deposit';

const COLORS: Record<FlowRoute, number> = {
  dispense: 0x35e0c8,
  reject: 0xff4d5a,
  retract: 0xffb020,
  deposit: 0x5aa8ff,
};

interface RouteViz {
  group: THREE.Group;
  tube: THREE.Mesh;
  tubeMat: THREE.MeshBasicMaterial;
  tex: THREE.CanvasTexture;
  cones: THREE.InstancedMesh;
  coneMat: THREE.MeshBasicMaterial;
  curve: THREE.CatmullRomCurve3;
  length: number;
  sig: string;
}

const wp = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());

/**
 * Animated glowing paths showing where banknotes travel. Drawn on top of everything (depthTest off)
 * so the route stays readable with the doors closed; scrolling dashes + moving arrowheads.
 */
export class FlowArrows {
  private readonly routes = new Map<FlowRoute, RouteViz>();
  private readonly visible = new Set<FlowRoute>();
  private readonly root = new THREE.Group();
  private readonly coneGeo: THREE.ConeGeometry;
  private t = 0;
  private checkT = 0;

  constructor(
    private readonly model: AtmModel,
    scene: THREE.Scene,
  ) {
    this.root.name = 'flow-arrows';
    scene.add(this.root);
    this.coneGeo = new THREE.ConeGeometry(0.009, 0.024, 12);
  }

  private points(route: FlowRoute): THREE.Vector3[] {
    const a = this.model.anchors;
    const ex = getAtmExtras(this.model);
    const tp = a.transportPath.map(wp);
    const pp = a.presenterPath.map(wp);
    switch (route) {
      case 'dispense': {
        const pick = wp(a.cassettePick.C).add(new THREE.Vector3(0, -0.02, 0));
        const lift = pick.clone().add(new THREE.Vector3(0, 0.06, tp[0].z - pick.z));
        return [pick, lift, ...tp.filter((p) => p.y > lift.y + 0.05), ...pp, wp(a.shutterOutside).add(new THREE.Vector3(0, 0, 0.05))];
      }
      case 'reject': {
        const s = wp(a.sensor);
        const rej = ex ? ex.rejectPath.map(wp) : [];
        const e = wp(a.rejectEntry);
        return [s.clone().add(new THREE.Vector3(0, -0.08, 0)), s, new THREE.Vector3(s.x, s.y + 0.045, s.z - 0.012), ...rej, e, e.clone().add(new THREE.Vector3(0, -0.03, 0.02))];
      }
      case 'retract': {
        const out = wp(a.shutterOutside);
        const e = wp(a.retractEntry);
        const back = pp.slice().reverse().filter((p) => p.z > e.z + 0.03);
        return [out, ...back, new THREE.Vector3(e.x, pp[0].y + 0.004, e.z + 0.01), e.clone().add(new THREE.Vector3(0, -0.035, -0.005))];
      }
      case 'deposit': {
        const s = wp(a.depositSlot);
        const es = wp(a.escrow);
        const b = wp(a.depositBin);
        return [s.clone().add(new THREE.Vector3(0, 0, 0.08)), s, new THREE.Vector3(s.x, s.y - 0.005, (s.z + es.z) / 2), es, new THREE.Vector3(b.x, es.y - 0.01, b.z + 0.03), b, b.clone().add(new THREE.Vector3(0, -0.12, 0))];
      }
    }
  }

  private build(route: FlowRoute): RouteViz {
    const pts = this.points(route).filter((p, i, arr) => i === 0 || p.distanceTo(arr[i - 1]) > 0.004);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = curve.getLength();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 8;
    const c = canvas.getContext('2d')!;
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(0, 0, 64, 8);
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 36, 8);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, length / 0.035), 1);
    const tubeMat = new THREE.MeshBasicMaterial({ color: COLORS[route], map: tex, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(32, Math.round(length * 160)), 0.0035, 8, false), tubeMat);
    tube.renderOrder = 40;
    const coneMat = new THREE.MeshBasicMaterial({ color: COLORS[route], depthTest: false, depthWrite: false, toneMapped: false, transparent: true, opacity: 0.95 });
    const count = Math.max(2, Math.floor(length / 0.075));
    const cones = new THREE.InstancedMesh(this.coneGeo, coneMat, count);
    cones.renderOrder = 41;
    cones.frustumCulled = false;
    const group = new THREE.Group();
    group.name = `flow-${route}`;
    group.add(tube, cones);
    for (const o of [group, tube, cones]) {
      o.userData.noPick = true;
      o.raycast = () => {};
    }
    group.visible = false;
    this.root.add(group);
    return { group, tube, tubeMat, tex, cones, coneMat, curve, length, sig: this.signature(route) };
  }

  private signature(route: FlowRoute): string {
    return this.points(route)
      .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`)
      .join('|');
  }

  private disposeRoute(r: RouteViz): void {
    r.group.removeFromParent();
    r.tube.geometry.dispose();
    r.tubeMat.dispose();
    r.tex.dispose();
    r.coneMat.dispose();
    r.cones.dispose();
  }

  show(route: FlowRoute, on: boolean): void {
    if (on) {
      const old = this.routes.get(route);
      if (old) this.disposeRoute(old);
      const r = this.build(route);
      this.routes.set(route, r);
      r.group.visible = true;
      this.visible.add(route);
    } else {
      this.visible.delete(route);
      const r = this.routes.get(route);
      if (r) r.group.visible = false;
    }
  }

  isShown(route: FlowRoute): boolean {
    return this.visible.has(route);
  }

  update(dtSec: number): void {
    if (!this.visible.size) return;
    this.t += dtSec;
    this.checkT += dtSec;
    // rebuild if the doors / exploded view moved the anchors
    if (this.checkT > 0.5) {
      this.checkT = 0;
      for (const route of this.visible) {
        const r = this.routes.get(route);
        if (r && r.sig !== this.signature(route)) this.show(route, true);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3(1, 1, 1);
    for (const route of this.visible) {
      const r = this.routes.get(route);
      if (!r) continue;
      r.tex.offset.x = -this.t * 2.2;
      const n = r.cones.count;
      const speed = 0.22 / r.length;
      for (let i = 0; i < n; i++) {
        const u = (i / n + this.t * speed) % 1;
        const p = r.curve.getPointAt(u);
        q.setFromUnitVectors(up, r.curve.getTangentAt(u));
        const fade = Math.min(1, u * 12, (1 - u) * 12);
        s.setScalar(0.4 + 0.6 * fade);
        m.compose(p, q, s);
        r.cones.setMatrixAt(i, m);
      }
      r.cones.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const r of this.routes.values()) this.disposeRoute(r);
    this.routes.clear();
    this.coneGeo.dispose();
    this.root.removeFromParent();
  }
}
