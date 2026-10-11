import { useMemo } from 'react';
import { useGameController } from '../../game';
import { buildBuildingDetail, buildSettlerDetail, useUiStore, type BuildingDetail, type SettlerDetail } from '../../store';

/**
 * Live detail for the selected settler. Uses the snapshot's `selectedSettler` when the controller
 * built one for this id, otherwise builds it from the controller's state (plain data either way).
 * Returns null when the settler is gone.
 */
export function useSelectedSettler(id: number): SettlerDetail | null {
  const controller = useGameController();
  const snapshot = useUiStore((s) => s.snapshot);
  return useMemo(
    () => (snapshot?.selectedSettler?.id === id ? snapshot.selectedSettler : buildSettlerDetail(controller.getState(), id)),
    [snapshot, id, controller],
  );
}

export function useSelectedBuilding(id: number): BuildingDetail | null {
  const controller = useGameController();
  const snapshot = useUiStore((s) => s.snapshot);
  return useMemo(
    () => (snapshot?.selectedBuilding?.id === id ? snapshot.selectedBuilding : buildBuildingDetail(controller.getState(), id)),
    [snapshot, id, controller],
  );
}
