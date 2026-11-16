import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { FactoryLayout } from '../../logistics/layout';
import { runtime } from '../runtime';
import { FactoryStaticEquipment } from '../environment';
import { createKitTableAnim } from '../models';
import { pickHandlers } from './pick';

/**
 * Static equipment (racks, tables, bins, pads). Raw-rack fill levels follow the simulated
 * inventory (refreshed when the rounded lot count changes, not per tick).
 */
export function StorageLayer({ layout }: { layout: FactoryLayout }) {
  const kitAnims = useMemo(() => layout.cells.map(() => createKitTableAnim()), [layout]);
  const [loads, setLoads] = useState<number[]>(() => layout.rawRacks.map(() => 14));
  const sig = useRef('');
  useFrame(() => {
    const rt = runtime.current;
    const snap = rt?.index.snap;
    if (!rt || !snap) return;
    const cfg = rt.scenario.config;
    const next = layout.rawRacks.map((r) => {
      const slots = r.bays * r.levels;
      const frac = r.materials.reduce((s, m) => s + snap.inventory[m] / (cfg.materials[m].reorderPoint + cfg.materials[m].orderQty), 0) / Math.max(1, r.materials.length);
      return Math.max(0, Math.min(slots, Math.round(frac * slots)));
    });
    const s = next.join(',');
    if (s !== sig.current) {
      sig.current = s;
      setLoads(next);
    }
  });
  const rackLabel = (i: number) => () => {
    const snap = runtime.current?.index.snap;
    const r = layout.rawRacks[i];
    return `Raw storage rack ${i + 1}\n${r.materials.map((m) => `${m}: ${snap?.inventory[m] ?? '?'}`).join('\n')}`;
  };
  return (
    <>
      <FactoryStaticEquipment layout={layout} rawRackLoads={loads} kitTableAnims={kitAnims} />
      {layout.rawRacks.map((r, i) => (
        <mesh key={r.index} position={[r.center[0], 1.6, r.center[1]]} {...pickHandlers({ kind: 'storage', id: `raw-${i}` }, rackLabel(i))}>
          <boxGeometry args={[r.length, 3.2, r.depth + 0.4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
      {layout.fgRacks.map((r) => (
        <mesh key={r.index} position={[r.center[0], 2.4, r.center[1]]} {...pickHandlers({ kind: 'storage', id: 'fg' }, 'Finished goods storage')}>
          <boxGeometry args={[r.length, 4.8, r.depth + 0.2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      ))}
    </>
  );
}
