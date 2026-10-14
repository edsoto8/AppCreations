import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getPreferences, updatePreferences as putPreferences } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import type { Preferences, ThemePreference } from '@/api/types';
import { DEFAULT_CURRENCY } from '@/lib/format';
import { readStorage, STORAGE_KEYS, writeStorage } from '@/lib/storage';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Preferences used until (or unless) the API answers: localStorage values over built-in defaults. */
export function localPreferences(): Preferences {
  const theme = readStorage(STORAGE_KEYS.theme);
  const selected = Number(readStorage(STORAGE_KEYS.selectedLoanId));
  return {
    theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : 'system',
    currency: readStorage(STORAGE_KEYS.currency) || DEFAULT_CURRENCY,
    defaultAccrualMethod: 'monthly',
    selectedLoanId: Number.isInteger(selected) && selected > 0 ? selected : null,
    comparisonBudget: null,
  };
}

function mirrorToStorage(prefs: Preferences) {
  writeStorage(STORAGE_KEYS.theme, prefs.theme);
  writeStorage(STORAGE_KEYS.currency, prefs.currency);
  writeStorage(STORAGE_KEYS.selectedLoanId, prefs.selectedLoanId === null ? null : String(prefs.selectedLoanId));
}

interface PreferencesContextValue {
  preferences: Preferences;
  /** True once the server copy has loaded (false while loading or when the API is unreachable). */
  isServerBacked: boolean;
  isLoading: boolean;
  /** Merges the patch, applies it immediately, mirrors it to localStorage and PUTs the full object. */
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Raw context, for components that must also work outside the provider (they read it optionally). */
export const PreferencesContextInternal = PreferencesContext;

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.preferences,
    queryFn: async ({ signal }) => {
      const prefs = await getPreferences({ signal });
      mirrorToStorage(prefs);
      return prefs;
    },
    staleTime: Infinity,
    retry: false,
  });

  const preferences = useMemo(() => query.data ?? localPreferences(), [query.data]);

  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const current = qc.getQueryData<Preferences>(queryKeys.preferences) ?? localPreferences();
      const next: Preferences = { ...current, ...patch };
      mirrorToStorage(next);
      qc.setQueryData(queryKeys.preferences, next);
      try {
        const saved = await putPreferences(next);
        // Only adopt the server echo if nothing changed locally in the meantime.
        if (qc.getQueryData(queryKeys.preferences) === next) {
          qc.setQueryData(queryKeys.preferences, saved);
          mirrorToStorage(saved);
        }
        // The server formats currency into insight/warning text and reads the saved comparison budget,
        // so loan data must be refetched once those preferences are stored.
        if ('currency' in patch || 'comparisonBudget' in patch) {
          await qc.invalidateQueries({ queryKey: ['loans'] });
        }
      } catch {
        // API unavailable: the localStorage copy keeps the choice until the server is back.
      }
    },
    [qc],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ preferences, isServerBacked: query.isSuccess, isLoading: query.isPending, updatePreferences }),
    [preferences, query.isSuccess, query.isPending, updatePreferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}

/** The user's currency code (e.g. "USD"), for the format helpers. */
export function useCurrency(): string {
  return usePreferences().preferences.currency || DEFAULT_CURRENCY;
}
