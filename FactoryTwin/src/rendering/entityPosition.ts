import type { EntityRef } from '../simulation/types';
import type { SimRuntime } from './runtime';
import { palletPose, productPose, vehiclePose, workerPose, type P3 } from './positions';

const scratch: number[] = [];
const tmp: P3 = { x: 0, y: 0, z: 0, heading: 0 };

/** World position of any selectable entity at render time. Returns false if not visible. */
export function entityWorldPos(ref: EntityRef, rt: SimRuntime, out: P3): boolean {
  const t = rt.playback.renderTime;
  const ix = rt.index;
  const L = rt.layout;
  out.heading = 0;
  switch (ref.kind) {
    case 'station': {
      const [kind, n] = ref.id.split('-');
      const i = Number(n);
      let p: [number, number] | null = null;
      if (kind === 'cell') p = L.cells[i]?.robot ?? null;
      else if (kind === 'insp') p = L.inspection[i]?.pos ?? null;
      else if (ref.id === 'pack') p = L.packaging.center;
      else if (ref.id === 'pal') p = L.palletizer.center;
      if (!p) return false;
      out.x = p[0];
      out.y = 1;
      out.z = p[1];
      return true;
    }
    case 'conveyor': {
      const c = L.conveyors.find((x) => x.id === ref.id);
      if (!c) return false;
      const a = c.points[0];
      const b = c.points[c.points.length - 1];
      out.x = (a[0] + b[0]) / 2;
      out.y = 0.9;
      out.z = (a[1] + b[1]) / 2;
      return true;
    }
    case 'vehicle': {
      const v = ix.vehicles.get(ref.id);
      if (!v) return false;
      vehiclePose(v, t, out);
      out.y = 0.6;
      return true;
    }
    case 'worker': {
      const w = ix.workers.get(ref.id);
      if (!w || w.state === 'off-shift' || w.state === 'absent') return false;
      workerPose(w, t, out);
      out.y = 1;
      return true;
    }
    case 'product': {
      const p = ix.products.get(ref.id);
      if (!p) return false;
      return productPose(p, ix, L, t, out, scratch) !== null;
    }
    case 'pallet': {
      const pal = ix.snap?.pallets.find((x) => x.id === ref.id);
      if (!pal) return false;
      if (!palletPose(pal, ix, L, t, tmp)) return false;
      Object.assign(out, tmp);
      out.y += 0.6;
      return true;
    }
    case 'storage': {
      const r = ref.id === 'fg' ? L.fgRacks[0] : L.rawRacks[Number(ref.id.split('-')[1])];
      if (!r) return false;
      out.x = r.center[0];
      out.y = 1.5;
      out.z = r.center[1];
      return true;
    }
    default:
      return false;
  }
}
