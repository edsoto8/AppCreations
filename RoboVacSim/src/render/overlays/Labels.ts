import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { EduTopic } from '../../app/types';
import './labels.css';
import type { Simulation } from '../../sim/Simulation';
import type { HouseLayout } from '../../sim/world/types';
import { DOCK, ROBOT } from '../../sim/robot/robotSpec';

interface Callout {
  /** Anchor in robot-local (x fwd, z left, y up) or dock-local coordinates. */
  frame: 'robot' | 'dock';
  at: [number, number, number];
  text: (sim: Simulation) => string;
}

const f2 = (v: number) => v.toFixed(2);

/** Live engineering callouts per education topic (simplified models — see ROBOTICS.md). */
const CALLOUTS: Record<EduTopic, Callout[]> = {
  differentialDrive: [
    { frame: 'robot', at: [0, 0.05, ROBOT.wheelBase / 2 + 0.03], text: (s) => `Left wheel v_L = ${f2(s.body.vl)} m/s` },
    { frame: 'robot', at: [0, 0.05, -ROBOT.wheelBase / 2 - 0.03], text: (s) => `Right wheel v_R = ${f2(s.body.vr)} m/s` },
    { frame: 'robot', at: [0.05, 0.16, 0], text: (s) => `v = (v_R+v_L)/2 = ${f2(s.body.v)} m/s · ω = (v_R−v_L)/L = ${f2(s.body.w)} rad/s` },
  ],
  lidar: [
    { frame: 'robot', at: [ROBOT.lidarOffsetX, 0.14, 0], text: (s) => `LiDAR ${s.cfg.lidar.spinHz} Hz · ${s.cfg.lidar.raysPerRevolution} rays/rev · range ${s.cfg.lidar.range} m · σ ${s.cfg.lidar.noise * 1000} mm` },
  ],
  occupancy: [{ frame: 'robot', at: [0, 0.16, 0], text: (s) => `Mapped ${s.map.occ.knownArea().toFixed(1)} m² · log-odds hit +${s.map.occ.params.lHit} / miss ${s.map.occ.params.lMiss}` }],
  astar: [{ frame: 'robot', at: [0, 0.16, 0], text: (s) => `A* target: ${s.ctrl.targetLabel} · replans ${s.nav.replans} · ${s.nav.lastEvent?.message ?? ''}` }],
  coverage: [{ frame: 'robot', at: [0, 0.16, 0], text: (s) => `Boustrophedon lane spacing ${s.cfg.navigation.laneSpacing} m · tasks left ${s.ctrl.mission?.tasks.length ?? 0}` }],
  cliff: [
    { frame: 'robot', at: [0.17, 0.02, 0.09], text: (s) => (s.body.cliffTriggered ? 'CLIFF DETECTED — motion refused' : 'IR cliff sensors: floor OK') },
    { frame: 'robot', at: [-0.13, 0.02, -0.12], text: (s) => `Cliff events: ${s.stats.cliffEvents}` },
  ],
  docking: [
    { frame: 'dock', at: [DOCK.towerFrontX, 0.32, 0], text: (s) => `IR beacon · dock: ${s.dock.phase}` },
    { frame: 'dock', at: [0.12, 0.04, 0.12], text: (s) => (s.dock.robotDocked ? `Contacts engaged · ${s.res.power.charge.toFixed(0)} W` : 'Charging contacts') },
  ],
  suction: [
    { frame: 'robot', at: [ROBOT.mainBrushX, 0.03, 0.15], text: (s) => `Main rollers · suction ${s.ctrl.act.suction ?? 'off'} (${s.res.power.suction.toFixed(0)} W)` },
    { frame: 'robot', at: [ROBOT.sideBrushX, 0.03, ROBOT.sideBrushZ - 0.05], text: () => 'Side brush sweeps edges into the intake' },
    { frame: 'robot', at: [-0.05, 0.12, 0.05], text: (s) => `Dustbin ${(s.res.binFill * 100).toFixed(0)}% (${s.res.dustbin.toFixed(1)} g)` },
  ],
  mopWash: [
    { frame: 'dock', at: [0.0, 0.08, 0.2], text: (s) => `Wash tray · phase ${s.dock.phase} ${(s.dock.phaseProgress * 100).toFixed(0)}%` },
    { frame: 'dock', at: [0.33, 0.55, 0.12], text: (s) => `Clean ${(s.dock.cleanTank / 1000).toFixed(2)} L · Dirty ${(s.dock.dirtyTank / 1000).toFixed(2)} L` },
  ],
};

function makeLabel(className: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = className;
  const o = new CSS2DObject(el);
  o.center.set(0.5, 1);
  return o;
}

/** Room labels and education callouts rendered as HTML via CSS2DRenderer (crisp text, no textures). */
export class Labels {
  readonly renderer = new CSS2DRenderer();
  readonly group = new THREE.Group();
  private readonly rooms = new THREE.Group();
  private readonly callouts = new THREE.Group();
  private topic: EduTopic | null = null;
  private items: Array<{ obj: CSS2DObject; c: Callout }> = [];
  private timer = 0;
  private readonly v = new THREE.Vector3();

  constructor(container: HTMLElement) {
    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.className = 'label-layer';
    container.appendChild(el);
    this.group.add(this.rooms, this.callouts);
  }

  syncRooms(layout: HouseLayout): void {
    for (const c of [...this.rooms.children]) {
      (c as CSS2DObject).element.remove();
      this.rooms.remove(c);
    }
    for (const r of layout.rooms) {
      // Label at the centre of the room's largest rect.
      const big = r.rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
      const o = makeLabel('room-label');
      o.element.textContent = r.name;
      o.position.set(big.x + big.w / 2, 0.05, big.y + big.h / 2);
      this.rooms.add(o);
    }
  }

  setRoomsVisible(v: boolean): void {
    this.rooms.visible = v;
    for (const c of this.rooms.children) (c as CSS2DObject).element.style.display = v ? '' : 'none';
  }

  setTopic(topic: EduTopic | null): void {
    if (topic === this.topic) return;
    this.topic = topic;
    for (const it of this.items) {
      it.obj.element.remove();
      this.callouts.remove(it.obj);
    }
    this.items = [];
    if (!topic) return;
    for (const c of CALLOUTS[topic]) {
      const obj = makeLabel('edu-callout');
      this.callouts.add(obj);
      this.items.push({ obj, c });
    }
  }

  update(sim: Simulation, robotRoot: THREE.Object3D, dockRoot: THREE.Object3D, dt: number): void {
    this.timer += dt;
    const refreshText = this.timer > 0.2;
    if (refreshText) this.timer = 0;
    for (const it of this.items) {
      const root = it.c.frame === 'robot' ? robotRoot : dockRoot;
      // local (x fwd, y up, z left) -> model local axes are the same; transform to world.
      this.v.set(it.c.at[0], it.c.at[1], it.c.at[2]);
      root.localToWorld(this.v);
      it.obj.position.copy(this.v);
      if (refreshText) it.obj.element.textContent = it.c.text(sim);
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h);
  }

  dispose(): void {
    this.setTopic(null);
    for (const c of [...this.rooms.children]) (c as CSS2DObject).element.remove();
    this.renderer.domElement.remove();
  }
}
