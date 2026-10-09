import type { ProblemDetails } from '@smartcode/shared';
import { API_BASE } from '@/env';

/** Error carrying the API's RFC 7807 problem (or a synthetic one for network failures). */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
  get status(): number {
    return this.problem.status;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Paths that must never trigger a silent refresh (they ARE the session mechanism, or are public). */
const NO_REFRESH = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/activation',
  '/auth/password/',
  '/auth/tokens/',
];

/** The double-submit CSRF value the API set in a readable cookie at sign-in. */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = /(?:^|;\s*)sc_csrf=([^;]+)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function unavailable(): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'Service Unavailable',
    status: 0,
    code: 'SERVICE_UNAVAILABLE',
    detail: 'SmartCode could not reach the server. Check your connection and try again.',
  });
}

async function send(path: string, init: RequestInit, base: string): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const csrf = UNSAFE.has(method) ? readCsrfToken() : null;
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw unavailable();
  }
}

let refreshing: Promise<boolean> | null = null;
/** One refresh at a time; every waiting request shares the outcome. */
function refreshSession(base: string): Promise<boolean> {
  refreshing ??= send('/auth/refresh', { method: 'POST' }, base)
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Thin fetch wrapper for the SmartCode API. Cookies (httpOnly session) are always sent; the browser never sees
 * tokens. Unsafe requests carry the CSRF header; an expired access token is renewed once, silently, and the
 * request is retried. Authentication problems that survive that are returned to the caller.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, base = API_BASE): Promise<T> {
  let response = await send(path, init, base);
  if (
    response.status === 401 &&
    !NO_REFRESH.some((p) => path.startsWith(p)) &&
    (await refreshSession(base))
  ) {
    response = await send(path, init, base);
  }
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const body: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    const problem = (body as ProblemDetails | null) ?? {
      type: 'about:blank',
      title: response.statusText || 'Error',
      status: response.status,
      code: 'INTERNAL_ERROR',
    };
    throw new ApiError(problem);
  }
  return body as T;
}

/** Fetches a file (Excel, CSV…) with the session cookie and returns it with the server's suggested file name. */
export async function apiDownload(path: string, base = API_BASE): Promise<{ blob: Blob; filename: string }> {
  const get = () => send(path, { headers: { accept: '*/*' } }, base);
  let response = await get();
  if (response.status === 401 && (await refreshSession(base))) response = await get();
  if (!response.ok) {
    const isJson = (response.headers.get('content-type') ?? '').includes('json');
    const body = isJson ? ((await response.json()) as ProblemDetails) : null;
    throw new ApiError(
      body ?? {
        type: 'about:blank',
        title: response.statusText || 'Error',
        status: response.status,
        code: 'INTERNAL_ERROR',
      },
    );
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'report';
  return { blob: await response.blob(), filename };
}

/** Hands a downloaded file to the browser's normal save flow. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
