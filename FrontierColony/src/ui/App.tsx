import { GameCanvas } from './GameCanvas';
import { TopBar } from './TopBar';

/** App shell: the canvas fills the viewport; React UI is overlaid on top. */
export function App() {
  return (
    <div className="app">
      <GameCanvas />
      <TopBar />
    </div>
  );
}
