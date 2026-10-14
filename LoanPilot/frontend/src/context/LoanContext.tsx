import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLoans } from '@/api/queries';
import type { LoanListItem } from '@/api/types';
import { readStorage, STORAGE_KEYS } from '@/lib/storage';
import { usePreferences } from './PreferencesContext';

interface LoanContextValue {
  /** Active (non-archived) loans from GET /loans. */
  loans: LoanListItem[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** The loan every page works on; null when there are no loans. */
  selectedLoanId: number | null;
  selectedLoan: LoanListItem | null;
  setSelectedLoanId: (id: number | null) => void;
}

const LoanContext = createContext<LoanContextValue | null>(null);

function storedLoanId(): number | null {
  const n = Number(readStorage(STORAGE_KEYS.selectedLoanId));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Holds the selected loan id. Starts from localStorage, uses preferences.selectedLoanId from the
 * server when localStorage has nothing, falls back to the first active loan when the selection no
 * longer exists, and persists every change to preferences (PUT /preferences) + localStorage.
 */
export function LoanProvider({ children }: { children: ReactNode }) {
  const { preferences, isServerBacked, isLoading: prefsLoading, updatePreferences } = usePreferences();
  const loansQuery = useLoans(false);
  const [requestedId, setRequestedId] = useState<number | null>(storedLoanId);

  // localStorage wins; otherwise use the server's remembered selection once it has loaded.
  const candidateId = requestedId ?? (isServerBacked ? preferences.selectedLoanId : null);

  const loans = useMemo(() => loansQuery.data ?? [], [loansQuery.data]);
  const settled = loansQuery.isSuccess && !loansQuery.isFetching && !prefsLoading;

  const selectedLoanId = useMemo(() => {
    if (candidateId !== null && loans.some((l) => l.loan.id === candidateId)) return candidateId;
    if (!settled) return candidateId;
    return loans[0]?.loan.id ?? null;
  }, [settled, loans, candidateId]);

  const setSelectedLoanId = useCallback(
    (id: number | null) => {
      setRequestedId(id);
      void updatePreferences({ selectedLoanId: id });
    },
    [updatePreferences],
  );

  // Persist an automatic fallback (deleted/archived selection → first loan) once everything has loaded.
  useEffect(() => {
    if (settled && selectedLoanId !== candidateId) setSelectedLoanId(selectedLoanId);
  }, [settled, selectedLoanId, candidateId, setSelectedLoanId]);

  const selectedLoan = useMemo(
    () => loans.find((l) => l.loan.id === selectedLoanId) ?? null,
    [loans, selectedLoanId],
  );

  const value = useMemo<LoanContextValue>(
    () => ({
      loans,
      isLoading: loansQuery.isPending,
      isError: loansQuery.isError,
      error: loansQuery.error,
      selectedLoanId,
      selectedLoan,
      setSelectedLoanId,
    }),
    [loans, loansQuery.isPending, loansQuery.isError, loansQuery.error, selectedLoanId, selectedLoan, setSelectedLoanId],
  );

  return <LoanContext.Provider value={value}>{children}</LoanContext.Provider>;
}

export function useLoanContext(): LoanContextValue {
  const ctx = useContext(LoanContext);
  if (!ctx) throw new Error('useLoanContext must be used inside <LoanProvider>');
  return ctx;
}
