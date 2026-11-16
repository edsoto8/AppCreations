import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import { Matrix4, MeshStandardMaterial, type BufferGeometry, type Group, type InstancedMesh } from 'three';
import type { TruckAnim } from './anims';
import { clamp01 } from './anims';
import { Parts, fullCartonLoadGeometry, lazy, materialLotGeometry, palletGeometry } from './geometries';
import { cartonMat, materialLotMat, paintMat, palletMat } from './materials';
import { labelTexture } from './textures';

export type TruckKind = 'inbound' | 'outbound';

/** Trailer deck height (top of floor). */
export const TRUCK_DECK_Y = 1.2;
export const TRUCK_LENGTH = 12.9;
const TL = 9.6;
const TW = 2.5;
const ROOF = 3.95;
const MAX_PALLETS = 14;
const CAB_COLOR: Record<TruckKind, string> = { inbound: '#1d4fbf', outbound: '#b3261e' };

const geoCache = new Map<TruckKind, BufferGeometry>();

function wheel(p: Parts, x: number, z: number, r = 0.5, w = 0.3) {
  p.cylZ(r, w, '#141516', [x, r, z], 24);
  p.cylZ(r * 0.55, w + 0.01, '#a7afb7', [x, r, z], 16);
  p.cylZ(r * 0.18, w + 0.03, '#5d656d', [x, r, z], 10);
}

function truckGeometry(kind: TruckKind): BufferGeometry {
  const hit = geoCache.get(kind);
  if (hit) return hit;
  const cab = CAB_COLOR[kind];
  const W = '#f3f4f5';
  const p = new Parts();
  // trailer box
  p.box(TL, 0.12, TW, '#5d656d', [-TL / 2, TRUCK_DECK_Y - 0.06, 0], undefined, 0.01);
  for (const z of [-1, 1]) p.box(TL, ROOF - TRUCK_DECK_Y, 0.04, W, [-TL / 2, (ROOF + TRUCK_DECK_Y) / 2, z * (TW / 2 - 0.02)], undefined, 0.01);
  p.box(0.05, ROOF - TRUCK_DECK_Y, TW, W, [-TL + 0.025, (ROOF + TRUCK_DECK_Y) / 2, 0], undefined, 0.01);
  p.box(TL, 0.06, TW, W, [-TL / 2, ROOF, 0], undefined, 0.02);
  // interior floor (darker), side rails + corner posts
  p.box(TL - 0.1, 0.01, TW - 0.1, '#7a6a55', [-TL / 2, TRUCK_DECK_Y + 0.005, 0], undefined, 0);
  for (const z of [-1, 1]) {
    p.box(TL, 0.12, 0.06, '#c3c9cf', [-TL / 2, TRUCK_DECK_Y + 0.02, z * (TW / 2 + 0.01)], undefined, 0.01);
    p.box(TL, 0.06, 0.06, '#c3c9cf', [-TL / 2, ROOF - 0.03, z * (TW / 2 + 0.01)], undefined, 0.01);
    p.box(0.12, ROOF - TRUCK_DECK_Y + 0.1, 0.12, '#c3c9cf', [-0.06, (ROOF + TRUCK_DECK_Y) / 2, z * (TW / 2 - 0.04)], undefined, 0.01);
    p.box(0.1, ROOF - TRUCK_DECK_Y, 0.08, '#c3c9cf', [-TL + 0.05, (ROOF + TRUCK_DECK_Y) / 2, z * (TW / 2 - 0.02)], undefined, 0.01);
  }
  p.box(0.12, 0.18, TW, '#c3c9cf', [-0.06, ROOF - 0.12, 0], undefined, 0.01);
  // rear underride bar + lights
  p.box(0.1, 0.12, TW - 0.2, '#d32f2f', [-0.15, 0.55, 0], undefined, 0.01);
  for (const z of [-0.8, 0.8]) {
    p.box(0.08, 0.55, 0.08, '#3d4349', [-0.18, 0.85, z], undefined, 0.01);
    p.box(0.04, 0.12, 0.22, '#ff3b30', [0.0, 0.98, z * 1.4], undefined, 0.01);
  }
  // chassis + suspension + landing gear
  for (const z of [-0.5, 0.5]) p.box(TL - 0.4, 0.22, 0.14, '#2b2f34', [-TL / 2 - 0.1, 0.98, z], undefined, 0.01);
  for (const x of [-1.6, -2.9]) {
    wheel(p, x, 1.06);
    wheel(p, x, 0.74);
    wheel(p, x, -1.06);
    wheel(p, x, -0.74);
    p.box(0.12, 0.12, 2.0, '#2b2f34', [x, 0.5, 0], undefined, 0.01);
  }
  for (const z of [-1.1, 1.1]) p.box(0.02, 0.5, 0.4, '#1b1c1e', [-1.05, 0.5, z], undefined, 0);
  for (const z of [-0.7, 0.7]) {
    p.box(0.1, 0.85, 0.1, '#3d4349', [-7.6, 0.55, z], undefined, 0.01);
    p.box(0.3, 0.04, 0.3, '#3d4349', [-7.6, 0.02, z], undefined, 0.005);
  }
  // amber side markers
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) p.box(0.08, 0.05, 0.02, '#ffae00', [-1 - i * 2, 1.35, z * (TW / 2 + 0.01)], undefined, 0);

  // tractor (cab at the far -x end, facing -x)
  const cx0 = -TL - 0.2; // back of cab area
  p.box(4.4, 0.3, 1.0, '#26292d', [cx0 - 1.2, 0.85, 0], undefined, 0.02);
  p.box(2.3, 2.45, TW - 0.06, cab, [cx0 - 2.3, 2.3, 0], undefined, 0.16);
  p.box(1.5, 0.75, TW - 0.2, cab, [cx0 - 1.75, 3.85, 0], undefined, 0.2);
  p.box(0.06, 0.85, TW - 0.5, '#1a2632', [cx0 - 3.43, 2.75, 0], [0, 0, -0.08], 0.02);
  for (const z of [-1, 1]) p.box(0.8, 0.6, 0.04, '#1a2632', [cx0 - 2.85, 2.8, z * (TW / 2 - 0.02)], undefined, 0.02);
  // grille + bumper + lights
  p.box(0.08, 0.8, 1.3, '#c9cfd5', [cx0 - 3.47, 1.55, 0], undefined, 0.02);
  for (let i = 0; i < 6; i++) p.box(0.09, 0.03, 1.2, '#4b525b', [cx0 - 3.47, 1.25 + i * 0.12, 0], undefined, 0);
  p.box(0.25, 0.3, TW - 0.1, '#b9c0c7', [cx0 - 3.48, 0.75, 0], undefined, 0.05);
  for (const z of [-0.95, 0.95]) p.box(0.04, 0.16, 0.3, '#fff3c4', [cx0 - 3.5, 1.15, z], undefined, 0.02);
  // fuel tanks, steps, exhausts, mirrors, fifth wheel
  for (const z of [-1, 1]) {
    p.cylX(0.32, 1.1, '#c9cfd5', [cx0 - 0.6, 0.75, z * 0.95], 18);
    p.cyl(0.07, 0.07, 1.9, '#d6dbe0', [cx0 - 1.0, 3.0, z * 1.05], undefined, 12);
    p.box(0.06, 0.4, 0.06, '#2b2f34', [cx0 - 3.25, 2.9, z * 1.35], undefined, 0.01);
    p.box(0.04, 0.32, 0.14, '#2b2f34', [cx0 - 3.25, 2.95, z * 1.42], undefined, 0.01);
  }
  p.cyl(0.6, 0.6, 0.08, '#2b2f34', [cx0 + 1.0, 1.14, 0], undefined, 20);
  wheel(p, cx0 - 2.75, 1.05, 0.52, 0.32);
  wheel(p, cx0 - 2.75, -1.05, 0.52, 0.32);
  for (const x of [cx0 + 0.6, cx0 + 1.6]) for (const z of [1.06, 0.74, -0.74, -1.06]) wheel(p, x, z);
  const g = p.build();
  geoCache.set(kind, g);
  return g;
}

const parts = lazy(() => {
  const door = new Parts();
  const h = ROOF - TRUCK_DECK_Y - 0.15;
  door.box(0.03, h, TW - 0.2, '#e7eaed', [0, -h / 2, 0], undefined, 0);
  for (let i = 1; i < 9; i++) door.box(0.04, 0.025, TW - 0.2, '#c3c9cf', [0.01, -(i * h) / 9, 0], undefined, 0);
  door.box(0.05, 0.05, 0.4, '#3d4349', [0.03, -h + 0.12, 0], undefined, 0.01);
  const label = new Parts()
    .panel(TL - 1.0, ROOF - TRUCK_DECK_Y - 0.5, [-TL / 2, (ROOF + TRUCK_DECK_Y) / 2, TW / 2 + 0.006], 0)
    .panel(TL - 1.0, ROOF - TRUCK_DECK_Y - 0.5, [-TL / 2, (ROOF + TRUCK_DECK_Y) / 2, -TW / 2 - 0.006], Math.PI);
  return { door: door.build(), doorH: h, label: label.build() };
});

/** Pallet slot centres inside the trailer (front first), truck-local [x, y, z]. */
export function truckPalletSlot(k: number): [number, number, number] {
  const row = Math.floor(k / 2);
  const col = k % 2;
  return [-TL + 0.75 + row * 1.25, TRUCK_DECK_Y + 0.01, (col - 0.5) * 1.18];
}

const _m = new Matrix4();

export type TruckProps = ThreeElements['group'] & { anim: TruckAnim; kind: TruckKind; label: string };

/**
 * Semi-trailer truck (~12.9 m). The REAR loading door is at local x = 0 and the body extends to
 * -x (cab at the far -x end), so for a dock on the east wall rotate by PI, west wall rotation 0.
 * Trailer deck at TRUCK_DECK_Y. Roll-up door opens with anim.doorOpen; up to 14 pallets inside.
 * Draw calls: 5 (+3 shadow).
 */
export function Truck({ anim, kind, label, ...props }: TruckProps) {
  const body = truckGeometry(kind);
  const pp = parts();
  const door = useRef<Group>(null);
  const pallets = useRef<InstancedMesh>(null);
  const loads = useRef<InstancedMesh>(null);
  const labelMat = useMemo(() => {
    const color = CAB_COLOR[kind];
    const map = labelTexture(label, {
      bg: '#f3f4f5',
      fg: color,
      stripe: color,
      width: 1024,
      height: 256,
      sub: kind === 'inbound' ? 'MATERIALS · INBOUND FREIGHT' : 'FINISHED GOODS · OUTBOUND',
      size: 0.36,
    });
    return new MeshStandardMaterial({ map, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 });
  }, [label, kind]);
  useEffect(() => () => labelMat.dispose(), [labelMat]);

  const inbound = kind === 'inbound';
  useLayoutEffect(() => {
    for (const im of [pallets.current, loads.current]) {
      if (!im) continue;
      for (let k = 0; k < MAX_PALLETS; k++) {
        const [x, y, z] = truckPalletSlot(k);
        im.setMatrixAt(k, _m.makeTranslation(x, y, z));
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }, [inbound]);

  useFrame(() => {
    if (!door.current || !pallets.current || !loads.current) return;
    const o = clamp01(anim.doorOpen);
    door.current.scale.y = 1 - 0.93 * o;
    const n = Math.max(0, Math.min(MAX_PALLETS, Math.round(anim.pallets)));
    pallets.current.count = inbound ? 0 : n;
    loads.current.count = n;
    pallets.current.visible = !inbound && n > 0;
    loads.current.visible = n > 0;
  });

  return (
    <group {...props}>
      <mesh geometry={body} material={paintMat} castShadow receiveShadow />
      <mesh geometry={pp.label} material={labelMat} />
      <group ref={door} position={[-0.02, ROOF - 0.12, 0]}>
        <mesh geometry={pp.door} material={paintMat} />
      </group>
      <instancedMesh ref={pallets} args={[palletGeometry, palletMat, MAX_PALLETS]} visible={false} />
      <instancedMesh
        key={kind}
        ref={loads}
        args={[inbound ? materialLotGeometry : fullCartonLoadGeometry(), inbound ? materialLotMat : cartonMat, MAX_PALLETS]}
        visible={false}
      />
    </group>
  );
}
