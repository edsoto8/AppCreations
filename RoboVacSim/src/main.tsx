import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function Placeholder() {
  return <div style={{ color: '#ddd', padding: 24, fontFamily: 'system-ui' }}>RoboVac Sim — booting…</div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
);
