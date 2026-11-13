import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraMode } from '../../app/types';
import type { Pose2, Rect } from '../../sim/world/types';
import { ROBOT } from '../../sim/robot/robotSpec';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Camera modes with smooth eased transitions. Orbit/pan/zoom stay available in every mode except the
 * robot-mounted first-person camera. "Tracking" modes (orbit, follow, exploded, lidar) carry the
 * camera along with the robot so the user's chosen orbit offset is preserved.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  mode: CameraMode = 'isometric';
  private bounds: Rect = { x: 0, y: 0, w: 10, h: 8 };
  /** Transitions are timed on the wall clock so they take the same time regardless of frame rate. */
  private transition: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; start: number; duration: number } | null = null;
  private readonly lastRobot = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly fpLook = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 40;
    this.controls.screenSpacePanning = true;
  }

  setBounds(b: Rect): void {
    this.bounds = b;
  }

  /** Desired camera position + target for a mode (world coordinates). */
  private desired(mode: CameraMode, robot: Pose2, dock: Pose2, outPos: THREE.Vector3, outTarget: THREE.Vector3): void {
    const b = this.bounds;
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitH = (Math.max(b.w / Math.max(0.3, this.camera.aspect), b.h) / 2 / Math.tan(fov / 2)) * 1.12;
    const rx = robot.x;
    const rz = robot.y;
    const fx = Math.cos(robot.theta);
    const fz = Math.sin(robot.theta);
    switch (mode) {
      case 'topDown':
        outTarget.set(cx, 0, cz);
        outPos.set(cx, fitH, cz + 0.001);
        break;
      case 'isometric': {
        const d = fitH * 0.95;
        outTarget.set(cx, 0, cz + b.h * 0.04);
        outPos.set(cx + d * 0.42, d * 0.78, cz + d * 0.62);
        break;
      }
      case 'orbit':
        outTarget.set(rx, 0.06, rz);
        outPos.set(rx + 0.7, 1.15, rz + 0.8);
        break;
      case 'follow':
        outTarget.set(rx + fx * 0.6, 0.05, rz + fz * 0.6);
        outPos.set(rx - fx * 1.1, 1.25, rz - fz * 1.1);
        break;
      case 'firstPerson':
        outPos.set(rx + fx * (ROBOT.radius + 0.01), ROBOT.bodyHeight - 0.012, rz + fz * (ROBOT.radius + 0.01));
        outTarget.set(rx + fx * 2, 0.05, rz + fz * 2);
        break;
      case 'lidar':
        outTarget.set(rx, 0, rz);
        outPos.set(rx + 0.01, 5.5, rz + 3.2);
        break;
      case 'dock': {
        const dfx = Math.cos(dock.theta);
        const dfz = Math.sin(dock.theta);
        const lx = -dfz;
        const lz = dfx;
        const tx = dock.x + dfx * 0.25;
        const tz = dock.y + dfz * 0.25;
        outTarget.set(tx, 0.2, tz);
        outPos.set(tx - dfx * 0.95 + lx * 0.55, 1.35, tz - dfz * 0.95 + lz * 0.55);
        break;
      }
      case 'exploded':
        outTarget.set(rx, 0.16, rz);
        outPos.set(rx + 0.78, 0.82, rz + 0.84);
        break;
      case 'cutaway': {
        const d = fitH * 0.7;
        outTarget.set(rx, 0.1, rz);
        outPos.set(rx + d * 0.35, d * 0.6, rz + d * 0.55);
        break;
      }
    }
  }

  setMode(mode: CameraMode, robot: Pose2, dock: Pose2, instant = false): void {
    this.mode = mode;
    this.lastRobot.set(robot.x, 0, robot.y);
    if (instant) {
      this.desired(mode, robot, dock, this.camera.position, this.controls.target);
      this.camera.lookAt(this.controls.target);
      this.transition = null;
      return;
    }
    this.transition = { fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), start: performance.now(), duration: 1.1 };
    this.controls.enabled = false;
  }

  focus(x: number, z: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    this.transition = { fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), start: performance.now(), duration: 0.8 };
    this.focusGoal = { target: new THREE.Vector3(x, 0, z), pos: new THREE.Vector3(x, 0, z).add(off) };
    this.controls.enabled = false;
  }
  private focusGoal: { target: THREE.Vector3; pos: THREE.Vector3 } | null = null;

  update(dt: number, robot: Pose2, dock: Pose2): void {
    const fp = this.mode === 'firstPerson';
    if (this.transition) {
      const tr = this.transition;
      const tt = Math.min(1, (performance.now() - tr.start) / 1000 / tr.duration);
      const k = ease(tt);
      if (this.focusGoal) {
        this.tmpPos.copy(this.focusGoal.pos);
        this.tmpTarget.copy(this.focusGoal.target);
      } else this.desired(this.mode, robot, dock, this.tmpPos, this.tmpTarget);
      this.camera.position.lerpVectors(tr.fromPos, this.tmpPos, k);
      this.controls.target.lerpVectors(tr.fromTarget, this.tmpTarget, k);
      this.camera.lookAt(this.controls.target);
      if (tt >= 1) {
        this.transition = null;
        this.focusGoal = null;
        this.controls.enabled = !fp;
      }
      this.lastRobot.set(robot.x, 0, robot.y);
      return;
    }
    if (fp) {
      this.desired('firstPerson', robot, dock, this.tmpPos, this.tmpTarget);
      this.camera.position.lerp(this.tmpPos, Math.min(1, dt * 20));
      this.fpLook.lerp(this.tmpTarget, Math.min(1, dt * 12));
      this.camera.lookAt(this.fpLook);
      this.controls.target.copy(this.fpLook);
      this.controls.enabled = false;
      this.lastRobot.set(robot.x, 0, robot.y);
      return;
    }
    this.controls.enabled = true;
    const tracking = this.mode === 'orbit' || this.mode === 'follow' || this.mode === 'exploded' || this.mode === 'lidar' || this.mode === 'cutaway';
    if (tracking) {
      const dx = robot.x - this.lastRobot.x;
      const dz = robot.y - this.lastRobot.z;
      if (this.mode === 'follow') {
        // Follow: stay behind the robot, softly.
        this.desired('follow', robot, dock, this.tmpPos, this.tmpTarget);
        this.camera.position.lerp(this.tmpPos, Math.min(1, dt * 2.5));
        this.controls.target.lerp(this.tmpTarget, Math.min(1, dt * 4));
      } else {
        this.camera.position.x += dx;
        this.camera.position.z += dz;
        this.controls.target.x += dx;
        this.controls.target.z += dz;
      }
    }
    this.lastRobot.set(robot.x, 0, robot.y);
    this.controls.update();
  }

  get inTransition(): boolean {
    return this.transition !== null;
  }

  dispose(): void {
    this.controls.dispose();
  }
}
