import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './App';
import { NAV_ITEMS } from './navigation';
import { DISCLAIMER_TEXT } from '@/components/Disclaimer';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('renders the sidebar with every section, a skip link and the disclaimer', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const item of NAV_ITEMS) expect(within(nav).getByRole('link', { name: item.label })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
  });

  it('builds every section: no placeholder remains (the calculators were the last, M7a)', () => {
    renderAt('/calculators');
    expect(screen.getByRole('heading', { level: 1, name: 'Calculators' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Roth vs traditional/ })).toHaveAttribute(
      'href',
      '/calculators?c=rothVsTraditional',
    );
    expect(screen.queryByText(/Planned for/)).not.toBeInTheDocument();
  });

  it('renders the dashboard at the root route', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('No profile yet')).toBeInTheDocument();
  });

  it('navigates between sections and marks the active link', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(nav).getByRole('link', { name: 'Data & Privacy' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Data & Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/not encrypted/)).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Data & Privacy' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders a not-found page for unknown routes', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('switches theme with the toggle', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('radio', { name: 'Dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('rn-theme')).toBe('dark');
    await user.click(screen.getByRole('radio', { name: 'Light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('opens the mobile navigation drawer', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('link', { name: 'Accounts' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
  });

  it('skip link focuses the main content without navigating', async () => {
    const user = userEvent.setup();
    renderAt('/accounts');
    await user.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(document.getElementById('main')).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
  });

  it('sets the document title per route', async () => {
    const user = userEvent.setup();
    renderAt('/');
    expect(document.title).toBe('Dashboard · Retirement Navigator');
    await user.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'HSA' }));
    expect(document.title).toBe('HSA · Retirement Navigator');
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('labels each navigation group', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('list', { name: 'Plan' })).toBeInTheDocument();
    expect(within(nav).getByRole('list', { name: 'Tools' })).toBeInTheDocument();
  });
});
