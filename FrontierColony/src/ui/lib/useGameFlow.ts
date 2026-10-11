import { useMemo } from 'react';
import { useGameController } from '../../game';
import { uiStore } from '../../store';
import { createGameFlow, type GameFlow } from './gameFlow';

/** Screen-flow actions bound to the app's controller and store. */
export function useGameFlow(): GameFlow {
  const controller = useGameController();
  return useMemo(() => createGameFlow(controller, uiStore), [controller]);
}
