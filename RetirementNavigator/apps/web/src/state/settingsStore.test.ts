import { describe, expect, it, vi } from 'vitest';
import { applyTheme } from './settingsStore';

describe('applyTheme', () => {
  it('follows the system preference when set to system', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    applyTheme('system');
    expect(document.documentElement).toHaveClass('dark');
    spy.mockReturnValue({ matches: false } as MediaQueryList);
    applyTheme('system');
    expect(document.documentElement).not.toHaveClass('dark');
    spy.mockRestore();
  });

  it('still applies the theme when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    applyTheme('dark');
    expect(document.documentElement).toHaveClass('dark');
    spy.mockRestore();
  });
});
