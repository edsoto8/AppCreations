import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type { FactoryLayout } from '../../logistics/layout';
import { runtime } from '../runtime';
import { beltPosAt } from '../positions';
import { ConveyorLine, createConveyorAnim } from '../models';
import { pickHandlers } from './pick';

function ConveyorView({ id, points }: { id: string; points: [number, number][] }) {
  const anim = useMemo(createConveyorAnim, []);
  useFrame(() => {
    const rt = runtime.current;
    const c = rt?.index.conveyors.get(id);
    if (!rt || !c) return;
    anim.beltPos = beltPosAt(c, rt.playback.renderTime);
    anim.state = c.state;
  });
  const label = () => {
    const c = runtime.current?.index.conveyors.get(id);
    return c ? `Conveyor ${id} — ${c.state}\n${c.items.length} item(s), ${c.length.toFixed(1)} m` : id;
  };
  return <ConveyorLine points={points} anim={anim} {...pickHandlers({ kind: 'conveyor', id }, label)} />;
}

export function ConveyorsLayer({ layout }: { layout: FactoryLayout }) {
  return (
    <>
      {layout.conveyors.map((c) => (
        <ConveyorView key={c.id} id={c.id} points={c.points} />
      ))}
    </>
  );
}
