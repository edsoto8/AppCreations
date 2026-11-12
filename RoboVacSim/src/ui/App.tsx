import { Component, memo, type ErrorInfo, type ReactNode } from 'react';
import { EventLog, Toasts } from './EventLog';
import { useApi, useHistoryFeed, useMediaQuery } from './hooks';
import { MapPanel } from './map/MapPanel';
import { HelpOverlay, InspectorCard, PerfOverlay, ViewportHint } from './Overlays';
import { Sidebar } from './Sidebar';
import { TelemetryCards } from './Telemetry';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

function BootOverlay() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot-ring" aria-hidden="true" />
      <div className="boot-text">
        <strong>Initialising simulation</strong>
        <span>Building the house, sensors and 3D scene…</span>
      </div>
    </div>
  );
}

const Strip = memo(function Strip() {
  return (
    <footer className="strip" aria-label="Live telemetry">
      <TelemetryCards />
      <EventLog />
    </footer>
  );
});

/**
 * Dashboard root. `viewport` is the 3D canvas host created by <AppProvider>; it is always rendered at
 * the same tree position (only siblings change between desktop and mobile) so the controller's
 * canvas is never remounted.
 */
export function App({ viewport }: { viewport: ReactNode }) {
  const api = useApi();
  const mobile = useMediaQuery('(max-width: 899px)');
  useShortcuts(api);
  useHistoryFeed();
  return (
    <div className={`app ${mobile ? 'is-mobile' : 'is-desktop'}`}>
      <TopBar />
      <main className="stage" aria-label="3D simulation view">
        <div className="viewport-wrap">
          {viewport}
          {!api && <BootOverlay />}
          <div className="viewport-overlay">
            <ViewportHint />
            <Toasts />
            <InspectorCard />
            <PerfOverlay />
            {!mobile && <MapPanel variant="card" />}
          </div>
        </div>
      </main>
      <Sidebar mobile={mobile} />
      {!mobile && <Strip />}
      <HelpOverlay />
    </div>
  );
}

/** Top-level error boundary: a renderer/controller failure shows a readable screen, not a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AURA-X1] UI crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <div className="fatal-card">
          <h1>Something went wrong</h1>
          <p>The simulator hit an unexpected error and stopped.</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
