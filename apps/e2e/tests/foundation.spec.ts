import { expect, test } from '@playwright/test';

/**
 * Phase 1 foundation checks. The mandatory business workflow (create employee → … → completion) is added
 * phase by phase as each module ships (docs/13-testing-strategy.md §2).
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

test.describe('API', () => {
  test('liveness and readiness', async ({ request }) => {
    const live = await request.get(`${API_URL}/health/live`);
    expect(live.status()).toBe(200);
    expect(await live.json()).toMatchObject({ status: 'ok' });

    const ready = await request.get(`${API_URL}/health/ready`);
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready', checks: { database: { status: 'up' } } });
  });

  test('errors are problem+json and unknown routes are not leaked', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/v1/does-not-exist`);
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

test.describe('web', () => {
  test('landing page shows the official logo and leads to sign-in', async ({ page }) => {
    await page.goto('/');
    const logo = page.getByRole('img', { name: /SmartCode/ }).first();
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('sign-in form validates before calling the API', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Work email').fill('not-an-email');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();
  });

  test('favicon and brand assets are served', async ({ request }) => {
    for (const path of [
      '/brand/favicon/favicon.ico',
      '/brand/web/smartcode-logo-horizontal.png',
      '/brand/web/smartcode-mark.png',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
    }
  });

  test('security headers are set', async ({ request }) => {
    const res = await request.get('/login');
    const headers = res.headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('unknown pages show the branded not-found page', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});
