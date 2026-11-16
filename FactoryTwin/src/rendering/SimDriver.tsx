import { useFrame } from '@react-three/fiber';
import { runtime } from './runtime';

/**
 * Advances the simulation once per frame (before any renderer reads the snapshot) and refreshes
 * the snapshot index. Runs at a negative priority so it executes first and R3F keeps rendering.
 */
export function SimDriver() {
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    rt.playback.frame(dt, rt.host);
    rt.index.update(rt.host.snapshot);
  }, -10);
  return null;
}
