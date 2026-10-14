/**
 * localStorage access that never throws (private windows, blocked storage, SSR/tests).
 * Used only as a fallback/cache for preferences that the API persists.
 */
export const STORAGE_KEYS = {
  theme: 'loanpilot.theme',
  selectedLoanId: 'loanpilot.selectedLoanId',
  currency: 'loanpilot.currency',
  sidebarCollapsed: 'loanpilot.sidebarCollapsed',
} as const;

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the API copy still applies */
  }
}
