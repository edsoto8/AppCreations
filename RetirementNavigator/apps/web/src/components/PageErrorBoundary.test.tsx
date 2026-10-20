import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageErrorBoundary } from './PageErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('PageErrorBoundary', () => {
  it('replaces a page whose code could not load with a reload prompt instead of a blank screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(
      <PageErrorBoundary resetKey="/accounts">
        <Boom message="Failed to fetch dynamically imported module: /assets/AccountsPage-x.js" />
      </PageErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be loaded');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('describes other errors, and clears when the route changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <PageErrorBoundary resetKey="/a">
        <Boom message="bad state" />
      </PageErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on this page');
    rerender(
      <PageErrorBoundary resetKey="/b">
        <p>Another page</p>
      </PageErrorBoundary>,
    );
    expect(screen.getByText('Another page')).toBeInTheDocument();
  });
});
