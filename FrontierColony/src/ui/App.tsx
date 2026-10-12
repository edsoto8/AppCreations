import { useEffect } from 'react';
import { useUiStore } from '../store';
import { ToastHost } from './components/Toasts';
import { GameCanvas } from './GameCanvas';
import { PauseFrame, PauseIndicator } from './hud/PauseIndicator';
import { Toolbar } from './hud/Toolbar';
import { TopBar } from './hud/TopBar';
import { parseQuickstart } from './lib/quickstart';
import { useGameFlow } from './lib/useGameFlow';
import { useHotkeys } from './lib/useHotkeys';
import { usePrefsSync, useUiScale } from './lib/usePrefsSync';
import { GameMenu } from './menu/GameMenu';
import { MainMenu } from './menu/MainMenu';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HaltedBanner } from './hud/HaltedBanner';
import { DecisionHost } from './hud/DecisionHost';
import { HoverCard } from './hud/HoverCard';
import { Minimap } from './hud/Minimap';
import { OverlayToggle } from './hud/OverlayToggle';
import { TourHost } from './hud/TourHost';
import { ObjectivesTracker } from './hud/ObjectivesTracker';
import { WarningsStrip } from './hud/WarningsStrip';
import { GameOverOverlay } from './menu/GameOverOverlay';
import { PlacementBar } from './hud/PlacementBar';
import { BuildingInspector } from './panels/BuildingInspector';
import { SettlerInspector } from './panels/SettlerInspector';
import { PanelHost } from './panels/PanelHost';

/** HUD for a running game: top bar, side panels, toolbar, toasts, pause indicator, Esc menu. */
function InspectorHost() {
  const kind = useUiStore((s) => s.selection?.kind ?? null);
  const id = useUiStore((s) => (s.selection && s.selection.kind !== 'tile' ? s.selection.id : null));
  if (id === null) return null;
  return kind === 'settler' ? <SettlerInspector key={id} id={id} /> : kind === 'building' ? <BuildingInspector key={id} id={id} /> : null;
}

function GameUi() {
  return (
    <>
      <div className="ui-layer hud-grid">
        <TopBar />
        <div className="hud-middle">
          <div className="hud-top-center">
            <HaltedBanner />
            <WarningsStrip />
            <PlacementBar />
            <PauseIndicator />
          </div>
          <PauseFrame />
          <PanelHost />
          <InspectorHost />
          <div className="left-dock">
            <ObjectivesTracker />
            <OverlayToggle />
            <Minimap />
          </div>
          <DecisionHost />
        </div>
        <Toolbar />
      </div>
      <GameOverOverlay />
      <GameMenu />
    </>
  );
}

/** The canvas fills the viewport; React UI is overlaid on top, scaled by the UI size preference. */
function AppShell() {
  const screen = useUiStore((s) => s.screen);
  const scale = useUiScale();
  useHotkeys();
  usePrefsSync();
  const flow = useGameFlow();
  useEffect(() => {
    // `?quickstart` skips the menu (dev and e2e).
    const options = parseQuickstart(window.location.search);
    if (options) flow.startNewGame(options);
  }, [flow]);
  return (
    <div className="app" data-testid="app">
      <GameCanvas />
      <div className="ui-scale" style={{ ['--s' as string]: scale }}>
        {screen === 'mainMenu' ? <MainMenu /> : <GameUi />}
        {/* Above menus and dialogs, so save/load feedback is never hidden behind a scrim. */}
        <div className={`ui-layer toast-layer ${screen === 'playing' ? 'toast-layer--game' : ''}`}>
          <ToastHost />
        </div>
      </div>
      {screen === 'playing' && <HoverCard />}
      <TourHost />
    </div>
  );
}

/** App root. Any render error shows the recovery screen instead of a blank page. */
export function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
