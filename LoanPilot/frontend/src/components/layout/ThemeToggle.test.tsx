import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePreferences } from '@/test/fixtures';
import { json, mockApi } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { ThemeToggle } from './ThemeToggle';

const html = () => document.documentElement;

function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ThemeToggle', () => {
  it('switches to dark, applies the class, and persists to the API and localStorage', async () => {
    const api = mockApi({ 'GET /api/loans': json([]) });
    const { user } = renderWithProviders(<ThemeToggle />);
    await waitFor(() => expect(api.callsTo('GET /api/preferences')).toHaveLength(1));
    expect(html()).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: /Change theme/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));

    expect(html()).toHaveClass('dark');
    expect(window.localStorage.getItem('loanpilot.theme')).toBe('dark');
    await waitFor(() => expect(api.callsTo('PUT /api/preferences')).toHaveLength(1));
    expect(api.callsTo('PUT /api/preferences')[0].body).toEqual(makePreferences({ theme: 'dark' }));

    await user.click(screen.getByRole('button', { name: /Change theme/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Light' }));
    expect(html()).not.toHaveClass('dark');
    expect(window.localStorage.getItem('loanpilot.theme')).toBe('light');
  });

  it('applies the theme stored in server preferences', async () => {
    mockApi({ 'GET /api/loans': json([]), 'GET /api/preferences': json(makePreferences({ theme: 'dark' })) });
    renderWithProviders(<ThemeToggle />);
    await waitFor(() => expect(html()).toHaveClass('dark'));
    expect(window.localStorage.getItem('loanpilot.theme')).toBe('dark');
  });

  it('follows the system setting when the theme is "system"', async () => {
    stubSystemDark(true);
    mockApi({ 'GET /api/loans': json([]) });
    renderWithProviders(<ThemeToggle />);
    await waitFor(() => expect(html()).toHaveClass('dark'));
    expect(screen.getByRole('button', { name: 'Theme: system. Change theme' })).toBeInTheDocument();
  });

  it('falls back to localStorage when the API is unreachable', async () => {
    window.localStorage.setItem('loanpilot.theme', 'dark');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { user } = renderWithProviders(<ThemeToggle />);
    expect(html()).toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: /Change theme/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Light' }));
    expect(html()).not.toHaveClass('dark');
    expect(window.localStorage.getItem('loanpilot.theme')).toBe('light');
  });
});
