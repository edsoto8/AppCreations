/** React access to the single GameController instance (provided in main.tsx). */
import { createContext, useContext } from 'react';
import type { GameController } from './controller';

export const GameControllerContext = createContext<GameController | null>(null);

export function useGameController(): GameController {
  const controller = useContext(GameControllerContext);
  if (!controller) throw new Error('useGameController must be used inside <GameControllerContext.Provider>');
  return controller;
}
