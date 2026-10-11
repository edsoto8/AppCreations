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
// The handle exposes the live, mutable game: install it only for development, for the e2e build
// (`VITE_E2E=1`, set by playwright.config.ts) or when the player opts in with `?debug`.
if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1' || new URLSearchParams(window.location.search).has('debug')) {
  window.__frontierColony = controller;
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing');

createRoot(rootElement).render(
  <StrictMode>
    <GameControllerContext.Provider value={controller}>
      <App />
    </GameControllerContext.Provider>
  </StrictMode>,
);
