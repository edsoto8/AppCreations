import { vi } from 'vitest';
import type { FieldErrors } from '@/api/client';
import { makePreferences } from './fixtures';

export interface MockRequest {
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  /** Parsed JSON body (undefined when absent or not JSON). */
  body: unknown;
  rawBody: string | undefined;
  headers: Headers;
}

export interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
  blob?: Blob;
  headers?: Record<string, string>;
}

export type MockHandler = MockResponse | ((req: MockRequest) => MockResponse | Promise<MockResponse>);

export const json = (data: unknown, status = 200): MockResponse => ({ status, json: data });

/** ASP.NET-style 400 validation problem. */
export const problem = (errors: FieldErrors, title = 'One or more validation errors occurred.', status = 400): MockResponse => ({
  status,
  json: { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title, status, errors },
  headers: { 'Content-Type': 'application/problem+json' },
});

interface CompiledRoute {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: MockHandler;
}

function compile(key: string, handler: MockHandler): CompiledRoute {
  const [method, pattern] = key.trim().split(/\s+/, 2);
  const keys: string[] = [];
  const regex = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, k: string) => {
      keys.push(k);
      return '([^/]+)';
    })}$`,
  );
  return { method: method.toUpperCase(), regex, keys, handler };
}

/**
 * Stubs global fetch with route handlers keyed "METHOD /api/path/:param".
 * Query strings are ignored for matching (read them from req.url). GET /api/preferences
 * answers with default preferences unless overridden. Unmatched requests return 404.
 */
export function mockApi(routes: Record<string, MockHandler> = {}) {
  const compiled = Object.entries({ 'GET /api/preferences': json(makePreferences()), 'PUT /api/preferences': (req: MockRequest) => json(req.body), ...routes }).map(
    ([k, h]) => compile(k, h),
  );
  const calls: MockRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = typeof init?.body === 'string' ? init.body : undefined;
    let body: unknown;
    try {
      body = rawBody !== undefined ? JSON.parse(rawBody) : undefined;
    } catch {
      body = undefined;
    }
    const headers = new Headers(init?.headers);
    const route = compiled.find((r) => r.method === method && r.regex.test(url.pathname));
    const params: Record<string, string> = {};
    if (route) {
      const m = route.regex.exec(url.pathname);
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m?.[i + 1] ?? '')));
    }
    const req: MockRequest = { method, path: url.pathname, url, params, body, rawBody, headers };
    calls.push(req);

    if (!route) return new Response(JSON.stringify({ title: `No mock for ${method} ${url.pathname}`, status: 404 }), { status: 404 });
    const res = typeof route.handler === 'function' ? await route.handler(req) : route.handler;
    const status = res.status ?? 200;
    if (status === 204) return new Response(null, { status });
    // jsdom's Blob is not accepted by Node's Response, so send its text.
    if (res.blob) return new Response(await res.blob.text(), { status, headers: { 'Content-Type': res.blob.type, ...res.headers } });
    const payload = res.text ?? (res.json !== undefined ? JSON.stringify(res.json) : '');
    return new Response(payload, { status, headers: { 'Content-Type': 'application/json', ...res.headers } });
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetch: fetchMock,
    calls,
    /** Requests matching "METHOD /path" (exact path, query ignored). */
    callsTo(key: string) {
      const [method, path] = key.split(/\s+/, 2);
      return calls.filter((c) => c.method === method.toUpperCase() && c.path === path);
    },
  };
}
