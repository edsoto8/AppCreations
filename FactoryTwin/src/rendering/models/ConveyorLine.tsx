import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { Euler, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3, type BufferAttribute, type InstancedMesh, type Mesh } from 'three';
import type { Vec2 } from '../../simulation/types';
import type { ConveyorAnim } from './anims';
import { Parts, unitCylinderGeometry, type V3 } from './geometries';
import { PALETTE, aluminiumMat, lampMats, metalMat } from './materials';
import { BELT_TILE, beltTexture } from './textures';

export type ConveyorLineProps = Omit<ThreeElements['group'], 'position' | 'rotation'> & {
  points: Vec2[];
  width?: number;
  height?: number;
  anim: ConveyorAnim;
};

interface Built {
  frame: ReturnType<Parts['build']>;
  belt: ReturnType<Parts['build']>;
  rollers: Matrix4[];
  lamp: V3;
}

const AL = PALETTE.aluminium;

function build(points: Vec2[], w: number, h: number): Built {
  const frame = new Parts();
  const belt = new Parts();
  const rollers: Matrix4[] = [];
  const n = points.length;
  let dist = 0;
  let lamp: V3 = [0, h, 0];
  const e = new Euler(0, 0, 0, 'YXZ');
  const q = new Quaternion();
  const addRoller = (pos: V3, yaw: number, r: number) => {
    e.set(Math.PI / 2, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    rollers.push(new Matrix4().compose(new Vector3(pos[0], pos[1], pos[2]), q, new Vector3(r, w + 0.02, r)));
  };

  for (let i = 0; i < n - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const yaw = Math.atan2(-uz, ux);
    const L = (t: number, y: number, qq: number): V3 => [ax + ux * t - uz * qq, y, az + uz * t + ux * qq];
    const first = i === 0;
    const last = i === n - 2;
    const s0 = first ? 0 : w / 2;
    const s1r = last ? len : len - w / 2;
    const s1b = last ? len : len + w / 2;
    const rl = s1r - s0;
    const bl = s1b - s0;

    // belt surface (scrolling texture, UV u in tiles of path distance)
    const plane = new PlaneGeometry(bl, w);
    const uv = plane.attributes.uv as BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (dist + s0 + uv.getX(k) * bl) / BELT_TILE);
    plane.rotateX(-Math.PI / 2);
    belt.add(plane, '#fff', L(s0 + bl / 2, h + 0.002, 0), [0, yaw, 0]);

    // belt body + side profiles + guide rails
    frame.box(bl, 0.05, w, '#202326', L(s0 + bl / 2, h - 0.026, 0), [0, yaw, 0], 0.005);
    for (const side of [-1, 1]) {
      const qq = side * (w / 2 + 0.024);
      frame.box(rl, 0.13, 0.045, AL, L(s0 + rl / 2, h - 0.045, qq), [0, yaw, 0], 0.008);
      frame.box(rl, 0.012, 0.05, '#8c949c', L(s0 + rl / 2, h + 0.022, qq), [0, yaw, 0], 0.002);
      frame.cyl(0.011, 0.011, rl, '#d0d5da', L(s0 + rl / 2, h + 0.075, side * (w / 2 - 0.005)), [0, yaw, -Math.PI / 2], 8);
      const nb = Math.max(2, Math.ceil(rl / 1.2) + 1);
      for (let k = 0; k < nb; k++) {
        const t = s0 + 0.08 + (k * (rl - 0.16)) / (nb - 1);
        frame.box(0.03, 0.07, 0.03, '#5d656d', L(t, h + 0.045, side * (w / 2 + 0.01)), [0, yaw, 0], 0.004);
      }
    }
    // legs
    const nl = Math.max(2, Math.ceil(rl / 1.6) + 1);
    const legH = h - 0.11;
    for (let k = 0; k < nl; k++) {
      const t = s0 + 0.12 + (k * (rl - 0.24)) / (nl - 1);
      for (const side of [-1, 1]) {
        frame.box(0.05, legH, 0.05, AL, L(t, legH / 2, side * (w / 2 + 0.02)), [0, yaw, 0], 0.008);
        frame.box(0.1, 0.02, 0.1, '#25282c', L(t, 0.01, side * (w / 2 + 0.02)), [0, yaw, 0], 0.005);
      }
      frame.box(0.04, 0.04, w + 0.04, AL, L(t, 0.28, 0), [0, yaw, 0], 0.006);
    }
    // return rollers underneath + end drums
    const nr = Math.max(1, Math.floor(rl / 1.0));
    for (let k = 0; k < nr; k++) addRoller(L(s0 + ((k + 0.5) * rl) / nr, h - 0.2, 0), yaw, 0.028);
    if (first) addRoller(L(0.05, h - 0.052, 0), yaw, 0.05);
    if (last) {
      addRoller(L(len - 0.05, h - 0.052, 0), yaw, 0.05);
      // drive motor + gearbox on the right-hand side of the head end
      const mq = -(w / 2 + 0.2);
      frame.box(0.2, 0.2, 0.14, '#6b747d', L(len - 0.14, h - 0.1, -(w / 2 + 0.09)), [0, yaw, 0], 0.02);
      frame.cyl(0.085, 0.085, 0.24, PALETTE.machineBlue, L(len - 0.14, h - 0.12, mq - 0.05), [Math.PI / 2, yaw, 0], 18);
      frame.cyl(0.07, 0.07, 0.03, '#25282c', L(len - 0.14, h - 0.12, mq - 0.185), [Math.PI / 2, yaw, 0], 18);
      frame.box(0.08, 0.06, 0.08, '#30353b', L(len - 0.14, h + 0.02, -(w / 2 + 0.09)), [0, yaw, 0], 0.01);
      lamp = L(len - 0.14, h + 0.075, -(w / 2 + 0.09));
    }
    // corner: close the two outer edges of the corner square
    if (!last) {
      const [cx, cz] = points[i + 1];
      const [nx, nz] = points[i + 2];
      const ol = Math.hypot(nx - cx, nz - cz);
      const vx = (nx - cx) / ol;
      const vz = (nz - cz) / ol;
      const o = w / 2 + 0.024;
      const yawOut = Math.atan2(-vz, vx);
      frame.box(0.045, 0.13, w + 0.095, AL, [cx + ux * o, h - 0.045, cz + uz * o], [0, yaw, 0], 0.008);
      frame.box(0.045, 0.13, w + 0.095, AL, [cx - vx * o, h - 0.045, cz - vz * o], [0, yawOut, 0], 0.008);
      frame.box(0.05, legH, 0.05, AL, [cx + ux * o - vx * o, legH / 2, cz + uz * o - vz * o], undefined, 0.008);
    }
    dist += len;
  }
  return { frame: frame.build(), belt: belt.build(), rollers, lamp };
}

/**
 * Belt conveyor along a world-space polyline (x,z) with 90-degree turns. Placed in WORLD
 * coordinates: do not give it a position/rotation. Belt texture scrolls by anim.beltPos metres.
 * Draw calls: 4 (+2 shadow). A lamp on the drive motor shows green (running) / red (failed).
 */
export function ConveyorLine({ points, width = 0.6, height = 0.85, anim, ...props }: ConveyorLineProps) {
  const key = JSON.stringify(points);
  const built = useMemo(() => build(points, width, height), [key, width, height]);
  const mat = useMemo(() => {
    const map = beltTexture().clone();
    map.needsUpdate = true;
    return new MeshStandardMaterial({ map, roughness: 0.75, metalness: 0 });
  }, []);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  useEffect(
    () => () => {
      built.frame.dispose();
      built.belt.dispose();
    },
    [built],
  );
  const rollers = useRef<InstancedMesh>(null);
  const lamp = useRef<Mesh>(null);

  useLayoutEffect(() => {
    const im = rollers.current;
    if (!im) return;
    built.rollers.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = built.rollers.length;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [built]);

  useFrame(() => {
    const map = mat.map;
    if (map) {
      const o = -anim.beltPos / BELT_TILE;
      map.offset.x = o - Math.floor(o);
    }
    const l = lamp.current;
    if (l) {
      const m = anim.state === 'failed' ? lampMats.red : anim.state === 'running' ? lampMats.green : lampMats.off;
      if (l.material !== m) l.material = m;
    }
  });

  return (
    <group {...props}>
      <mesh geometry={built.frame} material={metalMat} castShadow receiveShadow />
      <mesh geometry={built.belt} material={mat} receiveShadow />
      <instancedMesh
        key={built.rollers.length}
        ref={rollers}
        args={[unitCylinderGeometry, aluminiumMat, Math.max(1, built.rollers.length)]}
        frustumCulled={false}
      />
      <mesh ref={lamp} position={built.lamp as [number, number, number]} material={lampMats.off}>
        <sphereGeometry args={[0.035, 12, 8]} />
      </mesh>
    </group>
  );
}
