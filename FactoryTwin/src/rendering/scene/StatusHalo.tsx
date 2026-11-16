import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshBasicMaterial, type Mesh } from 'three';
import type { MachineState } from '../../simulation/types';
import { runtime } from '../runtime';
import { STATE_COLORS } from '../../components/Legend';

/** Shared materials per machine state (no per-frame allocation). */
const MATS: Record<string, MeshBasicMaterial> = Object.fromEntries(
  Object.entries(STATE_COLORS).map(([k, c]) => [k, new MeshBasicMaterial({ color: c, transparent: true, opacity: 0.32, depthWrite: false })]),
);

/**
 * Floor halo under a station coloured by its simulated state, so status reads from the overview.
 * Failed stations pulse (on sim render time, so a paused simulation stops pulsing).
 */
export function StatusHalo({ id, position, size }: { id: string; position: [number, number]; size: [number, number] }) {
  const ref = useRef<Mesh>(null);
  useFrame(() => {
    const rt = runtime.current;
    const st = rt?.index.stations.get(id);
    const m = ref.current;
    if (!rt || !st || !m) return;
    const state: MachineState = st.state;
    m.material = MATS[state] ?? MATS.closed;
    const pulse = state === 'failed' ? 1 + 0.06 * Math.sin(rt.playback.renderTime * 4) : 1;
    m.scale.set(size[0] * pulse, size[1] * pulse, 1);
  });
  return (
    <mesh ref={ref} position={[position[0], 0.025, position[1]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
