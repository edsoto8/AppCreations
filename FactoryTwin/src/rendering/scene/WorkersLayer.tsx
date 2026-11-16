import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { WorkerRole } from '../../simulation/types';
import { distanceAt } from '../../logistics/motion';
import { runtime } from '../runtime';
import { workerPose, yawFromHeading, type P3 } from '../positions';
import { Worker, createWorkerAnim } from '../models';
import { pickHandlers } from './pick';

function WorkerView({ id, role }: { id: string; role: WorkerRole }) {
  const g = useRef<Group>(null);
  const anim = useMemo(createWorkerAnim, []);
  const p = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  const odo = useRef({ base: 0, seg: null as unknown });
  useFrame(() => {
    const rt = runtime.current;
    const w = rt?.index.workers.get(id);
    if (!rt || !w || !g.current) return;
    const t = rt.playback.renderTime;
    // drivers ride the forklift while working: hide the walking figure
    const hidden = w.state === 'off-shift' || w.state === 'absent' || (w.role === 'driver' && w.state === 'working');
    g.current.visible = !hidden;
    if (hidden) return;
    workerPose(w, t, p.current);
    g.current.position.set(p.current.x, 0, p.current.z);
    if (w.motion) g.current.rotation.y = yawFromHeading(p.current.heading);
    const walking = !!w.motion && t < w.motion.t1;
    if (w.motion && odo.current.seg !== w.motion) {
      odo.current.seg = w.motion;
      odo.current.base = anim.stride;
    }
    anim.walking = walking;
    anim.stride = w.motion ? odo.current.base + (distanceAt(w.motion, t) - w.motion.d0) : anim.stride;
    anim.working = w.state === 'working' || w.state === 'repairing';
    anim.clock = t;
  });
  const label = () => {
    const w = runtime.current?.index.workers.get(id);
    return w ? `${w.name} (${w.role}) — ${w.state}${w.stationId ? `\n@ ${w.stationId}` : ''}` : id;
  };
  return (
    <group ref={g} {...pickHandlers({ kind: 'worker', id }, label)}>
      <Worker anim={anim} role={role} />
    </group>
  );
}

/** One component per worker; the roster is fixed per scenario, so this never re-renders per tick. */
export function WorkersLayer() {
  const roster = runtime.current?.host.snapshot?.workers.map((w) => ({ id: w.id, role: w.role })) ?? [];
  return (
    <>
      {roster.map((w) => (
        <WorkerView key={w.id} id={w.id} role={w.role} />
      ))}
    </>
  );
}
