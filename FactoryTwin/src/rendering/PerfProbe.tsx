import { useFrame, useThree } from '@react-three/fiber';
import { perfStats } from './perfStats';

/** Collects fps / draw calls / triangles into a plain object read by the DOM overlay. */
export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  useFrame((_, dt) => {
    perfStats.frames++;
    perfStats.acc += dt;
    if (perfStats.acc >= 0.5) {
      perfStats.fps = perfStats.frames / perfStats.acc;
      perfStats.frames = 0;
      perfStats.acc = 0;
    }
    perfStats.calls = gl.info.render.calls;
    perfStats.triangles = gl.info.render.triangles;
    perfStats.geometries = gl.info.memory.geometries;
    perfStats.textures = gl.info.memory.textures;
  });
  return null;
}
