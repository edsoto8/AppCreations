import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPayment, deletePayment, getPaymentTracking, importPayments, listPayments } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import type { PaymentRecordInput } from '@/api/types';

export function usePayments(loanId: number | null) {
  return useQuery({
    queryKey: queryKeys.payments(loanId ?? -1),
    queryFn: ({ signal }) => listPayments(loanId as number, { signal }),
    enabled: loanId !== null,
  });
}

export function useTracking(loanId: number | null) {
  return useQuery({
    queryKey: queryKeys.tracking(loanId ?? -1),
    queryFn: ({ signal }) => getPaymentTracking(loanId as number, { signal }),
    enabled: loanId !== null,
  });
}

/**
 * Add / delete / import. Records feed interest-paid-to-date, the dashboard and insights, so every
 * success invalidates the whole ['loans'] root.
 */
export function usePaymentMutations(loanId: number) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.loansRoot });
  const create = useMutation({ mutationFn: (input: PaymentRecordInput) => createPayment(loanId, input), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (paymentId: number) => deletePayment(loanId, paymentId), onSuccess: invalidate });
  const importCsv = useMutation({ mutationFn: (csv: string) => importPayments(loanId, csv), onSuccess: invalidate });
  return { create, remove, importCsv };
}
