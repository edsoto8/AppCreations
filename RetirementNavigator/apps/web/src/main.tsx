import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import { App } from './app/App';
import { applyTheme, followSystemTheme, useSettingsStore } from './state/settingsStore';

applyTheme(useSettingsStore.getState().theme);
followSystemTheme(() => useSettingsStore.getState().theme);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
