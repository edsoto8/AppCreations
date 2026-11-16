import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useUi } from '../store';
import { runtime } from './runtime';
import { entityWorldPos } from './entityPosition';
import type { P3 } from './positions';

const HOME_POS = new Vector3(-38, 42, 52);
const HOME_TARGET = new Vector3(2, 0, 2);
const TOP_POS = new Vector3(0, 105, 0.01);

/**
 * Orbit / pan / zoom with smooth transitions to: overview, top-down, focus on the selection,
 * and follow (product, worker or vehicle).
 */
export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const mode = useUi((s) => s.cameraMode);
  const nonce = useUi((s) => s.cameraNonce);
  const selection = useUi((s) => s.selection);
  const goal = useRef({ pos: new Vector3(), target: new Vector3(), active: false });
  const followOffset = useRef(new Vector3(7, 7, 9));
  const p3 = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });

  useEffect(() => {
    camera.position.copy(HOME_POS);
  }, [camera]);

  useEffect(() => {
    const g = goal.current;
    const rt = runtime.current;
    if (mode === 'top') {
      g.pos.copy(TOP_POS);
      g.target.set(0, 0, 0);
      g.active = true;
    } else if (mode === 'orbit') {
      g.pos.copy(HOME_POS);
      g.target.copy(HOME_TARGET);
      g.active = true;
    } else if ((mode === 'focus' || mode === 'follow') && selection && rt) {
      if (entityWorldPos(selection, rt, p3.current)) {
        const p = p3.current;
        g.target.set(p.x, p.y, p.z);
        const dist = selection.kind === 'product' ? 5 : selection.kind === 'station' || selection.kind === 'storage' ? 11 : 8;
        followOffset.current.set(dist * 0.6, dist * 0.65, dist * 0.8);
        g.pos.copy(g.target).add(followOffset.current);
        g.active = true;
      }
    }
  }, [mode, nonce, selection]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const g = goal.current;
    const k = 1 - Math.exp(-dt * 4);
    const rt = runtime.current;
    if (mode === 'follow' && selection && rt) {
      if (entityWorldPos(selection, rt, p3.current)) {
        const p = p3.current;
        g.target.set(p.x, p.y, p.z);
        if (!g.active) {
          // keep the user's orbit offset while following
          followOffset.current.copy(camera.position).sub(c.target);
        }
        const desiredPos = g.target.clone().add(followOffset.current);
        c.target.lerp(g.target, g.active ? k : 1 - Math.exp(-dt * 10));
        camera.position.lerp(desiredPos, g.active ? k : 1 - Math.exp(-dt * 10));
        if (g.active && camera.position.distanceTo(desiredPos) < 0.2) g.active = false;
        c.update();
        return;
      }
    }
    if (g.active) {
      c.target.lerp(g.target, k);
      camera.position.lerp(g.pos, k);
      if (camera.position.distanceTo(g.pos) < 0.05 && c.target.distanceTo(g.target) < 0.05) g.active = false;
      c.update();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={HOME_TARGET}
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={2}
      maxDistance={170}
      onStart={() => {
        if (mode !== 'follow') goal.current.active = false;
      }}
    />
  );
}
