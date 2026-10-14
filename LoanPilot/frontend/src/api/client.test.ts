import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, problem } from '@/test/mockApi';
import { ApiError, buildUrl, normalizeFieldErrors, normalizeFieldKey, parseContentDispositionFilename, request } from './client';
import { createLoan, deleteLoan, exportSchedule, getComparison, getDashboard, importPayments, listLoans, previewLoan } from './endpoints';
import type { LoanInput } from './types';

const input: LoanInput = {
  name: 'Car',
  originalAmount: 32000,
  aprPercent: 6.49,
  termMonths: 72,
  startDate: '2024-03-10',
  firstPaymentDate: '2024-04-10',
  paymentFrequency: 'monthly',
  accrualMethod: 'dailySimple',
  dayCountBasis: 'actual365',
};

afterEach(() => vi.restoreAllMocks());

describe('ApiError mapping', () => {
  it('maps a 400 problem-details body to status + field errors', async () => {
    mockApi({
      'POST /api/loans': problem(
        { aprPercent: ['APR must be between 0 and 100.'], termMonths: ['The loan term must be between 1 and 240 months.'] },
        'Please check the highlighted fields.',
      ),
    });
    const error = await createLoan(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.isValidation).toBe(true);
    expect(apiError.message).toBe('Please check the highlighted fields.');
    expect(apiError.errors).toEqual({
      aprPercent: ['APR must be between 0 and 100.'],
      termMonths: ['The loan term must be between 1 and 240 months.'],
    });
    expect(apiError.fieldError('aprPercent')).toBe('APR must be between 0 and 100.');
    expect(apiError.problem?.status).toBe(400);
  });

  it('normalises PascalCase, $-prefixed and nested keys', () => {
    expect(normalizeFieldKey('AprPercent')).toBe('aprPercent');
    expect(normalizeFieldKey('$.firstPaymentDate')).toBe('firstPaymentDate');
    expect(normalizeFieldKey('LumpSums[0].Date')).toBe('lumpSums[0].date');
    expect(normalizeFieldKey('recurringExtras[1].amount')).toBe('recurringExtras[1].amount');
    expect(normalizeFieldErrors({ Name: ['a'], name: ['b'], body: 'Invalid JSON' })).toEqual({ name: ['a', 'b'], body: ['Invalid JSON'] });
    expect(normalizeFieldErrors(undefined)).toEqual({});
  });

  it('maps 404 to a not-found ApiError with a fallback message', async () => {
    mockApi({ 'GET /api/loans/:id/dashboard': { status: 404, text: '' } });
    const error = (await getDashboard(9).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(404);
    expect(error.isNotFound).toBe(true);
    expect(error.message).toBe('That item could not be found.');
    expect(error.errors).toEqual({});
  });

  it('keeps the detail of a 500 problem and tolerates non-JSON bodies', async () => {
    mockApi({
      'GET /api/loans': { status: 500, json: { title: 'Server error', detail: 'Database is locked.' } },
      'DELETE /api/loans/:id': { status: 502, text: '<html>Bad gateway</html>' },
    });
    expect(((await listLoans().catch((e: unknown) => e)) as ApiError).message).toBe('Database is locked.');
    const gateway = (await deleteLoan(1).catch((e: unknown) => e)) as ApiError;
    expect(gateway.status).toBe(502);
    expect(gateway.message).toBe('Request failed (502).');
  });

  it('turns a network failure into status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = (await listLoans().catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.isNetwork).toBe(true);
  });
});

describe('request', () => {
  it('sends JSON with the right method, headers and body', async () => {
    const api = mockApi({ 'POST /api/calculate/preview': { json: { ok: true } } });
    await previewLoan(input, { asOf: '2026-10-14' });
    const [call] = api.callsTo('POST /api/calculate/preview');
    expect(call.body).toEqual(input);
    expect(call.headers.get('Content-Type')).toBe('application/json');
    expect(call.url.searchParams.get('asOf')).toBe('2026-10-14');
  });

  it('resolves undefined for 204 No Content', async () => {
    mockApi({ 'DELETE /api/loans/:id': { status: 204 } });
    await expect(deleteLoan(3)).resolves.toBeUndefined();
  });

  it('builds query strings and drops empty values', () => {
    expect(buildUrl('/loans', { includeArchived: true })).toBe('/api/loans?includeArchived=true');
    expect(buildUrl('loans/1/comparison', { budget: undefined, asOf: null })).toBe('/api/loans/1/comparison');
  });

  it('passes the includeArchived and budget queries', async () => {
    const api = mockApi({ 'GET /api/loans': { json: [] }, 'GET /api/loans/:id/comparison': { json: {} } });
    await listLoans(true);
    await getComparison(4, 750);
    expect(api.calls[0].url.search).toBe('?includeArchived=true');
    expect(api.calls[1].url.searchParams.get('budget')).toBe('750');
  });

  it('rejects a generic request with ApiError', async () => {
    mockApi({});
    await expect(request('/nope')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('CSV import and file export', () => {
  it('posts CSV as text/csv', async () => {
    const api = mockApi({ 'POST /api/loans/:id/payments/import': { json: { imported: 2, errors: [] } } });
    const csv = 'date,amount\n2026-01-01,483.32\n2026-02-01,483.32';
    const result = await importPayments(7, csv);
    expect(result.imported).toBe(2);
    const [call] = api.callsTo('POST /api/loans/7/payments/import');
    expect(call.rawBody).toBe(csv);
    expect(call.headers.get('Content-Type')).toBe('text/csv');
  });

  it('returns the export as a Blob with the file name from Content-Disposition', async () => {
    const api = mockApi({
      'POST /api/loans/:id/export': {
        blob: new Blob(['a,b\n1,2'], { type: 'text/csv' }),
        headers: { 'Content-Disposition': "attachment; filename=\"schedule.csv\"; filename*=UTF-8''2024%20RAV4%20schedule.csv" },
      },
    });
    const file = await exportSchedule(2, 'csv', 'annual', { scenarioId: 5 });
    expect(file.filename).toBe('2024 RAV4 schedule.csv');
    expect(await file.blob.text()).toBe('a,b\n1,2');
    const [call] = api.callsTo('POST /api/loans/2/export');
    expect(call.url.searchParams.get('format')).toBe('csv');
    expect(call.url.searchParams.get('view')).toBe('annual');
    expect(call.body).toEqual({ scenarioId: 5 });
  });

  it('parses Content-Disposition variants', () => {
    expect(parseContentDispositionFilename('attachment; filename="a b.xlsx"', 'x')).toBe('a b.xlsx');
    expect(parseContentDispositionFilename('attachment; filename=plain.csv', 'x')).toBe('plain.csv');
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv", 'x')).toBe('résumé.csv');
    expect(parseContentDispositionFilename(null, 'fallback.csv')).toBe('fallback.csv');
    expect(parseContentDispositionFilename('attachment', 'fallback.csv')).toBe('fallback.csv');
  });
});
