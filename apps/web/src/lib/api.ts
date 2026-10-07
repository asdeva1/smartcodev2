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

/**
 * Thin fetch wrapper for the SmartCode API. Cookies (httpOnly session) are always sent; the browser never
 * sees tokens. Phase 3 adds the CSRF header and silent refresh.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}, base = API_BASE): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 0,
      code: 'SERVICE_UNAVAILABLE',
      detail: 'SmartCode could not reach the server. Check your connection and try again.',
    });
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
