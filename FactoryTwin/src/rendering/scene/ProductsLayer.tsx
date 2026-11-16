import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { InstancedMesh, Matrix4, Object3D, type BufferGeometry, type Material } from 'three';
import type { FactoryLayout } from '../../logistics/layout';
import { runtime } from '../runtime';
import { palletPose, productPose, type P3, type ProductVisual } from '../positions';
import {
  cartonGeometry,
  cartonMat,
  cartonStackOffsets,
  kitToteGeometry,
  palletGeometry,
  palletMat,
  productAGeometry,
  productAMat,
  productBGeometry,
  productBMat,
  reworkToteMat,
  toteMat,
} from '../models';
import { useUi } from '../../store';
import type { EntityRef } from '../../simulation/types';

const CAP = 600;
const dummy = new Object3D();
const hidden = new Matrix4().makeScale(0, 0, 0);

type Kind = ProductVisual | 'reworkTote';
const KINDS: Kind[] = ['A', 'B', 'carton', 'tote', 'reworkTote'];

function useInstanced(cap: number) {
  const ref = useRef<InstancedMesh>(null);
  const ids = useRef<string[]>([]);
  return { ref, ids, cap };
}

function hoverAndClick(ids: React.RefObject<string[]>, kind: EntityRef['kind'], label: (id: string) => string) {
  return {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const id = e.instanceId !== undefined ? ids.current?.[e.instanceId] : undefined;
      if (!id) return;
      document.body.style.cursor = 'pointer';
      useUi.getState().setHover({ ref: { kind, id }, label: label(id), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
      useUi.getState().setHover(null);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const id = e.instanceId !== undefined ? ids.current?.[e.instanceId] : undefined;
      if (id) useUi.getState().select({ kind, id });
    },
  };
}

const productLabel = (id: string) => {
  const p = runtime.current?.index.products.get(id);
  return p ? `${id} — product ${p.type}\n${p.stage}${p.rework ? ' (rework)' : ''}` : id;
};

/**
 * Every product in production is an instance (one InstancedMesh per visual kind), positioned
 * each frame from the snapshot location and the render time. Clicking selects the product.
 */
export function ProductsLayer({ layout }: { layout: FactoryLayout }) {
  const meshes = {
    A: useInstanced(CAP),
    B: useInstanced(CAP),
    carton: useInstanced(CAP),
    tote: useInstanced(CAP),
    reworkTote: useInstanced(CAP),
  } as Record<Kind, ReturnType<typeof useInstanced>>;
  const p3 = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  const scratch = useMemo<number[]>(() => [], []);
  const counts = useMemo(() => ({ A: 0, B: 0, carton: 0, tote: 0, reworkTote: 0 }) as Record<Kind, number>, []);

  useFrame(() => {
    const rt = runtime.current;
    const snap = rt?.index.snap;
    if (!rt || !snap) return;
    const t = rt.playback.renderTime;
    for (const k of KINDS) counts[k] = 0;
    for (const p of snap.products) {
      let vis: Kind | null = productPose(p, rt.index, layout, t, p3.current, scratch);
      if (!vis) continue;
      if (vis === 'tote' && p.rework) vis = 'reworkTote';
      const m = meshes[vis];
      const i = counts[vis];
      if (i >= m.cap || !m.ref.current) continue;
      dummy.position.set(p3.current.x, p3.current.y, p3.current.z);
      dummy.rotation.set(0, p3.current.heading - Math.PI / 2, 0);
      dummy.updateMatrix();
      m.ref.current.setMatrixAt(i, dummy.matrix);
      m.ids.current[i] = p.id;
      counts[vis] = i + 1;
    }
    for (const k of KINDS) {
      const mesh = meshes[k].ref.current;
      if (!mesh) continue;
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  });

  const geo: Record<Kind, [BufferGeometry, Material]> = {
    A: [productAGeometry, productAMat],
    B: [productBGeometry, productBMat],
    carton: [cartonGeometry, cartonMat],
    tote: [kitToteGeometry, toteMat],
    reworkTote: [kitToteGeometry, reworkToteMat],
  };
  return (
    <>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={meshes[k].ref}
          args={[geo[k][0], geo[k][1], CAP]}
          castShadow
          frustumCulled={false}
          {...hoverAndClick(meshes[k].ids, 'product', productLabel)}
        />
      ))}
    </>
  );
}

/** Pallets at the palletizer and in finished-goods racks (forklift loads are drawn by the forklift). */
export function PalletsLayer({ layout }: { layout: FactoryLayout }) {
  const pallets = useInstanced(200);
  const cartons = useRef<InstancedMesh>(null);
  const p3 = useRef<P3>({ x: 0, y: 0, z: 0, heading: 0 });
  const offsets = useMemo(() => cartonStackOffsets(24), []);
  useFrame(() => {
    const rt = runtime.current;
    const snap = rt?.index.snap;
    const pm = pallets.ref.current;
    const cm = cartons.current;
    if (!rt || !snap || !pm || !cm) return;
    let n = 0;
    let c = 0;
    for (const pal of snap.pallets) {
      if (pal.location !== 'palletizer' && pal.location !== 'fg') continue;
      if (!palletPose(pal, rt.index, layout, rt.playback.renderTime, p3.current)) continue;
      if (n >= pallets.cap) break;
      dummy.position.set(p3.current.x, p3.current.y, p3.current.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pm.setMatrixAt(n, dummy.matrix);
      pallets.ids.current[n] = pal.id;
      n++;
      for (let k = 0; k < pal.units && c < 4800; k++) {
        const o = offsets[k];
        dummy.position.set(p3.current.x + o[0], p3.current.y + o[1], p3.current.z + o[2]);
        dummy.updateMatrix();
        cm.setMatrixAt(c++, dummy.matrix);
      }
    }
    pm.count = n;
    cm.count = c;
    pm.instanceMatrix.needsUpdate = true;
    cm.instanceMatrix.needsUpdate = true;
    pm.computeBoundingSphere();
    void hidden;
  });
  const palletLabel = (id: string) => {
    const p = runtime.current?.index.snap?.pallets.find((x) => x.id === id);
    return p ? `${id} — order ${p.orderId}\n${p.units} × ${p.type} · ${p.location}` : id;
  };
  return (
    <>
      <instancedMesh ref={pallets.ref} args={[palletGeometry, palletMat, 200]} castShadow receiveShadow frustumCulled={false} {...hoverAndClick(pallets.ids, 'pallet', palletLabel)} />
      <instancedMesh ref={cartons} args={[cartonGeometry, cartonMat, 4800]} castShadow frustumCulled={false} raycast={() => null} />
    </>
  );
}
