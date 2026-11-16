import { useEffect, useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera, PMREMGenerator, Vector3, type DirectionalLight } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface ShadowBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Tallest object to include (m). */
  height?: number;
}

export interface FactoryLightsProps {
  /** Floor area the shadow camera must cover (default: the factory floor plus truck apron). */
  bounds?: ShadowBounds;
  shadowMapSize?: number;
  /** Strength of the procedural (RoomEnvironment) reflections on PBR materials. */
  envIntensity?: number;
  /** Set false to skip the procedural environment map. */
  environment?: boolean;
}

const SUN_DIR = new Vector3(0.42, 1, 0.55).normalize();

/**
 * Factory lighting: hemisphere fill, ONE shadow-casting directional "sun/high-bay" light whose
 * orthographic shadow camera is fitted to `bounds`, two non-shadow fills, and a procedural
 * RoomEnvironment reflection map (no network). Shadow map 2048 by default.
 */
export function FactoryLights({
  bounds = { x0: -64, z0: -34, x1: 64, z1: 34, height: 8 },
  shadowMapSize = 2048,
  envIntensity = 0.45,
  environment = true,
}: FactoryLightsProps) {
  const sun = useRef<DirectionalLight>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cz = (bounds.z0 + bounds.z1) / 2;
    const target = new Vector3(cx, 0, cz);
    const pos = target.clone().addScaledVector(SUN_DIR, 120);
    l.position.copy(pos);
    l.target.position.copy(target);
    l.target.updateMatrixWorld();
    // fit the orthographic shadow frustum to the floor box in light space
    const cam = new OrthographicCamera();
    cam.position.copy(pos);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const v = new Vector3();
    const h = bounds.height ?? 8;
    for (const x of [bounds.x0, bounds.x1])
      for (const z of [bounds.z0, bounds.z1])
        for (const y of [0, h]) {
          v.set(x, y, z).applyMatrix4(inv);
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
          minZ = Math.min(minZ, v.z);
          maxZ = Math.max(maxZ, v.z);
        }
    const sc = l.shadow.camera;
    sc.left = minX - 1;
    sc.right = maxX + 1;
    sc.bottom = minY - 1;
    sc.top = maxY + 1;
    sc.near = Math.max(0.5, -maxZ - 5);
    sc.far = -minZ + 5;
    sc.updateProjectionMatrix();
    l.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.03;
    l.shadow.map?.dispose();
    l.shadow.map = null;
    l.shadow.needsUpdate = true;
  }, [bounds.x0, bounds.x1, bounds.z0, bounds.z1, bounds.height, shadowMapSize]);

  useEffect(() => {
    if (!environment) return;
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    const prev = scene.environment;
    const prevI = scene.environmentIntensity;
    scene.environment = rt.texture;
    scene.environmentIntensity = envIntensity;
    room.traverse((o) => {
      const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      m.geometry?.dispose();
      m.material?.dispose();
    });
    pmrem.dispose();
    return () => {
      scene.environment = prev;
      scene.environmentIntensity = prevI;
      rt.dispose();
    };
  }, [gl, scene, environment, envIntensity]);

  return (
    <>
      <hemisphereLight args={['#e4edf5', '#5e5548', 0.85]} />
      <directionalLight ref={sun} color="#fff4e2" intensity={2.2} castShadow />
      <directionalLight color="#cfe0ff" intensity={0.45} position={[-40, 30, -30]} />
      <directionalLight color="#ffe9d0" intensity={0.25} position={[30, 20, -50]} />
    </>
  );
}
