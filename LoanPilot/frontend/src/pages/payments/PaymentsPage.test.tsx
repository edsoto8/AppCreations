import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentRecord, PaymentRecordInput, TrackingResult } from '@/api/types';
import { makeDashboard, makeLoanListItem, makeStatus } from '@/test/fixtures';
import { json, mockApi, problem, type MockHandler, type MockRequest } from '@/test/mockApi';
import { renderWithProviders } from '@/test/render';
import { previewCsv, splitCsvLine } from './csv';
import { PaymentsPage } from './PaymentsPage';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

const record = (id: number, date: string, amount: number, split?: [number, number], note: string | null = null): PaymentRecord => ({
  id,
  loanId: 1,
  date,
  amount,
  principal: split?.[0] ?? null,
  interest: split?.[1] ?? null,
  note,
  createdAt: '2026-10-14T00:00:00Z',
});

const tracking: TrackingResult = {
  points: [
    { date: '2026-08-01', scheduledCumulative: 483.32, actualCumulative: 483.32 },
    { date: '2026-09-01', scheduledCumulative: 966.64, actualCumulative: 1066.64 },
    { date: '2026-10-01', scheduledCumulative: 1449.96, actualCumulative: 1549.96 },
  ],
  totalScheduled: 1449.96,
  totalActual: 1549.96,
  difference: 100,
  note: 'Recorded payments are $100.00 ahead of the original schedule as of October 14, 2026.',
};

function setup(
  overrides: Record<string, MockHandler> = {},
  initial: PaymentRecord[] = [record(1, '2026-08-01', 483.32, [416.15, 67.17], 'August'), record(2, '2026-09-01', 583.32)],
) {
  const store = [...initial];
  const api = mockApi({
    'GET /api/loans': json([makeLoanListItem()]),
    'GET /api/loans/:id/dashboard': json(makeDashboard({ status: makeStatus({ vehicleValue: 18000, equity: 5795.24 }) })),
    'GET /api/loans/:id/payments': () => json(store),
    'GET /api/loans/:id/payments/tracking': json(tracking),
    'POST /api/loans/:id/payments': (req: MockRequest) => {
      const body = req.body as PaymentRecordInput;
      const created = record(10 + store.length, body.date, body.amount, undefined, body.note ?? null);
      store.push(created);
      return json(created, 201);
    },
    'DELETE /api/loans/:id/payments/:paymentId': (req: MockRequest) => {
      const i = store.findIndex((p) => p.id === Number(req.params.paymentId));
      if (i >= 0) store.splice(i, 1);
      return { status: 204 };
    },
    ...overrides,
  });
  return { api, store, ...renderWithProviders(<PaymentsPage />) };
}

const history = () => screen.getByRole('region', { name: 'Recorded payments' });

describe('PaymentsPage', () => {
  it('lists recorded payments newest first with totals, tracking and equity', async () => {
    setup();
    const rows = within(await screen.findByRole('region', { name: 'Recorded payments' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Sep 1, 2026');
    expect(rows[1]).toHaveTextContent('$583.32');
    expect(rows[2]).toHaveTextContent('August');
    expect(rows[2]).toHaveTextContent('$67.17');
    expect(within(history()).getByText('$1,066.64')).toBeInTheDocument(); // total amount
    expect(within(history()).getByText('1 of 2 with a split')).toBeInTheDocument();

    // Tracking: chart card, totals, and the server note.
    expect(screen.getByText('Recorded vs scheduled')).toBeInTheDocument();
    expect(await screen.findByTestId('tracking-note')).toHaveTextContent('$100.00 ahead of the original schedule');
    expect(screen.getByText('$100.00 ahead')).toBeInTheDocument();
    expect(screen.getByText('$1,549.96 recorded vs $1,449.96 scheduled to date')).toBeInTheDocument();

    // Equity from the dashboard, linking to Loan Details.
    const equity = (await screen.findByText('$5,795.24')).closest('[data-slot=card]') as HTMLElement;
    expect(within(equity).getByRole('link', { name: /Update vehicle value/ })).toHaveAttribute('href', '/loans/1/edit');
    expect(screen.getByText('Payment records are optional')).toBeInTheDocument();
  });

  it('adds a payment, then refreshes everything under the loan', async () => {
    const { api, user } = setup();
    await screen.findByRole('region', { name: 'Recorded payments' });
    const before = api.callsTo('GET /api/loans/1/dashboard').length;

    const amount = screen.getByLabelText('Amount');
    expect(amount).toHaveValue('483.32'); // the scheduled payment is prefilled
    await user.clear(amount);
    await user.type(amount, '500');
    await user.type(screen.getByLabelText(/^Note/), 'Paid early');
    await user.click(screen.getByRole('button', { name: 'Add payment' }));

    await waitFor(() => expect(api.callsTo('POST /api/loans/1/payments')).toHaveLength(1));
    expect(api.callsTo('POST /api/loans/1/payments')[0].body).toEqual({
      date: '2026-10-14',
      amount: 500,
      principal: null,
      interest: null,
      note: 'Paid early',
    });
    expect(await screen.findByText('Payment recorded')).toBeInTheDocument();
    await waitFor(() => expect(within(history()).getByText('Paid early')).toBeInTheDocument());
    await waitFor(() => expect(api.callsTo('GET /api/loans/1/dashboard').length).toBeGreaterThan(before));
  });

  it('shows server validation errors next to their fields', async () => {
    const { api, user } = setup({
      'POST /api/loans/:id/payments': problem({
        principal: ['Principal plus interest must add up to the payment amount.'],
        date: ['The payment date cannot be before the loan start date.'],
      }),
    });
    await screen.findByRole('region', { name: 'Recorded payments' });
    await user.click(screen.getByRole('button', { name: 'Add principal and interest split' }));
    await user.type(screen.getByLabelText(/^Principal/), '400');
    await user.type(screen.getByLabelText(/^Interest/), '20');
    await user.click(screen.getByRole('button', { name: 'Add payment' }));

    expect(await screen.findByText('Principal plus interest must add up to the payment amount.')).toBeInTheDocument();
    expect(screen.getByText('The payment date cannot be before the loan start date.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Principal/)).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST /api/loans/1/payments')[0].body).toMatchObject({ amount: 483.32, principal: 400, interest: 20 });
  });

  it('requires a date and amount before posting', async () => {
    const { api, user } = setup();
    await screen.findByRole('region', { name: 'Recorded payments' });
    await user.clear(screen.getByLabelText('Amount'));
    await user.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(await screen.findByText('Enter the amount you paid.')).toBeInTheDocument();
    expect(api.callsTo('POST /api/loans/1/payments')).toHaveLength(0);
  });

  it('deletes a payment after confirmation', async () => {
    const { api, user } = setup();
    await screen.findByRole('region', { name: 'Recorded payments' });
    await user.click(screen.getByRole('button', { name: 'Delete the $583.32 payment on Sep 1, 2026' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('The $583.32 payment on September 1, 2026 will be removed');
    await user.click(within(dialog).getByRole('button', { name: 'Delete payment' }));
    await waitFor(() => expect(api.callsTo('DELETE /api/loans/1/payments/2')).toHaveLength(1));
    await waitFor(() => expect(within(history()).queryByText('$583.32')).not.toBeInTheDocument());
    expect(await screen.findByText('Payment deleted')).toBeInTheDocument();
  });

  it('previews a CSV file, posts it as text/csv and reports imported lines and errors', async () => {
    const csv = 'date,amount,principal,interest,note\n2026-08-01,483.32,416.15,67.17,August\n09/01/2026,483.32\nbad,12\n';
    const { api, user } = setup({
      'POST /api/loans/:id/payments/import': json({
        imported: 2,
        skipped: 0,
        errors: [{ line: 4, message: '"bad" is not a date (use yyyy-mm-dd or mm/dd/yyyy).' }],
      }),
    });
    await screen.findByRole('region', { name: 'Recorded payments' });
    await user.upload(screen.getByLabelText('Choose a CSV file'), new File([csv], 'payments.csv', { type: 'text/csv' }));

    const preview = await screen.findByRole('region', { name: 'File preview' });
    expect(within(preview).getAllByRole('row')).toHaveLength(4);
    expect(within(preview).getByText('09/01/2026')).toBeInTheDocument();
    expect(screen.getByText('3 payment lines + header')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import 3 lines' }));
    await waitFor(() => expect(api.callsTo('POST /api/loans/1/payments/import')).toHaveLength(1));
    const call = api.callsTo('POST /api/loans/1/payments/import')[0];
    expect(call.rawBody).toBe(csv);
    expect(call.headers.get('Content-Type')).toBe('text/csv');

    const result = await screen.findByTestId('import-result');
    expect(result).toHaveTextContent('Imported 2 payments, 1 line not imported');
    expect(within(result).getByText('Line 4')).toBeInTheDocument();
    expect(within(result).getByText(/"bad" is not a date/)).toBeInTheDocument();
  });

  it('rejects files that are not CSV', async () => {
    const { user } = setup();
    await screen.findByRole('region', { name: 'Recorded payments' });
    await user.upload(screen.getByLabelText('Choose a CSV file'), new File(['x'], 'photo.png', { type: 'image/png' }));
    // The input's accept filter drops it, or the type check rejects it: either way nothing is previewed.
    expect(screen.queryByRole('region', { name: 'File preview' })).not.toBeInTheDocument();
  });

  it('offers a sample CSV download', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:sample');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Download sample CSV' }));
    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(await blob.text()).toMatch(/^date,amount,principal,interest,note\n2026-07-10,537.77/);
  });

  it('shows an empty history and the schedule-only chart when nothing is recorded', async () => {
    setup(
      {
        'GET /api/loans/:id/payments/tracking': json({
          ...tracking,
          points: tracking.points.map((p) => ({ ...p, actualCumulative: null })),
          totalActual: 0,
          difference: -1449.96,
        }),
      },
      [],
    );
    expect(await screen.findByText('No payments recorded')).toBeInTheDocument();
    expect(await screen.findByText('Record payments to see them against the schedule.')).toBeInTheDocument();
    expect(screen.getByText('No records')).toBeInTheDocument();
  });
});

describe('csv helpers', () => {
  it('splits quoted cells and detects a header', () => {
    expect(splitCsvLine('2026-01-01,500,,,"Paid, early"')).toEqual(['2026-01-01', '500', '', '', 'Paid, early']);
    const p = previewCsv('﻿date,amount\n\n2026-01-01,500\n2026-02-01,500\n', 2);
    expect(p.hasHeader).toBe(true);
    expect(p.dataLines).toBe(2);
    expect(p.lines.map((l) => l.line)).toEqual([1, 3]);
    expect(previewCsv('2026-01-01,500').hasHeader).toBe(false);
  });
});
