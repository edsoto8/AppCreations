import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { DoubleSide, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type InstancedMesh } from 'three';
import type { KitTableAnim } from './anims';
import { Parts, kitToteGeometry, lazy, materialLotGeometry, unitCylinderGeometry } from './geometries';
import { PALETTE, aluminiumMat, materialLotMat, metalMat, paintMat, toteMat } from './materials';
import { labelTexture, wireTexture } from './textures';

type GroupProps = ThreeElements['group'];
const _m = new Matrix4();

// ---------------------------------------------------------------------------------------------
// Selective pallet rack
// ---------------------------------------------------------------------------------------------

/** Vertical pitch between rack levels; level k deck top is at 0.15 + k * RACK_LEVEL_PITCH. */
export const RACK_LEVEL_PITCH = 1.5;
export const RACK_BASE_Y = 0.15;

const rackCache = new Map<string, BufferGeometry>();

function rackGeometry(length: number, depth: number, levels: number, bays: number): BufferGeometry {
  const key = `${length}|${depth}|${levels}|${bays}`;
  const hit = rackCache.get(key);
  if (hit) return hit;
  const H = levels * RACK_LEVEL_PITCH + 0.1;
  const bw = length / bays;
  const blue = PALETTE.rackBlue;
  const orange = PALETTE.rackOrange;
  const p = new Parts();
  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + i * bw;
    for (const s of [-1, 1]) {
      const z = s * (depth / 2 - 0.035);
      p.box(0.09, H, 0.07, blue, [x, H / 2, z], undefined, 0.01);
      p.box(0.16, 0.012, 0.13, '#5d656d', [x, 0.006, z], undefined, 0.002);
    }
    // frame bracing: horizontals + diagonals
    const n = Math.max(2, Math.round(H / 1.1));
    for (let k = 0; k <= n; k++) {
      const y = 0.15 + (k * (H - 0.3)) / n;
      p.box(0.035, 0.035, depth - 0.12, '#2f64a8', [x, y, 0], undefined, 0.004);
      if (k < n) {
        const y2 = 0.15 + ((k + 1) * (H - 0.3)) / n;
        const zs = k % 2 === 0 ? 1 : -1;
        p.bar([x, y, -zs * (depth / 2 - 0.07)], [x, y2, zs * (depth / 2 - 0.07)], 0.03, '#2f64a8');
      }
    }
    // end-of-aisle column guards
    if (i === 0 || i === bays) for (const s of [-1, 1]) p.box(0.2, 0.4, 0.16, PALETTE.safetyYellow, [x + (i === 0 ? -0.07 : 0.07), 0.2, s * (depth / 2 - 0.035)], undefined, 0.02);
  }
  for (let b = 0; b < bays; b++) {
    const cx = -length / 2 + (b + 0.5) * bw;
    for (let lv = 0; lv < levels; lv++) {
      const y = RACK_BASE_Y + lv * RACK_LEVEL_PITCH;
      for (const s of [-1, 1]) p.box(bw - 0.09, 0.11, 0.05, orange, [cx, y - 0.075, s * (depth / 2 - 0.035)], undefined, 0.008);
      // wire deck (channels + mesh tone)
      p.box(bw - 0.12, 0.015, depth - 0.1, '#8d969f', [cx, y - 0.02, 0], undefined, 0.002);
      for (let k = -2; k <= 2; k++) p.box(0.03, 0.03, depth - 0.1, '#6f7881', [cx + (k * (bw - 0.3)) / 4, y - 0.035, 0], undefined, 0.002);
      // location label on the front beam
      p.box(0.18, 0.06, 0.005, '#f4f4f0', [cx - bw * 0.3, y - 0.075, depth / 2 - 0.007], undefined, 0);
    }
  }
  const g = p.build();
  rackCache.set(key, g);
  return g;
}

export type StorageRackProps = GroupProps & {
  length: number;
  depth: number;
  levels: number;
  bays: number;
  /** Optional number of shrink-wrapped material lots to show (fills bays, then levels). */
  loads?: number;
};

/** Slot position (rack-local [x,y,z], pallet bottom centre) for slot k: bays first, then levels. */
export function rackSlotLocal(length: number, bays: number, k: number): [number, number, number] {
  const bay = k % bays;
  const level = Math.floor(k / bays);
  return [-length / 2 + (bay + 0.5) * (length / bays), RACK_BASE_Y + level * RACK_LEVEL_PITCH, 0];
}

/**
 * Selective pallet rack, long axis along local x, depth along z, blue uprights + orange beams +
 * wire decks merged into one geometry (cached per size). One pallet per bay per level.
 * Draw calls: 1 (+1 shadow), plus 1 (+1) when `loads` > 0.
 */
export function StorageRack({ length, depth, levels, bays, loads = 0, ...props }: StorageRackProps) {
  const g = rackGeometry(length, depth, levels, bays);
  const slots = bays * levels;
  const n = Math.max(0, Math.min(slots, Math.round(loads)));
  const lots = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = lots.current;
    if (!im) return;
    for (let k = 0; k < n; k++) {
      const [x, y, z] = rackSlotLocal(length, bays, k);
      im.setMatrixAt(k, _m.makeTranslation(x, y, z));
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [n, length, bays]);
  return (
    <group {...props}>
      <mesh geometry={g} material={paintMat} castShadow receiveShadow />
      {slots > 0 && (
        <instancedMesh key={slots} ref={lots} args={[materialLotGeometry, materialLotMat, slots]} castShadow visible={n > 0} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Kitting gravity-flow rack
// ---------------------------------------------------------------------------------------------

const kittingGeo = lazy(() => {
  const p = new Parts();
  const len = 2.6; // along z
  const dep = 1.0; // along x, pick face +x
  const slope = -0.16;
  for (const x of [-dep / 2, dep / 2])
    for (const z of [-len / 2, len / 2]) p.box(0.05, 2.1, 0.05, '#aab2ba', [x, 1.05, z], undefined, 0.008);
  for (const z of [-len / 2, len / 2]) for (const y of [0.1, 2.08]) p.box(dep, 0.04, 0.04, '#aab2ba', [0, y, z], undefined, 0.006);
  const binColors = ['#2a6bd1', '#d33a2f', '#f5c400', '#2e9e44'];
  const levels = [0.42, 0.9, 1.38];
  levels.forEach((y0, lv) => {
    // sloped roller bed
    p.box(dep + 0.06, 0.03, len, '#8f98a1', [0, y0, 0], [0, 0, slope], 0.004);
    for (const z of [-len / 2 + 0.02, len / 2 - 0.02]) p.box(dep + 0.06, 0.08, 0.03, '#5d656d', [0, y0 + 0.02, z], [0, 0, slope], 0.004);
    const nb = 5;
    for (let b = 0; b < nb; b++) {
      const z = -len / 2 + 0.06 + (b + 0.5) * ((len - 0.12) / nb);
      for (const row of [0, 1]) {
        const x = dep / 2 - 0.22 - row * 0.46;
        const y = y0 + 0.02 - Math.sin(slope) * -x + 0.11;
        const c = binColors[(lv + b + row) % 4];
        p.box(0.42, 0.2, (len - 0.12) / nb - 0.03, c, [x, y, z], [0, 0, slope], 0.015);
        p.box(0.004, 0.06, 0.18, '#f4f4f0', [x + 0.212, y + 0.02, z], [0, 0, slope], 0);
      }
    }
  });
  // top return shelf for empties
  p.box(dep + 0.06, 0.03, len, '#8f98a1', [0, 1.86, 0], [0, 0, -slope], 0.004);
  for (let b = 0; b < 4; b++) p.box(0.4, 0.14, 0.5, '#9aa3ab', [-0.15 + (b % 2) * 0.35, 1.95 + (b % 2) * 0.06, -0.9 + b * 0.6], [0, 0, -slope], 0.012);
  // pick-to-light strip + header
  p.box(0.03, 0.12, len, '#202326', [dep / 2 + 0.04, 0.33, 0], undefined, 0.004);
  p.box(0.06, 0.25, len + 0.06, PALETTE.machineBlue, [dep / 2 - 0.05, 2.2, 0], undefined, 0.01);
  return p.build();
});

/** Gravity flow rack with coloured bins. Pick face = local +x, long axis along z (2.6 m). Draw calls: 1 (+1). */
export function KittingRack(props: GroupProps) {
  return (
    <group {...props}>
      <mesh geometry={kittingGeo()} material={paintMat} castShadow receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Kit table (4 totes)
// ---------------------------------------------------------------------------------------------

export const KIT_TABLE_TOP = 0.86;
/** Tote centres on the kit table (table-local x, z). */
export const KIT_TABLE_SLOTS: [number, number][] = [
  [0.25, -0.19],
  [0.25, 0.19],
  [-0.25, -0.19],
  [-0.25, 0.19],
];

const kitTableGeo = lazy(() => {
  const p = new Parts()
    .box(1.2, 0.04, 0.9, '#3f6e8c', [0, KIT_TABLE_TOP - 0.02, 0], undefined, 0.01)
    .box(1.22, 0.05, 0.92, '#aab2ba', [0, KIT_TABLE_TOP - 0.06, 0], undefined, 0.008)
    .box(1.1, 0.03, 0.8, '#8f98a1', [0, 0.22, 0], undefined, 0.005);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      p.box(0.05, KIT_TABLE_TOP - 0.08, 0.05, '#aab2ba', [sx * 0.56, (KIT_TABLE_TOP - 0.08) / 2, sz * 0.41], undefined, 0.008);
      p.box(0.08, 0.02, 0.08, '#202326', [sx * 0.56, 0.01, sz * 0.41], undefined, 0.004);
    }
  // end stop at +x (robot side)
  p.box(0.03, 0.06, 0.9, PALETTE.safetyYellow, [0.6, KIT_TABLE_TOP + 0.03, 0], undefined, 0.005);
  return p.build();
});

export type KitTableProps = GroupProps & { anim?: KitTableAnim };

/** Small 1.2 x 0.9 m table for up to 4 totes (top at KIT_TABLE_TOP). Draw calls: 2 (+2). */
export function KitTable({ anim, ...props }: KitTableProps) {
  const totes = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = totes.current;
    if (!im) return;
    KIT_TABLE_SLOTS.forEach(([x, z], i) => im.setMatrixAt(i, _m.makeTranslation(x, KIT_TABLE_TOP, z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.count = 0;
  }, []);
  useFrame(() => {
    const im = totes.current;
    if (!im) return;
    const n = anim ? Math.max(0, Math.min(4, Math.round(anim.totes))) : 0;
    im.count = n;
    im.visible = n > 0;
  });
  return (
    <group {...props}>
      <mesh geometry={kitTableGeo()} material={paintMat} castShadow receiveShadow />
      <instancedMesh ref={totes} args={[kitToteGeometry, toteMat, 4]} castShadow visible={false} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Infeed accumulation table
// ---------------------------------------------------------------------------------------------

export const INFEED_TOP = 0.86;

export type InfeedTableProps = GroupProps & { size: [number, number] };

/** Roller accumulation table, size [x, z] metres, rollers across z, top at INFEED_TOP. Draw calls: 2 (+1). */
export function InfeedTable({ size, ...props }: InfeedTableProps) {
  const [sx, sz] = size;
  const frame = useMemo(() => {
    const p = new Parts();
    for (const s of [-1, 1]) {
      p.box(sx + 0.06, 0.12, 0.05, PALETTE.aluminium, [0, INFEED_TOP - 0.07, s * (sz / 2 + 0.025)], undefined, 0.008);
      p.box(sx, 0.05, 0.02, '#5d656d', [0, INFEED_TOP + 0.04, s * (sz / 2 + 0.01)], undefined, 0.004);
    }
    for (const s of [-1, 1]) p.box(0.05, 0.12, sz + 0.1, PALETTE.aluminium, [s * (sx / 2 + 0.025), INFEED_TOP - 0.07, 0], undefined, 0.008);
    // lane divider between the two columns
    p.box(sx, 0.03, 0.015, '#f5c400', [0, INFEED_TOP + 0.025, 0], undefined, 0.003);
    const nx = Math.max(2, Math.ceil(sx / 1.0) + 1);
    const nz = Math.max(2, Math.ceil(sz / 1.2) + 1);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x = -sx / 2 + 0.05 + (i * (sx - 0.1)) / (nx - 1);
        const z = -sz / 2 + 0.05 + (j * (sz - 0.1)) / (nz - 1);
        p.box(0.05, INFEED_TOP - 0.13, 0.05, PALETTE.aluminium, [x, (INFEED_TOP - 0.13) / 2, z], undefined, 0.008);
        p.box(0.09, 0.02, 0.09, '#202326', [x, 0.01, z], undefined, 0.004);
      }
    return p.build();
  }, [sx, sz]);
  useEffect(() => () => frame.dispose(), [frame]);
  const n = Math.max(2, Math.floor(sx / 0.1));
  const rollers = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = rollers.current;
    if (!im) return;
    const q = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
    const s = new Vector3(0.028, sz, 0.028);
    const v = new Vector3();
    for (let i = 0; i < n; i++) im.setMatrixAt(i, _m.compose(v.set(-sx / 2 + 0.05 + (i * (sx - 0.1)) / (n - 1), INFEED_TOP - 0.03, 0), q, s));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [n, sx, sz]);
  return (
    <group {...props}>
      <mesh geometry={frame} material={metalMat} castShadow receiveShadow />
      <instancedMesh key={n} ref={rollers} args={[unitCylinderGeometry, aluminiumMat, n]} receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Reject / rework bin
// ---------------------------------------------------------------------------------------------

export const REJECT_BIN_FLOOR = 0.14;

const rejectGeo = lazy(() => {
  const W = 1.9;
  const D = 1.3;
  const H = 1.0;
  const R = PALETTE.red;
  const p = new Parts()
    .box(W, 0.04, D, '#7d1f1f', [0, REJECT_BIN_FLOOR - 0.02, 0], undefined, 0.006);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      p.box(0.05, H, 0.05, R, [sx * (W / 2), H / 2, sz * (D / 2)], undefined, 0.008);
      p.box(0.12, 0.1, 0.12, '#3d4349', [sx * (W / 2 - 0.1), 0.05, sz * (D / 2 - 0.1)], undefined, 0.01);
    }
  for (const y of [REJECT_BIN_FLOOR, H])
    for (const s of [-1, 1]) {
      p.box(W, 0.04, 0.04, R, [0, y, s * (D / 2)], undefined, 0.006);
      p.box(0.04, 0.04, D, R, [s * (W / 2), y, 0], undefined, 0.006);
    }
  const wire = new Parts();
  const h = H - REJECT_BIN_FLOOR - 0.04;
  const y = REJECT_BIN_FLOOR + 0.02 + h / 2;
  wire.panel(W - 0.05, h, [0, y, D / 2], 0, 0.1).panel(W - 0.05, h, [0, y, -D / 2], 0, 0.1);
  wire.panel(D - 0.05, h, [W / 2, y, 0], Math.PI / 2, 0.1).panel(D - 0.05, h, [-W / 2, y, 0], Math.PI / 2, 0.1);
  const label = new Parts().panel(0.9, 0.24, [0, 0.72, D / 2 + 0.03], 0).panel(0.9, 0.24, [0, 0.72, -D / 2 - 0.03], Math.PI);
  const labelMat = new MeshStandardMaterial({ map: labelTexture('REWORK', { bg: '#c62828', fg: '#ffffff', border: '#ffffff', width: 512, height: 136, size: 0.62 }), roughness: 0.6 });
  const wireMat = new MeshStandardMaterial({ color: '#b3261e', map: wireTexture(), alphaTest: 0.5, side: DoubleSide, roughness: 0.5, metalness: 0.3 });
  return { frame: p.build(), wire: wire.build(), label: label.build(), labelMat, wireMat };
});

/** Red wire-cage rework bin 1.9 x 1.3 x 1.0 m with "REWORK" labels; floor at REJECT_BIN_FLOOR. Draw calls: 3 (+1). */
export function RejectBin(props: GroupProps) {
  const g = rejectGeo();
  return (
    <group {...props}>
      <mesh geometry={g.frame} material={paintMat} castShadow receiveShadow />
      <mesh geometry={g.wire} material={g.wireMat} />
      <mesh geometry={g.label} material={g.labelMat} />
    </group>
  );
}
