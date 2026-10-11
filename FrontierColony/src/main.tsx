import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameController, GameControllerContext, getBrowserStorage } from './game';
import { createRenderer } from './render';
import { uiStore } from './store';
import { App } from './ui/App';
import './styles/global.css';

const controller = new GameController({
  store: uiStore,
  storage: getBrowserStorage(),
  createRenderer,
});

declare global {
  interface Window {
    /** Debug / e2e handle: read state, advance ticks, issue commands from the console or Playwright. */
    __frontierColony?: GameController;
  }
}
window.__frontierColony = controller;

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

createRoot(rootElement).render(
  <StrictMode>
    <GameControllerContext.Provider value={controller}>
      <App />
    </GameControllerContext.Provider>
  </StrictMode>,
);
