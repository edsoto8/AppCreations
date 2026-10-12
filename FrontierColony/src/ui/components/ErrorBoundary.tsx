import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearSavedData } from '../lib/recovery';

interface State {
  error: Error | null;
  confirmingReset: boolean;
  resetDone: boolean;
}

/**
 * Top-level safety net: if anything in the UI throws while rendering (for example a damaged save), show a
 * recovery screen instead of a blank page. It uses plain markup so it still works when the rest of the UI cannot.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, confirmingReset: false, resetDone: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Frontier Colony UI crashed', error, info.componentStack);
  }

  private reset = () => {
    try {
      clearSavedData(window.localStorage);
    } catch {
      clearSavedData(null);
    }
    this.setState({ confirmingReset: false, resetDone: true });
  };

  override render(): ReactNode {
    const { error, confirmingReset, resetDone } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="recovery" role="alert" data-testid="recovery">
        <div className="recovery__card glass">
          <h1 className="recovery__title">Something went wrong</h1>
          <p>Frontier Colony hit an unexpected error and had to stop. Your colony is not lost: reloading the page usually fixes it.</p>
          <p className="recovery__detail" data-testid="recovery-detail">
            {error.message || 'Unknown error'}
          </p>
          {resetDone && <p className="recovery__ok">Saved data was cleared. Reload to start fresh.</p>}
          {confirmingReset ? (
            <div className="recovery__confirm">
              <p>
                This deletes <strong>all saved games and settings</strong> stored in this browser. It cannot be undone.
              </p>
              <div className="recovery__actions">
                <button type="button" className="btn ghost" onClick={() => this.setState({ confirmingReset: false })} data-testid="recovery-cancel">
                  Keep my data
                </button>
                <button type="button" className="btn danger" onClick={this.reset} data-testid="recovery-confirm">
                  Delete saved data
                </button>
              </div>
            </div>
          ) : (
            <div className="recovery__actions">
              <button type="button" className="btn primary" onClick={() => window.location.reload()} data-testid="recovery-reload" autoFocus>
                Reload
              </button>
              <button type="button" className="btn" onClick={() => this.setState({ confirmingReset: true })} data-testid="recovery-reset">
                Reset saved data
              </button>
            </div>
          )}
          <p className="recovery__hint">If it keeps happening, resetting saved data clears a damaged save that may be the cause.</p>
        </div>
      </div>
    );
  }
}
