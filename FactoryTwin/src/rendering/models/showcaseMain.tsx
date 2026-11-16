import { StrictMode, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PCFShadowMap } from 'three';
import type { MachineState, Vec2, WorkerRole } from '../../simulation/types';
import { buildLayout } from '../../logistics/layout';
import { defaultConfig } from '../../scenarios/default';
import { FactoryEnvironment, FactoryLights, FactoryStaticEquipment } from '../environment';
import {
  AGV,
  ASSEMBLY_LIGHT_MOUNT,
  AssemblyMachine,
  ConveyorLine,
  Forklift,
  InfeedTable,
  InspectionGantry,
  KitTable,
  KittingRack,
  PACKAGING_LIGHT_MOUNT,
  PackagingMachine,
  Palletizer,
  PALLETIZER_PICK,
  RejectBin,
  RobotArm,
  StackLight,
  StorageRack,
  Truck,
  Worker,
  createAGVAnim,
  createAssemblyMachineAnim,
  createConveyorAnim,
  createForkliftAnim,
  createGantryAnim,
  createKitTableAnim,
  createPackagingAnim,
  createPalletizerAnim,
  createRobotAnim,
  createStackLightAnim,
  createTruckAnim,
  createWorkerAnim,
  solveRobotIK,
  type RobotAnim,
} from './index';

/**
 * Visual verification page (not part of the app). `showcase.html` renders every model in a grid
 * with demo animations; `?view=env` renders the full factory environment from the default
 * layout with every dynamic model placed, to check looks and draw calls.
 * `?cam=px,py,pz,tx,ty,tz` sets the camera. Here (and only here) anims run off the R3F clock.
 */

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'models';
const camParam = params.get('cam')?.split(',').map(Number);
/** `?still=1` renders on demand (a frame every 300 ms) so slow software-GL screenshots work. */
const still = params.has('still');
/** `?t=seconds` freezes the demo clock (deterministic screenshots). */
const fixedT = params.has('t') ? Number(params.get('t')) : null;

const STATES: MachineState[] = ['running', 'idle', 'starved', 'blocked', 'failed', 'maintenance', 'unstaffed', 'closed'];
const ROLES: WorkerRole[] = ['assembler', 'inspector', 'packer', 'driver', 'floater', 'technician'];

function tri(t: number): number {
  const f = t - Math.floor(t);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

function lerp3(a: readonly number[], b: readonly number[], t: number, out: [number, number, number]) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

/** Pick-and-place demo cycle for a robot. */
function robotCycle(t: number, a: RobotAnim, pick: readonly number[], place: readonly number[], carry: 1 | 2 | 3) {
  const T = 7;
  const f = (t % T) / T;
  const up = 0.45;
  const tgt: [number, number, number] = [0, 0, 0];
  const pickUp = [pick[0], pick[1] + up, pick[2]];
  const placeUp = [place[0], place[1] + up, place[2]];
  let holding = false;
  let grip = 1;
  if (f < 0.2) lerp3(placeUp, pickUp, f / 0.2, tgt);
  else if (f < 0.3) lerp3(pickUp, pick, (f - 0.2) / 0.1, tgt);
  else if (f < 0.35) {
    lerp3(pick, pick, 0, tgt);
    grip = 1 - (f - 0.3) / 0.05;
  } else if (f < 0.45) {
    lerp3(pick, pickUp, (f - 0.35) / 0.1, tgt);
    holding = true;
    grip = 0;
  } else if (f < 0.7) {
    lerp3(pickUp, placeUp, (f - 0.45) / 0.25, tgt);
    holding = true;
    grip = 0;
  } else if (f < 0.8) {
    lerp3(placeUp, place, (f - 0.7) / 0.1, tgt);
    holding = true;
    grip = 0;
  } else if (f < 0.85) {
    lerp3(place, place, 0, tgt);
    grip = (f - 0.8) / 0.05;
  } else lerp3(place, placeUp, (f - 0.85) / 0.15, tgt);
  solveRobotIK(tgt, a);
  a.grip = grip;
  a.carry = holding ? carry : 0;
}

function useAnims() {
  return useMemo(
    () => ({
      robot: createRobotAnim(),
      robot2: createRobotAnim(),
      machine: createAssemblyMachineAnim(),
      lights: STATES.map(() => createStackLightAnim()),
      machineLight: createStackLightAnim(),
      conveyor: createConveyorAnim(),
      conveyor2: createConveyorAnim(),
      gantry: createGantryAnim(),
      pack: createPackagingAnim(),
      packLight: createStackLightAnim(),
      pal: createPalletizerAnim(),
      agv: createAGVAnim(),
      agv2: createAGVAnim(),
      fork: createForkliftAnim(),
      fork2: createForkliftAnim(),
      workers: ROLES.map(() => createWorkerAnim()),
      workers2: ROLES.map(() => createWorkerAnim()),
      truck: createTruckAnim(),
      truck2: createTruckAnim(),
      kit: createKitTableAnim(),
    }),
    [],
  );
}
type Anims = ReturnType<typeof useAnims>;

function Driver({ a }: { a: Anims }) {
  useFrame(({ clock }) => {
    const t = fixedT ?? clock.elapsedTime;
    robotCycle(t, a.robot, [-1.6, 0.98, 0.9], [0.4, 1.0, 2.0], 1);
    robotCycle(t + 2, a.robot2, [1.8, 0.95, 0], [0, 1.0, -1.9], 3);
    a.machine.running = true;
    a.machine.progress = (t / 6) % 1;
    a.machine.product = 2;
    a.machineLight.state = 'running';
    a.lights.forEach((l, i) => {
      l.state = STATES[i];
      l.clock = t;
    });
    a.conveyor.beltPos = t * 0.4;
    a.conveyor.state = 'running';
    a.conveyor2.state = 'failed';
    a.gantry.scanning = (t % 5) < 3.5;
    a.gantry.progress = tri(t / 3.5);
    a.gantry.result = (t % 5) >= 3.5 ? (Math.floor(t / 5) % 2 === 0 ? 1 : 2) : 0;
    a.gantry.clock = t;
    a.pack.running = true;
    a.pack.hasCarton = true;
    a.pack.progress = (t / 8) % 1;
    a.packLight.state = 'blocked';
    a.packLight.clock = t;
    // palletizer: pick at the table, place on a build position
    const f = (t / 6) % 1;
    const pick = [PALLETIZER_PICK[0], PALLETIZER_PICK[1] + 0.24, 0];
    const place = [0, 0.144 + 0.48 + 0.24, 1.5];
    const hi = 2.2;
    if (f < 0.15) lerp3([place[0], hi, place[2]], [pick[0], hi, 0], f / 0.15, a.pal.target);
    else if (f < 0.3) lerp3([pick[0], hi, 0], pick, (f - 0.15) / 0.15, a.pal.target);
    else if (f < 0.45) lerp3(pick, [pick[0], hi, 0], (f - 0.3) / 0.15, a.pal.target);
    else if (f < 0.65) lerp3([pick[0], hi, 0], [place[0], hi, place[2]], (f - 0.45) / 0.2, a.pal.target);
    else if (f < 0.85) lerp3([place[0], hi, place[2]], place, (f - 0.65) / 0.2, a.pal.target);
    else lerp3(place, [place[0], hi, place[2]], (f - 0.85) / 0.15, a.pal.target);
    a.pal.carrying = f > 0.3 && f < 0.85;
    a.pal.grip = a.pal.carrying;
    a.agv.cargo = 4;
    a.agv.moving = true;
    a.agv.clock = t;
    a.agv2.cargo = 2;
    a.agv2.cargoKind = 1;
    a.agv2.failed = true;
    a.agv2.clock = t;
    a.fork.forkHeight = 1.4 + 1.3 * Math.sin(t * 0.6);
    a.fork.pallet = 24;
    a.fork.moving = true;
    a.fork.clock = t;
    a.fork2.forkHeight = 0.3;
    a.fork2.pallet = -1;
    a.fork2.failed = true;
    a.fork2.clock = t;
    a.workers.forEach((w) => {
      w.walking = true;
      w.stride = t * 1.3;
      w.clock = t;
    });
    a.workers2.forEach((w, i) => {
      w.working = i % 2 === 0;
      w.clock = t + i;
    });
    a.truck.doorOpen = 0.5 + 0.5 * Math.sin(t * 0.5);
    a.truck.pallets = 6;
    a.truck2.doorOpen = 1;
    a.truck2.pallets = 9;
    a.kit.totes = 3;
  });
  return null;
}

const L_POINTS: Vec2[] = [
  [9, -11],
  [14, -11],
  [14, -7],
  [17.5, -7],
];

function ModelsView() {
  const a = useAnims();
  return (
    <>
      <Driver a={a} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 60]} />
        <meshStandardMaterial color="#a9adb1" roughness={0.6} />
      </mesh>
      <gridHelper args={[80, 80, '#8c9196', '#9a9fa4']} position={[0, 0.002, 0]} />
      {/* row 1: cell + process machines */}
      <group position={[-15, 0, 0]}>
        <RobotArm anim={a.robot} />
        <KitTable anim={a.kit} position={[-1.6, 0, 0.9]} />
        <AssemblyMachine anim={a.machine} position={[0.4, 0, 3.4]} rotation={[0, Math.PI, 0]} />
      </group>
      <group position={[-8, 0, 0]}>
        <AssemblyMachine anim={a.machine} position={[0, 0, -1]} />
        <StackLight anim={a.machineLight} position={[ASSEMBLY_LIGHT_MOUNT[0], ASSEMBLY_LIGHT_MOUNT[1], ASSEMBLY_LIGHT_MOUNT[2] - 1]} />
        <RobotArm anim={a.robot2} position={[0, 0, 1.9]} />
      </group>
      <InspectionGantry anim={a.gantry} position={[-1, 0, 0]} />
      <group position={[7, 0, 0]}>
        <PackagingMachine anim={a.pack} />
        <StackLight anim={a.packLight} position={PACKAGING_LIGHT_MOUNT} />
      </group>
      <Palletizer anim={a.pal} position={[16, 0, 0]} />
      {/* row 2: vehicles, people, lights */}
      <AGV anim={a.agv} position={[-16, 0, 9]} />
      <AGV anim={a.agv2} position={[-14, 0, 9]} rotation={[0, 0.6, 0]} />
      <Forklift anim={a.fork} position={[-10, 0, 9]} />
      <Forklift anim={a.fork2} position={[-5.5, 0, 9]} rotation={[0, -0.5, 0]} />
      {ROLES.map((r, i) => (
        <Worker key={r} role={r} anim={a.workers[i]} position={[-1 + i * 0.9, 0, 8.5]} />
      ))}
      {ROLES.map((r, i) => (
        <Worker key={r} role={r} anim={a.workers2[i]} position={[-1 + i * 0.9, 0, 10]} rotation={[0, (i - 2.5) * 0.6, 0]} />
      ))}
      {STATES.map((s, i) => (
        <group key={s} position={[6 + i * 0.6, 0, 9]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[0.2, 1, 0.2]} />
            <meshStandardMaterial color="#5d656d" />
          </mesh>
          <StackLight anim={a.lights[i]} position={[0, 1, 0]} />
        </group>
      ))}
      {/* row 3: trucks */}
      <Truck anim={a.truck} kind="inbound" label="NORDIC COMPONENTS" position={[2, 0, 16]} />
      <Truck anim={a.truck2} kind="outbound" label="SWIFTLINE FREIGHT" position={[18, 0, 16]} rotation={[0, Math.PI, 0]} />
      {/* row 4: storage + handling */}
      <StorageRack length={10} depth={1.3} levels={4} bays={5} loads={13} position={[-12, 0, -10]} />
      <KittingRack position={[-4, 0, -10]} />
      <InfeedTable size={[1.8, 3.4]} position={[0, 0, -10]} />
      <RejectBin position={[4, 0, -10]} />
      <ConveyorLine points={L_POINTS} anim={a.conveyor} />
      <ConveyorLine points={[[9, -14], [17.5, -14]]} anim={a.conveyor2} />
    </>
  );
}

function EnvView() {
  const layout = useMemo(() => buildLayout(defaultConfig()), []);
  const a = useAnims();
  const cellAnims = useMemo(() => layout.cells.map(() => ({ robot: createRobotAnim(), machine: createAssemblyMachineAnim(), light: createStackLightAnim() })), [layout]);
  const convAnims = useMemo(() => layout.conveyors.map(() => createConveyorAnim()), [layout]);
  const workers = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ role: ROLES[i % ROLES.length], anim: createWorkerAnim() })), []);
  const trucks = useMemo(() => [createTruckAnim(), createTruckAnim(), createTruckAnim(), createTruckAnim()], []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    cellAnims.forEach((c, i) => {
      robotCycle(t + i * 2, c.robot, [-1.9, 0.98, 0], [0, 1.0, -1.7], 3);
      c.machine.running = i !== 1;
      c.machine.progress = ((t + i) / 6) % 1;
      c.machine.product = 2;
      c.light.state = i === 1 ? 'failed' : 'running';
      c.light.clock = t;
    });
    convAnims.forEach((c, i) => {
      c.beltPos = t * 0.4;
      c.state = i === 2 ? 'failed' : 'running';
    });
    workers.forEach((w, i) => {
      w.anim.walking = i % 3 === 0;
      w.anim.working = i % 3 === 1;
      w.anim.stride = t * 1.3;
      w.anim.clock = t;
    });
    trucks.forEach((tr, i) => {
      tr.doorOpen = 1;
      tr.pallets = 4 + i;
    });
  });
  const pal = layout.palletizer;
  return (
    <>
      <Driver a={a} />
      <FactoryEnvironment layout={layout} />
      <FactoryStaticEquipment layout={layout} />
      {layout.cells.map((c, i) => (
        <group key={i}>
          <RobotArm anim={cellAnims[i].robot} position={[c.robot[0], 0, c.robot[1]]} />
          <group position={[c.machine[0], 0, c.machine[1]]}>
            <AssemblyMachine anim={cellAnims[i].machine} />
            <StackLight anim={cellAnims[i].light} position={ASSEMBLY_LIGHT_MOUNT} />
          </group>
        </group>
      ))}
      {layout.conveyors.map((c, i) => (
        <ConveyorLine key={c.id} points={c.points} anim={convAnims[i]} />
      ))}
      {layout.inspection.map((s) => (
        <group key={s.index} position={[s.pos[0], 0, s.pos[1]]}>
          <InspectionGantry anim={a.gantry} />
          <StackLight anim={a.lights[s.index]} position={[-1.15, 2.4, -0.75]} />
        </group>
      ))}
      <group position={[layout.packaging.center[0], 0, layout.packaging.center[1]]}>
        <PackagingMachine anim={a.pack} />
        <StackLight anim={a.packLight} position={PACKAGING_LIGHT_MOUNT} />
      </group>
      <group position={[pal.center[0], 0, pal.center[1]]}>
        <Palletizer anim={a.pal} positions={pal.positions.map((p) => p[1] - pal.center[1])} />
        <StackLight anim={a.lights[0]} position={[-2.6, 2.0, 2.9]} />
      </group>
      <AGV anim={a.agv} position={[-20, 0, 6]} rotation={[0, -Math.PI / 2, 0]} />
      <AGV anim={a.agv2} position={[layout.agvParking[1].pos[0], 0, layout.agvParking[1].pos[1]]} />
      <Forklift anim={a.fork} position={[34, 0, 12]} rotation={[0, Math.PI / 2, 0]} />
      {workers.map((w, i) => (
        <Worker key={i} role={w.role} anim={w.anim} position={[-30 + i * 6, 0, 22 + (i % 2) * 1.2]} rotation={[0, (i % 4) * 1.4, 0]} />
      ))}
      {layout.receivingBays.map((b, i) => (
        <Truck key={`r${i}`} kind="inbound" label="NORDIC COMPONENTS" anim={trucks[i]} position={[b.door[0] - 0.4, 0, b.door[1]]} />
      ))}
      {layout.shippingBays.map((b, i) => (
        <Truck key={`s${i}`} kind="outbound" label="SWIFTLINE FREIGHT" anim={trucks[2 + i]} position={[b.door[0] + 0.4, 0, b.door[1]]} rotation={[0, Math.PI, 0]} />
      ))}
    </>
  );
}

function StillTicker() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      invalidate();
      if (++n > 6) clearInterval(id);
    }, 1500);
    return () => clearInterval(id);
  }, [invalidate]);
  return null;
}

function StatsProbe() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const id = setInterval(() => {
      const r = gl.info.render;
      const text = `draw calls ${r.calls} · triangles ${(r.triangles / 1000).toFixed(0)}k · geometries ${gl.info.memory.geometries} · textures ${gl.info.memory.textures}`;
      const el = document.getElementById('stats');
      if (el) el.textContent = text;
      (window as unknown as { __stats: unknown }).__stats = { calls: r.calls, triangles: r.triangles };
    }, 500);
    return () => clearInterval(id);
  }, [gl]);
  return null;
}

function CameraRig() {
  const ref = useRef<{ target: { set(x: number, y: number, z: number): void }; update(): void } | null>(null);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const def = view === 'env' ? [0, 75, 70, 0, 0, 2] : [6, 24, 34, 0, 0, 1];
    const c = camParam && camParam.length === 6 ? camParam : def;
    camera.position.set(c[0], c[1], c[2]);
    ref.current?.target.set(c[3], c[4], c[5]);
    ref.current?.update();
  }, [camera]);
  return <OrbitControls ref={ref as never} makeDefault />;
}

function App() {
  return (
    <>
      <Canvas frameloop={still ? 'demand' : 'always'} shadows={{ type: PCFShadowMap }} dpr={[1, 1.5]} camera={{ fov: 45, near: 0.1, far: 600 }} gl={{ antialias: true }}>
        <color attach="background" args={[view === 'env' ? '#aebfcc' : '#c9d3dc']} />
        <fog attach="fog" args={[view === 'env' ? '#aebfcc' : '#c9d3dc', 120, 320]} />
        {view === 'env' ? (
          <FactoryLights />
        ) : (
          <FactoryLights bounds={{ x0: -22, x1: 24, z0: -16, z1: 22, height: 6 }} />
        )}
        {view === 'env' ? <EnvView /> : <ModelsView />}
        <CameraRig />
        <StatsProbe />
        {still && <StillTicker />}
      </Canvas>
      <div
        id="stats"
        style={{ position: 'fixed', left: 8, top: 8, padding: '4px 8px', background: 'rgba(0,0,0,.55)', color: '#fff', font: '12px monospace', borderRadius: 4 }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
