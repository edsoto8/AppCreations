import * as THREE from 'three';
import { TAU } from '../../sim/core/math';
import { ROBOT } from '../../sim/robot/robotSpec';
import type { Simulation } from '../../sim/Simulation';

/**
 * LiDAR point cloud (ring buffer, coloured by recency), live LiDAR rays for the current revolution,
 * the front structured-light cone, the right wall ToF beam and cliff-sensor indicators.
 * Visualisation is refreshed at a capped rate independent of the simulation step rate.
 */
export class SensorOverlay {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly pointPos: Float32Array;
  private readonly pointCol: Float32Array;
  private readonly rays: THREE.LineSegments;
  private readonly rayPos: Float32Array;
  private readonly cone: THREE.Mesh;
  private readonly wallBeam: THREE.Line;
  private readonly cliffDots: THREE.InstancedMesh;
  private readonly cliffColors: THREE.Color[] = [];
  private timer = 0;
  showPoints = true;
  showRays = true;
  showSensors = false;
  /** Max visual refresh rate (Hz) — expensive sensor visualisation is throttled. */
  rate = 20;
  private readonly m = new THREE.Matrix4();

  constructor(private sim: Simulation) {
    const n = sim.cfg.lidar.pointCloudSize;
    this.pointPos = new Float32Array(n * 3);
    this.pointCol = new Float32Array(n * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;

    const rays = sim.cfg.lidar.raysPerRevolution;
    this.rayPos = new Float32Array(rays * 2 * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rayPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rays = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#ff6b81', transparent: true, opacity: 0.1, depthWrite: false }));
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 4;

    const f = sim.front;
    const coneGeo = new THREE.CircleGeometry(f.range, 16, -f.halfFov, f.halfFov * 2);
    coneGeo.rotateX(-Math.PI / 2);
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#7cf2ff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    this.cone.renderOrder = 4;

    const wg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 0.1)]);
    this.wallBeam = new THREE.Line(wg, new THREE.LineBasicMaterial({ color: '#ffd166' }));
    this.wallBeam.frustumCulled = false;

    this.cliffDots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.012, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false }), ROBOT.cliffSensors.length);
    for (let k = 0; k < ROBOT.cliffSensors.length; k++) this.cliffColors.push(new THREE.Color('#38e07b'));
    this.cliffDots.frustumCulled = false;
    this.group.add(this.points, this.rays, this.cone, this.wallBeam, this.cliffDots);
    this.group.name = 'sensor-overlay';
  }

  update(dt: number, force = false): void {
    this.points.visible = this.showPoints;
    this.rays.visible = this.showRays;
    this.cone.visible = this.showSensors;
    this.wallBeam.visible = this.showSensors;
    this.cliffDots.visible = this.showSensors;
    this.timer += dt;
    if (!force && this.timer < 1 / this.rate) return;
    this.timer = 0;
    const sim = this.sim;
    const l = sim.lidar;
    const b = sim.body;
    const h = ROBOT.lidarHeight;
    if (this.showPoints) {
      const n = sim.cfg.lidar.pointCloudSize;
      for (let k = 0; k < n; k++) {
        const o = k * 3;
        if (k < l.cloudCount) {
          // age: 0 = newest
          const age = ((l.cloudHead - 1 - k + n) % n) / Math.max(1, l.cloudCount);
          this.pointPos[o] = l.cloud[k * 2];
          this.pointPos[o + 1] = h;
          this.pointPos[o + 2] = l.cloud[k * 2 + 1];
          const fresh = 1 - age;
          this.pointCol[o] = 1.0 * fresh + 0.15 * age;
          this.pointCol[o + 1] = 0.28 * fresh + 0.55 * age;
          this.pointCol[o + 2] = 0.42 * fresh + 0.75 * age;
        } else {
          this.pointPos[o] = 0;
          this.pointPos[o + 1] = -10;
          this.pointPos[o + 2] = 0;
        }
      }
      (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.showRays) {
      const n = l.scanRanges.length;
      const ox = b.x + Math.cos(b.theta) * ROBOT.lidarOffsetX;
      const oy = b.y + Math.sin(b.theta) * ROBOT.lidarOffsetX;
      for (let k = 0; k < n; k++) {
        const r = l.scanRanges[k];
        const o = k * 6;
        const a = b.theta + (k / n) * TAU;
        const range = Number.isNaN(r) ? 0 : r;
        this.rayPos[o] = ox;
        this.rayPos[o + 1] = h;
        this.rayPos[o + 2] = oy;
        this.rayPos[o + 3] = ox + Math.cos(a) * range;
        this.rayPos[o + 4] = h;
        this.rayPos[o + 5] = oy + Math.sin(a) * range;
      }
      (this.rays.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.showSensors) {
      const c = Math.cos(b.theta);
      const s = Math.sin(b.theta);
      this.cone.position.set(b.x + c * (ROBOT.radius - 0.02), 0.03, b.y + s * (ROBOT.radius - 0.02));
      this.cone.rotation.y = -b.theta;
      (this.cone.material as THREE.MeshBasicMaterial).color.set(sim.front.nearest < 0.3 ? '#ffb020' : '#7cf2ff');
      const a = b.theta - Math.PI / 2;
      const sx = b.x + Math.cos(a) * ROBOT.radius;
      const sy = b.y + Math.sin(a) * ROBOT.radius;
      const gap = Number.isFinite(sim.wall.side) ? sim.wall.side : sim.wall.range;
      const pos = this.wallBeam.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, sx, 0.04, sy);
      pos.setXYZ(1, sx + Math.cos(a) * gap, 0.04, sy + Math.sin(a) * gap);
      pos.needsUpdate = true;
      for (let k = 0; k < ROBOT.cliffSensors.length; k++) {
        const p = b.cliffSensorWorld(k, b.x, b.y, b.theta);
        this.m.makeTranslation(p.x, 0.003, p.y);
        this.cliffDots.setMatrixAt(k, this.m);
        const hot = b.cliffTriggered && b.cliffSensor === k;
        this.cliffDots.setColorAt(k, this.cliffColors[k].set(hot ? '#ff3b3b' : '#38e07b'));
      }
      this.cliffDots.instanceMatrix.needsUpdate = true;
      if (this.cliffDots.instanceColor) this.cliffDots.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const o of [this.points, this.rays, this.cone, this.wallBeam, this.cliffDots]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    this.cliffDots.dispose();
  }
}
