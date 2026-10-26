import './styles.css';
import { App } from './App';

const app = new App(document.getElementById('stage')!, document.getElementById('app')!);
app.init().catch((err: unknown) => {
  console.error(err);
  const loader = document.getElementById('loader');
  loader?.classList.add('error');
  const title = loader?.querySelector('.loader-title');
  if (title) title.textContent = 'Could not build the fox';
  const stage = document.getElementById('loader-stage');
  if (stage) stage.textContent = err instanceof Error ? err.message : String(err);
});

// Release GPU resources when Vite hot-reloads this module.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
