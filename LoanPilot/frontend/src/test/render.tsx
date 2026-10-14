import type { ReactElement, ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, useLocation } from 'react-router';
import { AppProviders } from '@/AppProviders';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  });
}

interface RenderOptions {
  /** Initial URL. */
  route?: string;
  /** <Route> elements; when given, `ui` is ignored and these are rendered inside <Routes>. */
  routes?: ReactNode;
  queryClient?: QueryClient;
}

/** Renders inside MemoryRouter + the full provider stack (query client, preferences, theme, loans). */
export function renderWithProviders(ui: ReactElement | null, { route = '/', routes, queryClient = createTestQueryClient() }: RenderOptions = {}) {
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders queryClient={queryClient}>
        {routes ? <Routes>{routes}</Routes> : ui}
        <LocationProbe />
      </AppProviders>
    </MemoryRouter>,
  );
  return { ...result, user, queryClient };
}

/** Exposes the current pathname for navigation assertions: screen.getByTestId('location'). */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location" hidden>
      {location.pathname}
    </div>
  );
}
