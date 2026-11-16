import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { useUi } from '../../store';
import { runtime } from '../runtime';
import { entityWorldPos } from '../entityPosition';
import type { P3 } from '../positions';

const SIZE: Record<string, number> = { station: 2.6, conveyor: 3.2, vehicle: 1.3, worker: 0.7, product: 0.45, pallet: 1.0, storage: 5.5, order: 1, };

/** A pulsing floor ring + vertical beam on the selected entity, tracking it every frame. */
export function SelectionMarker() {
  const g = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const p = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  const selection = useUi((s) => s.selection);
  useFrame(({ clock }) => {
    const rt = runtime.current;
    if (!g.current) return;
    if (!rt || !selection || !entityWorldPos(selection, rt, p.current)) {
      g.current.visible = false;
      return;
    }
    g.current.visible = true;
    const r = SIZE[selection.kind] ?? 1;
    g.current.position.set(p.current.x, 0, p.current.z);
    const pulse = 1 + 0.08 * Math.sin(clock.elapsedTime * 4);
    ring.current!.scale.set(r * pulse, r * pulse, 1);
    const y = selection.kind === 'product' ? p.current.y : 0.03;
    ring.current!.position.y = y + 0.02;
    beam.current!.scale.set(r * 0.06 + 0.02, 6, r * 0.06 + 0.02);
    beam.current!.position.y = 3 + y;
    (beam.current!.material as MeshBasicMaterial).opacity = 0.25 + 0.1 * Math.sin(clock.elapsedTime * 4);
  });
  return (
    <group ref={g} visible={false}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10} raycast={() => null}>
        <ringGeometry args={[0.92, 1, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.95} depthTest={false} />
      </mesh>
      <mesh ref={beam} renderOrder={10} raycast={() => null}>
        <cylinderGeometry args={[1, 1, 1, 12, 1, true]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.3} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
