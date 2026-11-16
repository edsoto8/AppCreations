import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { FactoryLayout } from '../../logistics/layout';
import type { TruckSnap } from '../../simulation/types';
import { runtime } from '../runtime';
import { Truck, createTruckAnim } from '../models';

function placement(t: TruckSnap, layout: FactoryLayout, waitingIndex: number): { pos: [number, number, number]; rot: number } {
  if (t.kind === 'inbound') {
    const bay = layout.receivingBays[t.bay];
    if (bay) return { pos: [bay.door[0] - 0.6, 0, bay.door[1]], rot: 0 };
    return { pos: [-66 - 0 * waitingIndex, 0, -22 + waitingIndex * 4.5], rot: 0 };
  }
  const bay = layout.shippingBays[t.bay];
  if (bay) return { pos: [bay.door[0] + 0.6, 0, bay.door[1]], rot: Math.PI };
  return { pos: [66, 0, -22 + waitingIndex * 4.5], rot: Math.PI };
}

function TruckView({ snap, layout, waitingIndex }: { snap: TruckSnap; layout: FactoryLayout; waitingIndex: number }) {
  const anim = useMemo(createTruckAnim, []);
  const id = snap.id;
  useFrame(() => {
    const t = runtime.current?.index.snap?.trucks.find((x) => x.id === id);
    if (!t) return;
    anim.doorOpen = t.state === 'docked' || t.state === 'departing' ? 1 : 0;
    anim.pallets = t.pallets;
  });
  const { pos, rot } = placement(snap, layout, waitingIndex);
  return <Truck anim={anim} kind={snap.kind} label={snap.kind === 'inbound' ? 'SUPPLIER FREIGHT' : 'ACME CARRIERS'} position={pos} rotation={[0, rot, 0]} />;
}

/** Trucks change rarely (dock/undock), so the set is diffed per frame and React re-renders only then. */
export function TrucksLayer({ layout }: { layout: FactoryLayout }) {
  const [trucks, setTrucks] = useState<TruckSnap[]>([]);
  const sig = useRef('');
  useFrame(() => {
    const list = runtime.current?.index.snap?.trucks ?? [];
    const s = list.map((t) => `${t.id}:${t.bay}:${t.state}`).join('|');
    if (s !== sig.current) {
      sig.current = s;
      setTrucks(list.map((t) => ({ ...t })));
    }
  });
  let wi = 0;
  let wo = 0;
  return (
    <>
      {trucks.map((t) => (
        <TruckView key={t.id} snap={t} layout={layout} waitingIndex={t.bay >= 0 ? 0 : t.kind === 'inbound' ? wi++ : wo++} />
      ))}
    </>
  );
}
