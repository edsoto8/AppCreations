import { create } from 'zustand';
import type { EntityRef, MetricsSnapshot } from './simulation/types';

export type CameraMode = 'orbit' | 'top' | 'focus' | 'follow';
export type PanelTab = 'dashboard' | 'inspector' | 'incidents' | 'experiments';

export const SPEEDS = [1, 2, 5, 10, 60, 300] as const;

/**
 * UI state only. Simulation state lives in the SimHost (outside React); the dashboard receives
 * throttled metric samples (<= 4 per second).
 */
export interface UiState {
  paused: boolean;
  speed: number;
  skipNight: boolean;
  selection: EntityRef | null;
  hover: { ref: EntityRef; label: string; x: number; y: number } | null;
  cameraMode: CameraMode;
  cameraNonce: number;
  tab: PanelTab;
  panelOpen: boolean;
  showPerf: boolean;
  metrics: MetricsSnapshot | null;
  clockLabel: string;
  simTime: number;
  scenarioName: string;
  scenarioId: string;
  seed: number;
  loading: boolean;
  setPaused(p: boolean): void;
  setSpeed(s: number): void;
  setSkipNight(v: boolean): void;
  select(ref: EntityRef | null): void;
  setHover(h: UiState['hover']): void;
  setCameraMode(m: CameraMode): void;
  setTab(t: PanelTab): void;
  setPanelOpen(o: boolean): void;
  setShowPerf(v: boolean): void;
  setMetrics(m: MetricsSnapshot | null, clock: string, t: number): void;
  setScenarioMeta(id: string, name: string, seed: number): void;
  setLoading(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  paused: false,
  speed: 5,
  skipNight: true,
  selection: null,
  hover: null,
  cameraMode: 'orbit',
  cameraNonce: 0,
  tab: 'dashboard',
  panelOpen: true,
  showPerf: false,
  metrics: null,
  clockLabel: '',
  simTime: 0,
  scenarioName: '',
  scenarioId: '',
  seed: 0,
  loading: true,
  setPaused: (paused) => set({ paused }),
  setSpeed: (speed) => set({ speed, paused: false }),
  setSkipNight: (skipNight) => set({ skipNight }),
  select: (selection) =>
    set((s) => ({
      selection,
      tab: selection ? 'inspector' : s.tab,
      panelOpen: selection ? true : s.panelOpen,
      cameraMode: !selection && (s.cameraMode === 'follow' || s.cameraMode === 'focus') ? 'orbit' : s.cameraMode,
    })),
  setHover: (hover) => set({ hover }),
  setCameraMode: (cameraMode) => set((s) => ({ cameraMode, cameraNonce: s.cameraNonce + 1 })),
  setTab: (tab) => set({ tab, panelOpen: true }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setShowPerf: (showPerf) => set({ showPerf }),
  setMetrics: (metrics, clockLabel, simTime) => set({ metrics, clockLabel, simTime }),
  setScenarioMeta: (scenarioId, scenarioName, seed) => set({ scenarioId, scenarioName, seed }),
  setLoading: (loading) => set({ loading }),
}));
