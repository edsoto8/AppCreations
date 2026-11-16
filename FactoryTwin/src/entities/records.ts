import type {
  HistoryEntry,
  MaterialId,
  PalletLocation,
  Priority,
  ProductLocation,
  ProductStage,
  ProductType,
  QualityStatus,
} from '../simulation/types';

export interface Product {
  id: string;
  num: number;
  type: ProductType;
  orderId: string;
  stage: ProductStage;
  quality: QualityStatus;
  /** True while the unit is travelling to / being processed in rework. */
  rework: boolean;
  /** True once the unit has been reworked (a second reject scraps it). */
  reworked: boolean;
  cellIndex: number;
  location: ProductLocation;
  releasedAt: number;
  stageTimes: Partial<Record<ProductStage, number>>;
  cost: number;
  history: HistoryEntry[];
}

export interface Order {
  id: string;
  num: number;
  type: ProductType;
  qty: number;
  priority: Priority;
  createdAt: number;
  dueAt: number;
  /** Units still to release (replacements for scrap are added back here). */
  toRelease: number;
  released: number;
  scrapped: number;
  packed: number;
  palletized: number;
  pallets: string[];
  palletsStored: number;
  state: 'open' | 'complete' | 'shipping' | 'shipped';
  completeAt: number | null;
  shippedAt: number | null;
  surge: boolean;
}

export interface Pallet {
  id: string;
  orderId: string;
  type: ProductType;
  productIds: string[];
  location: PalletLocation;
  /** Build position, FG slot, bay, or -1. */
  slot: number;
  vehicleId: string | null;
  closed: boolean;
  lastTouch: number;
}

export interface MaterialLot {
  id: string;
  material: MaterialId;
  qty: number;
  bay: number;
  expedited: boolean;
}

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export function addHistory(h: HistoryEntry[], t: number, text: string, max = 60): void {
  h.push({ t, text });
  if (h.length > max) h.splice(0, h.length - max);
}
