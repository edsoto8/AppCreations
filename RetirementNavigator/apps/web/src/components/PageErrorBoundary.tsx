import { Component, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Keeps the app shell usable when a page fails: a code-split page that cannot load (for example
 * after the app was updated while this tab stayed open) or an unexpected error while rendering.
 * Shows what happened and offers a reload instead of a blank screen. Nothing is sent anywhere.
 */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const loadFailed = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
      error.message,
    );
    return (
      <div role="alert" className="mx-auto flex max-w-xl flex-col gap-3 rounded-lg border border-destructive p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <TriangleAlert aria-hidden="true" className="size-5 text-destructive" />
          {loadFailed ? 'This page could not be loaded' : 'Something went wrong on this page'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {loadFailed
            ? 'The app may have been updated while this tab was open. Reloading fetches the current version; your data stays on this device.'
            : 'Your data on this device is unchanged. Reloading usually fixes this; other pages still work from the menu.'}
        </p>
        <div>
          <Button onClick={() => window.location.reload()}>
            <RotateCcw aria-hidden="true" /> Reload
          </Button>
        </div>
      </div>
    );
  }
}
