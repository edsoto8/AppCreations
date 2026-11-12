import { create } from 'zustand';
import type { SimSpeed } from '../sim/core/clock';
import type { LogEntry } from '../sim/Simulation';
import type { Telemetry } from '../sim/telemetry';
import type { DirtKind, FurnitureKind, ObstacleKind } from '../sim/world/types';
import type { CameraMode, EduTopic, InspectedPart, MissionDraft, Overlays, PerfStats, PresetId, Quality, Selection, Tool, WallMode } from './types';

export interface RoomInfo {
  id: string;
  name: string;
  floor: string;
  area: number;
  cx: number;
  cy: number;
}

/**
 * Shared UI state. The AppController writes `telemetry`, `logs`, `perf`, `rooms` at a throttled rate
 * (~8 Hz) and subscribes to the UI-controlled fields to update the renderer. Components should select
 * narrow slices (e.g. useStore(s => s.telemetry?.battery)) to avoid needless re-renders.
 */
export interface UiState {
  // ---- written by the controller
  telemetry: Telemetry | null;
  logs: LogEntry[];
  perf: PerfStats | null;
  rooms: RoomInfo[];
  layoutName: string;
  /** Bumped whenever the layout changes (edits/reset). */
  layoutVersion: number;
  hoverInfo: string | null;

  // ---- scenario
  preset: PresetId;
  seed: number;

  // ---- mission draft + live settings
  draft: MissionDraft;
  speed: SimSpeed;

  // ---- view
  cameraMode: CameraMode;
  wallMode: WallMode;
  quality: Quality;
  overlays: Overlays;
  explode: number;
  xray: boolean;
  dockPanels: number;
  dockCutaway: boolean;
  dustbinOpen: boolean;

  // ---- editor
  tool: Tool;
  obstacleKind: ObstacleKind;
  furnitureKind: FurnitureKind;
  spillKind: DirtKind;
  selection: Selection | null;
  inspected: InspectedPart | null;

  // ---- education
  eduEnabled: boolean;
  eduTopic: EduTopic;
  eduStep: number;

  // ---- panels / layout
  sidebarTab: 'mission' | 'environment' | 'view' | 'engineering';
  manualVacuum: boolean;
  /** Toast notification. */
  toast: { id: number; text: string; level: 'info' | 'warn' | 'error' | 'success' } | null;

  set: (patch: Partial<UiState>) => void;
  setDraft: (patch: Partial<MissionDraft>) => void;
  setOverlay: <K extends keyof Overlays>(key: K, value: Overlays[K]) => void;
  notify: (text: string, level?: 'info' | 'warn' | 'error' | 'success') => void;
}

let toastId = 1;

export const useStore = create<UiState>((set) => ({
  telemetry: null,
  logs: [],
  perf: null,
  rooms: [],
  layoutName: '',
  layoutVersion: 0,
  hoverInfo: null,
  preset: 'family',
  seed: 1337,
  draft: { kind: 'whole', cleanMode: 'vacuumMop', suction: 'standard', water: 'medium', passes: 1, rooms: [], spot: null },
  speed: 5,
  cameraMode: 'isometric',
  wallMode: 'cutaway',
  quality: 'high',
  overlays: {
    dirt: 'realistic',
    coverage: false,
    lidarRays: true,
    pointCloud: true,
    path: true,
    trail: true,
    costmap: false,
    zones: true,
    roomLabels: true,
    sensors: false,
    perf: false,
  },
  explode: 0,
  xray: false,
  dockPanels: 0,
  dockCutaway: false,
  dustbinOpen: false,
  tool: 'none',
  obstacleKind: 'box',
  furnitureKind: 'chair',
  spillKind: 'crumbs',
  selection: null,
  inspected: null,
  eduEnabled: false,
  eduTopic: 'lidar',
  eduStep: 0,
  sidebarTab: 'mission',
  manualVacuum: false,
  toast: null,
  set: (patch) => set(patch),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  setOverlay: (key, value) => set((s) => ({ overlays: { ...s.overlays, [key]: value } })),
  notify: (text, level = 'info') => set({ toast: { id: toastId++, text, level } }),
}));
