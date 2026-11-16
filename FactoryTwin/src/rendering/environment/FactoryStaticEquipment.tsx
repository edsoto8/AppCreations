import { useEffect, useMemo } from 'react';
import { MeshStandardMaterial, type BufferGeometry } from 'three';
import type { FactoryLayout } from '../../logistics/layout';
import type { KitTableAnim } from '../models/anims';
import { Parts, palletGeometry } from '../models/geometries';
import { PALETTE, lampMats, paintMat } from '../models/materials';
import { InfeedTable, KitTable, KittingRack, RejectBin, StorageRack } from '../models/Racks';
import { labelTexture } from '../models/textures';

export interface FactoryStaticEquipmentProps {
  layout: FactoryLayout;
  /**
   * Material lots shown per raw rack (slots fill bays first, then levels). Default: a fixed
   * "stocked" look (about 70% full). Pass zeros if the sync layer draws inventory itself.
   */
  rawRackLoads?: number[];
  /** Optional per-cell kit-table anims (tote counts). */
  kitTableAnims?: KitTableAnim[];
}

function buildProps(layout: FactoryLayout) {
  const p = new Parts();
  const aid: Parts = new Parts();
  const fire: Parts = new Parts();
  const chargers = new Parts();

  // AGV charging pads + chargers
  for (const ap of layout.agvParking) {
    const [x, z] = ap.pos;
    p.box(1.6, 0.02, 1.1, '#3d4349', [x, 0.01, z], undefined, 0.004);
    p.box(1.4, 0.022, 0.06, PALETTE.safetyYellow, [x, 0.011, z - 0.5], undefined, 0);
    p.box(1.4, 0.022, 0.06, PALETTE.safetyYellow, [x, 0.011, z + 0.5], undefined, 0);
    p.box(0.3, 1.1, 0.5, '#e6e9ec', [x - 1.0, 0.55, z], undefined, 0.04);
    p.box(0.31, 0.1, 0.51, PALETTE.machineBlue, [x - 1.0, 1.0, z], undefined, 0.01);
    p.box(0.08, 0.06, 0.3, '#2b2f34', [x - 0.82, 0.22, z], undefined, 0.01);
    chargers.box(0.012, 0.06, 0.14, '#fff', [x - 0.844, 0.8, z], undefined, 0);
  }

  // tool cabinets beside each cell (operator side), first-aid + extinguisher on nearby column spots
  for (const c of layout.cells) {
    const [kx, kz] = c.kitTable;
    p.box(1.0, 1.05, 0.55, '#c62828', [kx - 1.3, 0.525, kz + 2.6], undefined, 0.03);
    for (let i = 0; i < 5; i++) p.box(0.92, 0.008, 0.01, '#2b2f34', [kx - 1.3, 0.2 + i * 0.18, kz + 2.6 + 0.28], undefined, 0);
    p.box(1.04, 0.04, 0.6, '#3d4349', [kx - 1.3, 1.07, kz + 2.6], undefined, 0.01);
    for (const sx of [-1, 1]) p.cylZ(0.04, 0.03, '#1a1a1a', [kx - 1.3 + sx * 0.4, 0.04, kz + 2.6 + 0.2], 10);
  }

  // fire extinguisher stations (red post + extinguisher + sign)
  const extinguishers: [number, number][] = [
    [-41.6, -18.5],
    [-9.6, 18.5],
    [22.4, -18.5],
    [38.4, 18.5],
    [-25.6, 18.5],
    [6.4, -18.5],
  ];
  for (const [x, z] of extinguishers) {
    p.box(0.08, 1.6, 0.08, '#c62828', [x + 0.25, 0.8, z], undefined, 0.01);
    p.cyl(0.08, 0.08, 0.5, '#d32f2f', [x + 0.25, 0.55, z + 0.12], undefined, 12);
    p.cyl(0.03, 0.05, 0.1, '#1a1a1a', [x + 0.25, 0.85, z + 0.12], undefined, 8);
    fire.panel(0.3, 0.3, [x + 0.25, 1.75, z + 0.045], 0);
  }

  // first-aid station near the break room and by the shipping office area
  for (const [x, z] of [
    [layout.breakRoom.center[0] + layout.breakRoom.size[0] / 2 + 1.2, layout.breakRoom.center[1] + 1.0],
    [44, 21.5],
  ] as [number, number][]) {
    p.box(0.6, 0.7, 0.2, '#f4f4f4', [x, 1.4, z], undefined, 0.02);
    p.box(0.08, 1.6, 0.08, '#5d656d', [x, 0.8, z - 0.12], undefined, 0.01);
    aid.panel(0.5, 0.5, [x, 1.4, z + 0.105], 0);
  }

  // empty pallet stack near the palletizer, drums and material carts near receiving
  {
    const [px, pz] = layout.palletizer.center;
    for (let i = 0; i < 8; i++) p.addPrebuilt(palletGeometry, [px - 2.0, i * 0.145, pz - 6.4]);
  }
  for (let i = 0; i < 4; i++) {
    p.cyl(0.29, 0.29, 0.88, i % 2 ? '#1f5fa8' : '#f5c400', [-46.5 + (i % 2) * 0.62, 0.44, -18 + Math.floor(i / 2) * 0.62], undefined, 18);
    p.cyl(0.295, 0.295, 0.03, '#2b2f34', [-46.5 + (i % 2) * 0.62, 0.6, -18 + Math.floor(i / 2) * 0.62], undefined, 18);
  }
  // packing-material cart beside packaging, rework workbench beside the reject bin
  {
    const [cx, cz] = layout.packaging.center;
    p.box(1.2, 0.04, 0.7, '#9aa3ab', [cx - 2, 0.3, cz + 3.4], undefined, 0.01);
    p.box(1.2, 0.04, 0.7, '#9aa3ab', [cx - 2, 0.9, cz + 3.4], undefined, 0.01);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.04, 1.0, 0.04, '#5d656d', [cx - 2 + sx * 0.58, 0.5, cz + 3.4 + sz * 0.33], undefined, 0.005);
    for (let i = 0; i < 6; i++) p.box(1.0, 0.06, 0.6, i % 2 ? PALETTE.kraft : PALETTE.kraftDark, [cx - 2, 0.95 + i * 0.065, cz + 3.4], [0, (i % 3) * 0.04, 0], 0);
  }

  const aidMat = new MeshStandardMaterial({ map: labelTexture('+', { bg: '#1b8a3a', fg: '#ffffff', width: 128, height: 128, size: 0.9 }), roughness: 0.5 });
  const fireMat = new MeshStandardMaterial({ map: labelTexture('FIRE', { bg: '#c62828', fg: '#ffffff', width: 128, height: 128, size: 0.32 }), roughness: 0.5 });
  return { props: p.build(), aid: aid.build(), fire: fire.build(), chargers: chargers.build(), aidMat, fireMat };
}

/**
 * Static equipment placed from the layout: raw racks, FG racks, kitting rack, kit tables, the
 * inspection infeed table, the reject bin, AGV charging pads and small props (tool cabinets,
 * extinguishers, first-aid stations, pallet stack, drums, carton cart).
 */
export function FactoryStaticEquipment({ layout, rawRackLoads, kitTableAnims }: FactoryStaticEquipmentProps) {
  const pr = useMemo(() => buildProps(layout), [layout]);
  useEffect(
    () => () => {
      for (const g of [pr.props, pr.aid, pr.fire, pr.chargers] as BufferGeometry[]) g.dispose();
      pr.aidMat.dispose();
      pr.fireMat.dispose();
    },
    [pr],
  );
  const infeed = useMemo(() => {
    const xs = layout.infeed.slots.map((s) => s[0]);
    const zs = layout.infeed.slots.map((s) => s[1]);
    const sx = Math.max(...xs) - Math.min(...xs) + 0.9;
    const sz = Math.max(...zs) - Math.min(...zs) + 0.9;
    return { size: [sx, sz] as [number, number], center: layout.infeed.center };
  }, [layout]);

  return (
    <group>
      {layout.rawRacks.map((r, i) => (
        <StorageRack
          key={`raw${i}`}
          length={r.length}
          depth={r.depth}
          levels={r.levels}
          bays={r.bays}
          loads={rawRackLoads ? rawRackLoads[i] ?? 0 : Math.round(r.bays * r.levels * (0.6 + 0.1 * (i % 3)))}
          position={[r.center[0], 0, r.center[1]]}
          rotation={[0, r.face === 1 ? 0 : Math.PI, 0]}
        />
      ))}
      {layout.fgRacks.map((r, i) => (
        <StorageRack
          key={`fg${i}`}
          length={r.length}
          depth={r.depth}
          levels={r.levels}
          bays={r.bays}
          position={[r.center[0], 0, r.center[1]]}
          rotation={[0, r.face === 1 ? 0 : Math.PI, 0]}
        />
      ))}
      <KittingRack position={[layout.kitting.pos[0], 0, layout.kitting.pos[1]]} />
      {layout.cells.map((c, i) => (
        <KitTable key={`kt${i}`} anim={kitTableAnims?.[i]} position={[c.kitTable[0], 0, c.kitTable[1]]} />
      ))}
      <InfeedTable size={infeed.size} position={[infeed.center[0], 0, infeed.center[1]]} />
      <RejectBin position={[layout.rejectBin.pos[0], 0, layout.rejectBin.pos[1]]} />
      <mesh geometry={pr.props} material={paintMat} castShadow receiveShadow />
      <mesh geometry={pr.chargers} material={lampMats.green} />
      <mesh geometry={pr.aid} material={pr.aidMat} />
      <mesh geometry={pr.fire} material={pr.fireMat} />
    </group>
  );
}
