import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ROLES } from '@smartcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePublicEnv } from '@/env';
import { LoginForm, loginErrorMessage } from '@/features/auth/LoginForm';
import { NAV_ITEMS, groupedNavigation, navigationFor } from '@/features/navigation/navigation';
import { ApiError, apiFetch } from '@/lib/api';
import { renderWithTheme } from './render';
import { push } from './setup';

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

function problem(status: number, code: string) {
  return new ApiError({ type: 'about:blank', title: 't', status, code: code as never });
}

describe('navigation from the shared permission matrix', () => {
  it('only Manager sees chart allocation and audit reviews', () => {
    for (const key of ['allocation', 'reviews']) {
      const holders = ROLES.filter((r) => navigationFor(r).some((i) => i.key === key));
      expect([key, holders]).toEqual([key, ['MANAGER']]);
    }
  });

  it('vendor admin sees the vendor dashboard but never the manager dashboard', () => {
    const keys = navigationFor('VENDOR_ADMIN').map((i) => i.key);
    expect(keys).toContain('vendor-dashboard');
    expect(keys).not.toContain('manager-dashboard');
  });

  it('groups navigation in a fixed order and drops empty groups', () => {
    expect(groupedNavigation('CODER').map((g) => g.group)).toEqual([
      'Overview',
      'Operations',
      'Quality',
      'Administration',
    ]);
    expect(new Set(NAV_ITEMS.map((i) => i.key)).size).toBe(NAV_ITEMS.length);
  });
});

describe('public env', () => {
  it('defaults to localhost in development', () => {
    expect(parsePublicEnv({})).toEqual({
      NEXT_PUBLIC_APP_ENV: 'development',
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    });
  });

  it('refuses localhost in staging/production (D-06)', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_ENV: 'production' })).toThrow(
      /must not point to localhost/,
    );
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_APP_ENV: 'staging',
        NEXT_PUBLIC_API_URL: 'https://api.staging.example.test',
        NEXT_PUBLIC_APP_URL: 'https://app.staging.example.test',
      }).NEXT_PUBLIC_APP_ENV,
    ).toBe('staging');
  });
});

describe('apiFetch', () => {
  it('sends cookies and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/meta', {}, 'http://api.test/api/v1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/api/v1/meta',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('throws ApiError with the problem body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', type: 'x' }), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }),
      ),
    );
    await expect(apiFetch('/x', {}, 'http://api.test')).rejects.toMatchObject({
      status: 403,
      problem: { code: 'FORBIDDEN' },
    });
  });

  it('turns network failures into SERVICE_UNAVAILABLE and handles non-JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiFetch('/x', {}, 'http://api.test')).rejects.toMatchObject({
      problem: { code: 'SERVICE_UNAVAILABLE' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('oops', { status: 502, statusText: 'Bad Gateway' })),
    );
    await expect(apiFetch('/x', {}, 'http://api.test')).rejects.toMatchObject({ status: 502 });
  });
});

describe('LoginForm', () => {
  it('validates with the shared schema before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithTheme(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/work email/i), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts normalised credentials and shows API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 404, code: 'NOT_FOUND', title: 'Not Found', type: 'x' }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithTheme(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/work email/i), 'Manager@Example.TEST');
    await userEvent.type(screen.getByLabelText(/password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in is not enabled on this server yet.');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'manager@example.test',
      password: 'a-long-enough-passphrase',
    });
  });

  it('redirects after a successful sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
    );
    renderWithTheme(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/work email/i), 'm@example.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
  });

  it.each([
    ['ACCOUNT_NOT_ACTIVATED', 403, /not activated/],
    ['ACCOUNT_UNAVAILABLE', 403, /locked or inactive/],
    ['RATE_LIMITED', 429, /Too many attempts/],
    ['UNAUTHENTICATED', 401, /incorrect/],
    ['SERVICE_UNAVAILABLE', 0, /could not reach/],
    ['INTERNAL_ERROR', 500, /Sign-in failed/],
  ])('explains %s', (code, status, message) => {
    expect(loginErrorMessage(problem(status, code))).toMatch(message);
  });

  it('explains unknown errors', () => {
    expect(loginErrorMessage(new Error('x'))).toBe('Sign-in failed. Try again.');
  });
});
