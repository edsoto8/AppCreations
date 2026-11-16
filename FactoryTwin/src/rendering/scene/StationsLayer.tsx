import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { FactoryLayout } from '../../logistics/layout';
import { runtime } from '../runtime';
import { fixturePos, kitTableSlot, productPose, progress, type P3 } from '../positions';
import {
  ASSEMBLY_LIGHT_MOUNT,
  AssemblyMachine,
  InspectionGantry,
  PackagingMachine,
  Palletizer,
  PALLETIZER_PICK,
  PACKAGING_LIGHT_MOUNT,
  RobotArm,
  StackLight,
  createAssemblyMachineAnim,
  createGantryAnim,
  createPackagingAnim,
  createPalletizerAnim,
  createRobotAnim,
  createStackLightAnim,
  solveRobotIK,
  cartonStackOffsets,
  type RobotAnim,
} from '../models';
import { pickHandlers } from './pick';

const scratch: number[] = [];
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

function stationLabel(id: string): string {
  const s = runtime.current?.index.stations.get(id);
  if (!s) return id;
  return `${s.name} — ${s.state}\nutilisation ${(s.utilization * 100).toFixed(0)}% · produced ${s.produced} · queue ${s.queue}`;
}

/** One assembly cell: robot arm + assembly machine + beacon, all driven by the station snapshot. */
function AssemblyCellView({ layout, index }: { layout: FactoryLayout; index: number }) {
  const cell = layout.cells[index];
  const id = `cell-${index}`;
  const robot = useMemo(createRobotAnim, []);
  const machine = useMemo(createAssemblyMachineAnim, []);
  const light = useMemo(createStackLightAnim, []);
  const target = useRef<[number, number, number]>([1.2, 1.6, 0]);
  const p3 = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  const rest: [number, number, number] = [0.9, 1.75, -0.9];
  const toLocal = (w: [number, number, number]): [number, number, number] => [w[0] - cell.robot[0], w[1], w[2] - cell.robot[1]];
  const table = toLocal(kitTableSlot(layout, index, 0));
  const fixture = toLocal(fixturePos(layout, index));
  const outfeed = toLocal([cell.outfeed[0], 0.86, cell.outfeed[1]]);

  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    const t = rt.playback.renderTime;
    const st = rt.index.stations.get(id);
    if (!st) return;
    light.state = st.state;
    light.clock = t;
    const s = progress(st.phase, t);
    const phase = st.phase?.name ?? null;
    const prod = st.productId ? rt.index.products.get(st.productId) : undefined;
    machine.running = st.state === 'running' && phase === 'process';
    machine.progress = phase === 'process' ? s : 0;
    machine.product = phase === 'process' && s >= 0.25 && st.productType ? (st.productType === 'A' ? 1 : 2) : 0;
    let goal = rest;
    let carry: RobotAnim['carry'] = 0;
    let grip = 1;
    const prodGoal = () => {
      if (prod && productPose(prod, rt.index, layout, t, p3.current, scratch)) {
        return toLocal([p3.current.x, p3.current.y + 0.12, p3.current.z]);
      }
      return rest;
    };
    if (phase === 'load') {
      if (s < 0.3) goal = mix(rest, [table[0], table[1] + 0.32, table[2]], s / 0.3);
      else {
        goal = prodGoal();
        carry = 1;
        grip = 0;
      }
    } else if (phase === 'process') {
      goal = s < 0.15 ? mix([fixture[0], fixture[1] + 0.3, fixture[2]], rest, s / 0.15) : rest;
    } else if (phase === 'unload') {
      if (s < 0.3) goal = mix(rest, [fixture[0], fixture[1] + 0.2, fixture[2]], s / 0.3);
      else {
        goal = prodGoal();
        carry = st.productType === 'A' ? 2 : 3;
        grip = 0;
      }
    } else if (st.state === 'blocked') {
      goal = [outfeed[0], outfeed[1] + 0.3, outfeed[2]];
      carry = st.productType === 'A' ? 2 : 3;
      grip = 0;
    }
    // ease only the idle/no-job transitions (sim-driven phases are already continuous)
    const tg = target.current;
    const k = phase ? 1 : 1 - Math.exp(-dt * 6);
    tg[0] = lerp(tg[0], goal[0], k);
    tg[1] = lerp(tg[1], goal[1], k);
    tg[2] = lerp(tg[2], goal[2], k);
    solveRobotIK(tg, robot);
    robot.carry = carry;
    robot.grip = grip;
  });

  const handlers = pickHandlers({ kind: 'station', id }, () => stationLabel(id));
  return (
    <group {...handlers}>
      <RobotArm anim={robot} position={[cell.robot[0], 0, cell.robot[1]]} />
      <AssemblyMachine anim={machine} position={[cell.machine[0], 0, cell.machine[1]]} />
      <StackLight anim={light} position={[cell.machine[0] + ASSEMBLY_LIGHT_MOUNT[0], ASSEMBLY_LIGHT_MOUNT[1], cell.machine[1] + ASSEMBLY_LIGHT_MOUNT[2]]} />
    </group>
  );
}

function mix(a: readonly number[], b: readonly number[], s: number): [number, number, number] {
  return [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];
}

function InspectionView({ layout, index }: { layout: FactoryLayout; index: number }) {
  const id = `insp-${index}`;
  const pos = layout.inspection[index].pos;
  const gantry = useMemo(createGantryAnim, []);
  const light = useMemo(createStackLightAnim, []);
  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    const t = rt.playback.renderTime;
    const st = rt.index.stations.get(id);
    if (!st) return;
    const s = progress(st.phase, t);
    gantry.scanning = st.state === 'running' && st.phase?.name === 'test';
    gantry.progress = st.phase?.name === 'test' ? s : st.phase?.name === 'unload' ? 1 : 0;
    gantry.result = st.phase?.name === 'unload' ? (st.result === 'reject' ? 2 : 1) : 0;
    gantry.clock = t;
    light.state = st.state;
    light.clock = t;
  });
  return (
    <group {...pickHandlers({ kind: 'station', id }, () => stationLabel(id))}>
      <InspectionGantry anim={gantry} position={[pos[0], 0, pos[1]]} />
      <StackLight anim={light} position={[pos[0] + 1.1, 2.3, pos[1] - 1.1]} />
    </group>
  );
}

function PackagingView({ layout }: { layout: FactoryLayout }) {
  const c = layout.packaging.center;
  const pack = useMemo(createPackagingAnim, []);
  const light = useMemo(createStackLightAnim, []);
  useFrame(() => {
    const rt = runtime.current;
    if (!rt) return;
    const t = rt.playback.renderTime;
    const st = rt.index.stations.get('pack');
    if (!st) return;
    pack.running = st.state === 'running';
    pack.progress = progress(st.phase, t);
    pack.hasCarton = false; // the carton is drawn by the product layer (selectable)
    light.state = st.state;
    light.clock = t;
  });
  return (
    <group {...pickHandlers({ kind: 'station', id: 'pack' }, () => stationLabel('pack'))}>
      <PackagingMachine anim={pack} position={[c[0], 0, c[1]]} />
      <StackLight anim={light} position={[c[0] + PACKAGING_LIGHT_MOUNT[0], PACKAGING_LIGHT_MOUNT[1], c[1] + PACKAGING_LIGHT_MOUNT[2]]} />
    </group>
  );
}

function PalletizerView({ layout }: { layout: FactoryLayout }) {
  const c = layout.palletizer.center;
  const anim = useMemo(createPalletizerAnim, []);
  const light = useMemo(createStackLightAnim, []);
  const zOffsets = layout.palletizer.positions.map((p) => p[1] - c[1]);
  useFrame((_, dt) => {
    const rt = runtime.current;
    if (!rt) return;
    const t = rt.playback.renderTime;
    const st = rt.index.stations.get('pal');
    if (!st) return;
    light.state = st.state;
    light.clock = t;
    const s = progress(st.phase, t);
    const hover: [number, number, number] = [PALLETIZER_PICK[0], PALLETIZER_PICK[1] + 0.9, 0];
    let goal = hover;
    let grip = false;
    if (st.phase?.name === 'place' && st.buildPos !== null) {
      const pz = zOffsets[st.buildPos] ?? 0;
      const pal = rt.index.snap?.pallets.find((p) => p.location === 'palletizer' && p.slot === st.buildPos);
      const units = pal?.units ?? 0;
      const o = cartonStackOffsets(units + 1)[units];
      const dropX = layout.palletizer.positions[0][0] - c[0] + o[0];
      const drop: [number, number, number] = [dropX, o[1] + 0.25, pz + o[2]];
      const pick: [number, number, number] = [PALLETIZER_PICK[0], PALLETIZER_PICK[1] + 0.24, 0];
      if (s < 0.2) goal = mix(hover, pick, s / 0.2) as [number, number, number];
      else {
        const u = (s - 0.2) / 0.8;
        goal = [lerp(pick[0], drop[0], u), lerp(pick[1], drop[1], u) + Math.sin(Math.PI * u) * 1.0, lerp(pick[2], drop[2], u)];
        grip = true;
      }
    } else if (st.phase?.name === 'wrap' && st.buildPos !== null) {
      goal = [layout.palletizer.positions[0][0] - c[0], 2.4, zOffsets[st.buildPos] ?? 0];
    }
    const k = st.phase ? 1 : 1 - Math.exp(-dt * 5);
    for (let i = 0; i < 3; i++) anim.target[i] = lerp(anim.target[i], goal[i], k);
    anim.grip = grip;
    anim.carrying = false; // carried carton is drawn by the product layer
  });
  return (
    <group {...pickHandlers({ kind: 'station', id: 'pal' }, () => stationLabel('pal'))}>
      <Palletizer anim={anim} positions={zOffsets} position={[c[0], 0, c[1]]} />
      <StackLight anim={light} position={[c[0] + 1.6, 2.9, c[1] - 2.6]} />
    </group>
  );
}

export function StationsLayer({ layout }: { layout: FactoryLayout }) {
  return (
    <>
      {layout.cells.map((c) => (
        <AssemblyCellView key={c.index} layout={layout} index={c.index} />
      ))}
      {layout.inspection.map((s) => (
        <InspectionView key={s.index} layout={layout} index={s.index} />
      ))}
      <PackagingView layout={layout} />
      <PalletizerView layout={layout} />
    </>
  );
}
