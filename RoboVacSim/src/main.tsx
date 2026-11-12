import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/AppProvider';
import { App, ErrorBoundary } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>{(viewport) => <App viewport={viewport} />}</AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
