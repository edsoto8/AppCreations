import { Canvas } from '@react-three/fiber';
import { useUi } from '../store';
import { runtime } from './runtime';
import { SimDriver } from './SimDriver';
import { PerfProbe } from './PerfProbe';
import { CameraRig } from './CameraRig';
import { FactoryEnvironment, FactoryLights } from './environment';
import { StationsLayer } from './scene/StationsLayer';
import { ConveyorsLayer } from './scene/ConveyorsLayer';
import { VehiclesLayer } from './scene/VehiclesLayer';
import { WorkersLayer } from './scene/WorkersLayer';
import { PalletsLayer, ProductsLayer } from './scene/ProductsLayer';
import { TrucksLayer } from './scene/TrucksLayer';
import { StorageLayer } from './scene/StorageLayer';
import { SelectionMarker } from './scene/SelectionMarker';

/** The 3D view. Remounted (keyed by runtime generation) whenever a scenario is loaded. */
export function FactoryCanvas() {
  const rt = runtime.current;
  if (!rt) return null;
  const layout = rt.layout;
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      camera={{ fov: 42, near: 0.3, far: 700, position: [-38, 42, 52] }}
      gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      onPointerMissed={() => useUi.getState().select(null)}
      data-testid="canvas"
    >
      <color attach="background" args={['#0d141d']} />
      <fog attach="fog" args={['#0d141d', 140, 320]} />
      <SimDriver />
      <PerfProbe />
      <FactoryLights />
      <FactoryEnvironment layout={layout} />
      <StorageLayer layout={layout} />
      <ConveyorsLayer layout={layout} />
      <StationsLayer layout={layout} />
      <VehiclesLayer layout={layout} />
      <WorkersLayer />
      <ProductsLayer layout={layout} />
      <PalletsLayer layout={layout} />
      <TrucksLayer layout={layout} />
      <SelectionMarker />
      <CameraRig />
    </Canvas>
  );
}
