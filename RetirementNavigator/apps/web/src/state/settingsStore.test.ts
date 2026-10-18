import { describe, expect, it, vi } from 'vitest';
import { applyTheme, followSystemTheme } from './settingsStore';

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

  it('follows live OS theme changes only in system mode', () => {
    let listener: (() => void) | undefined;
    let dark = false;
    const query = {
      get matches() {
        return dark;
      },
      addEventListener: (_: string, fn: () => void) => {
        listener = fn;
      },
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue(query);
    let theme: 'system' | 'light' = 'system';
    const stop = followSystemTheme(() => theme);
    dark = true;
    listener?.();
    expect(document.documentElement).toHaveClass('dark');
    theme = 'light';
    applyTheme('light');
    listener?.();
    expect(document.documentElement).not.toHaveClass('dark');
    stop();
    expect(query.removeEventListener).toHaveBeenCalled();
    spy.mockRestore();
  });
});
