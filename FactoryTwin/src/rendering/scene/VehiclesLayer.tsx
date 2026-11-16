import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { FactoryLayout } from '../../logistics/layout';
import { runtime } from '../runtime';
import { vehiclePose, yawFromHeading, type P3 } from '../positions';
import { AGV, Forklift, createAGVAnim, createForkliftAnim } from '../models';
import { pickHandlers } from './pick';

function vehicleLabel(id: string): string {
  const v = runtime.current?.index.vehicles.get(id);
  return v ? `${v.name} — ${v.state}${v.cargo ? `\ncarrying ${v.cargo.label}` : ''}\n${v.trips} trips` : id;
}

function AgvView({ id }: { id: string }) {
  const g = useRef<Group>(null);
  const anim = useMemo(createAGVAnim, []);
  const p = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  useFrame(() => {
    const rt = runtime.current;
    const v = rt?.index.vehicles.get(id);
    if (!rt || !v || !g.current) return;
    const t = rt.playback.renderTime;
    vehiclePose(v, t, p.current);
    g.current.position.set(p.current.x, 0, p.current.z);
    g.current.rotation.y = yawFromHeading(p.current.heading);
    anim.moving = !!v.motion && t < v.motion.t1;
    anim.failed = v.state === 'failed';
    anim.clock = t;
    anim.cargo = 0; // totes/units are drawn by the product layer (selectable)
  });
  return (
    <group ref={g} {...pickHandlers({ kind: 'vehicle', id }, () => vehicleLabel(id))}>
      <AGV anim={anim} />
    </group>
  );
}

function ForkliftView({ id }: { id: string }) {
  const g = useRef<Group>(null);
  const anim = useMemo(createForkliftAnim, []);
  const p = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  useFrame(() => {
    const rt = runtime.current;
    const v = rt?.index.vehicles.get(id);
    if (!rt || !v || !g.current) return;
    const t = rt.playback.renderTime;
    vehiclePose(v, t, p.current);
    g.current.position.set(p.current.x, 0, p.current.z);
    g.current.rotation.y = yawFromHeading(p.current.heading);
    anim.moving = !!v.motion && t < v.motion.t1;
    anim.failed = v.state === 'failed';
    anim.clock = t;
    // forks: rise while loading/unloading (phase progress), carry low while driving
    let h = v.cargo ? 0.25 : 0.1;
    if (v.phase) {
      const s = Math.min(1, Math.max(0, (t - v.phase.t0) / Math.max(1e-6, v.phase.t1 - v.phase.t0)));
      const high = v.phase.name === 'store' || v.phase.name === 'pick-fg' ? 1.6 : v.phase.name === 'putaway' ? 1.2 : 0.4;
      h = 0.1 + Math.sin(Math.PI * s) * high;
    }
    anim.forkHeight = h;
    anim.pallet = v.cargo ? (v.cargo.kind === 'material' ? -1 : Math.max(1, v.cargo.count)) : 0;
  });
  return (
    <group ref={g} {...pickHandlers({ kind: 'vehicle', id }, () => vehicleLabel(id))}>
      <Forklift anim={anim} />
    </group>
  );
}

export function VehiclesLayer({ layout }: { layout: FactoryLayout }) {
  const agvs = layout.agvParking.map((_, k) => `agv-${k}`);
  const forks = layout.forkliftHome.map((_, k) => `fork-${k}`);
  return (
    <>
      {agvs.map((id) => (
        <AgvView key={id} id={id} />
      ))}
      {forks.map((id) => (
        <ForkliftView key={id} id={id} />
      ))}
    </>
  );
}
