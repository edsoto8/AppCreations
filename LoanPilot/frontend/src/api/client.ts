import type { ProblemDetails } from './types';

/** All endpoints live under /api. In dev Vite proxies it to http://localhost:5080. */
export const API_BASE = '/api';

export type FieldErrors = Record<string, string[]>;

/**
 * Error thrown for any non-2xx response (or a network failure, status 0).
 * `errors` carries the per-field messages of a 400 problem-details body, keyed by the
 * camelCase request property name (normalised, see `normalizeFieldKey`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: FieldErrors;
  readonly problem: ProblemDetails | null;

  constructor(status: number, message: string, errors: FieldErrors = {}, problem: ProblemDetails | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.problem = problem;
  }

  get isValidation(): boolean {
    return this.status === 400;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** First message for a field, if any. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * ASP.NET may report keys as "AprPercent", "aprPercent", "$.aprPercent" or "loan.aprPercent";
 * map them all to the request property name so forms can look them up directly.
 * Nested paths keep their tail ("recurringExtras[0].amount" stays as-is apart from casing).
 */
export function normalizeFieldKey(key: string): string {
  let k = key.trim();
  if (k.startsWith('$.')) k = k.slice(2);
  if (k.startsWith('$')) k = k.slice(1);
  return k
    .split('.')
    .filter(Boolean)
    .map((part) => (part.length > 0 ? part[0].toLowerCase() + part.slice(1) : part))
    .join('.');
}

export function normalizeFieldErrors(errors: Record<string, unknown> | undefined | null): FieldErrors {
  const out: FieldErrors = {};
  if (!errors || typeof errors !== 'object') return out;
  for (const [rawKey, value] of Object.entries(errors)) {
    const messages = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
    if (messages.length === 0) continue;
    const key = normalizeFieldKey(rawKey) || '_';
    out[key] = [...(out[key] ?? []), ...messages];
  }
  return out;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** JSON body (serialised with JSON.stringify). */
  json?: unknown;
  /** Raw body sent as-is, with `contentType`. */
  body?: BodyInit;
  contentType?: string;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', json, body, contentType, query, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined = body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(json);
  } else if (body !== undefined && contentType) {
    headers['Content-Type'] = contentType;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body: payload, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Could not reach the LoanPilot server. Make sure it is running, then try again.');
  }

  if (!response.ok) throw await toApiError(response);
  return response;
}

async function toApiError(response: Response): Promise<ApiError> {
  let problem: ProblemDetails | null = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') problem = parsed as ProblemDetails;
    } catch {
      problem = null;
    }
  }
  const errors = normalizeFieldErrors(problem?.errors);
  const message =
    problem?.detail ||
    problem?.title ||
    (response.status === 404
      ? 'That item could not be found.'
      : response.status === 400
        ? 'Some values need attention.'
        : `Request failed (${response.status}).`);
  return new ApiError(response.status, message, errors, problem);
}

/** JSON request. Resolves `undefined` for 204 / empty bodies. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface FileDownload {
  blob: Blob;
  filename: string;
}

/**
 * Reads the file name from a Content-Disposition header. Prefers RFC 5987 `filename*`
 * (UTF-8, percent-encoded) over the plain `filename` parameter.
 */
export function parseContentDispositionFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) {
    const value = (plain[2] ?? plain[1]).trim();
    if (value) return value;
  }
  return fallback;
}

/** Binary download (exports). */
export async function requestFile(path: string, options: RequestOptions, fallbackName: string): Promise<FileDownload> {
  const response = await send(path, options);
  const blob = await response.blob();
  const filename = parseContentDispositionFilename(response.headers.get('Content-Disposition'), fallbackName);
  return { blob, filename };
}

/** Triggers a browser download for a blob returned by an export endpoint. */
export function saveDownload({ blob, filename }: FileDownload): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A user-facing message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
