import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { emailsTo, linkFromEmail } from './mail.js';

/**
 * Phase 3 — the complete authentication and employee lifecycle through the real web app, API and PostgreSQL.
 * Needs the Manager created by `pnpm bootstrap:manager` (E2E_MANAGER_EMAIL) and the API running with
 * MAIL_TRANSPORT=file (E2E_MAIL_DIR). Synthetic data only (D-05).
 */
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'e2e.manager@example.test';
const RUN = Date.now().toString(36);
const MANAGER_PASSWORD = 'Sturdy-Lantern-Phrase-17';
const MANAGER_NEW_PASSWORD = 'Quiet-Harbour-Phrase-29';
const EMPLOYEE_PASSWORD = 'Amber-Meadow-Phrase-31';
const employee = {
  code: `E2E-${RUN}-1`,
  name: 'Erin Employee',
  email: `erin.${RUN}@example.test`,
  loginName: `SCLN-E2E-${RUN}`.toUpperCase(),
};
const csvPeople = [
  { code: `E2E-${RUN}-2`, name: 'Cal Coder', email: `cal.${RUN}@example.test` },
  { code: `E2E-${RUN}-3`, name: 'Ada Auditor', email: `ada.${RUN}@example.test` },
];

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'The lifecycle runs once, in desktop Chromium');

/** Next.js adds its own role=alert route announcer to every page; the app's alerts are the others. */
const alertOf = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');

let managerContext: BrowserContext;
let manager: Page;
let started: Date;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function setPassword(browser: Browser, link: string, password: string, buttonName: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: buttonName }).click();
  await expect(
    page.getByRole('status').filter({ hasText: /account is active|password has been changed/ }),
  ).toBeVisible();
  await context.close();
}

test.beforeAll(async ({ browser }) => {
  started = new Date(Date.now() - 2_000);
  managerContext = await browser.newContext();
  manager = await managerContext.newPage();
  // A render crash shows only a generic error page; surface the real error in the test output.
  manager.on('pageerror', (error) => console.error(`[manager page error] ${error.message}`));
  manager.on(
    'console',
    (m) => m.type() === 'error' && console.error(`[manager console] ${m.text().slice(0, 400)}`),
  );
});
test.afterAll(async () => managerContext.close());

test('Manager bootstrap → activation → password → sign in → dashboard', async ({ browser }) => {
  // The activation email was sent by the bootstrap CLI before the run; a re-run must not create a second Manager.
  const link = await linkFromEmail(MANAGER_EMAIL, /Activate your SmartCode Manager account/, new Date(0));
  const bad = await browser.newContext();
  const badPage = await bad.newPage();
  await badPage.goto(`${link.split('token=')[0]}token=${'x'.repeat(43)}`);
  await expect(alertOf(badPage)).toContainText('expired or was already used');
  await bad.close();

  await setPassword(browser, link, MANAGER_PASSWORD, 'Activate account');

  // The same link cannot be used twice.
  const again = await browser.newContext();
  const againPage = await again.newPage();
  await againPage.goto(link);
  await expect(alertOf(againPage)).toContainText('expired or was already used');
  await again.close();

  await signIn(manager, MANAGER_EMAIL, MANAGER_PASSWORD);
  await expect(manager).toHaveURL(/\/manager$/);
  await expect(manager.getByRole('heading', { name: 'Manager dashboard' })).toBeVisible();
});

test('invalid credentials are rejected without saying which part was wrong', async ({ page }) => {
  await signIn(page, MANAGER_EMAIL, 'Definitely-Wrong-Password-1');
  await expect(alertOf(page)).toHaveText('Email or password is incorrect.');
  await signIn(page, 'nobody@example.test', 'Definitely-Wrong-Password-1');
  await expect(alertOf(page)).toHaveText('Email or password is incorrect.');
  await expect(page).toHaveURL(/\/login$/);
});

test('Manager adds an employee; a pending account cannot sign in', async () => {
  await manager.goto('/manager/employees');
  await manager.getByRole('button', { name: 'Add employee' }).click();
  const dialog = manager.getByRole('dialog', { name: 'Add employee' });
  await expect(dialog.getByLabel(/password/i)).toHaveCount(0);
  await expect(dialog.getByLabel(/login name/i)).toHaveCount(0);
  await dialog.getByLabel(/Employee ID/).fill(employee.code);
  await dialog.getByLabel(/Employee name/).fill(employee.name);
  await dialog.getByLabel(/Work email/).fill(employee.email);
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await manager.getByRole('option', { name: 'Coder' }).click();
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(dialog).toBeHidden();

  const row = manager.getByRole('row', { name: new RegExp(employee.code) });
  await expect(row).toContainText('Pending activation');
  await expect(row).toContainText(employee.email);

  const pending = await manager.context().newPage();
  await signIn(pending, employee.email, EMPLOYEE_PASSWORD);
  await expect(alertOf(pending)).toHaveText('Email or password is incorrect.');
  await pending.close();
});

test('Employee activates from the emailed link, then signs in', async ({ browser }) => {
  const link = await linkFromEmail(employee.email, /Activate your SmartCode account/, started);
  await setPassword(browser, link, EMPLOYEE_PASSWORD, 'Activate account');

  await manager.reload();
  const row = manager.getByRole('row', { name: new RegExp(employee.code) });
  await expect(row).toContainText('Active');
  await expect(row).not.toContainText(employee.loginName); // no Login Name is generated at activation
});

test('Manager assigns a Login Name separately from activation', async () => {
  await manager.goto('/manager/employees?tab=login-names');
  await manager.getByRole('textbox', { name: 'Search' }).fill(employee.email);
  await manager.getByRole('button', { name: `Assign Login Name for ${employee.name}` }).click();
  const dialog = manager.getByRole('dialog', { name: 'Assign Login Name' });
  await dialog.getByLabel('SmartClues Login Name').fill(employee.loginName);
  await dialog.getByRole('button', { name: 'Assign Login Name' }).click();
  await expect(dialog).toBeHidden();
  await expect(manager.getByRole('row', { name: new RegExp(employee.name) })).toContainText(
    employee.loginName,
  );

  // Back in the directory the column shows it too.
  await manager.goto('/manager/employees');
  await manager.getByRole('textbox', { name: 'Search' }).fill(employee.loginName);
  await expect(manager.getByRole('row', { name: new RegExp(employee.code) })).toContainText(
    employee.loginName,
  );
});

test('Employee signs in, cannot reach the directory, and a Manager deactivation ends their session at once', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, employee.email, EMPLOYEE_PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/manager/employees');
  await expect(alertOf(page)).toContainText('do not have access');
  const me = await context.request.get(`${API_URL}/api/v1/auth/me`);
  expect(me.status()).toBe(200);
  // The API refuses a Coder anything Manager-only, whatever the UI shows.
  const csrf = (await context.cookies()).find((c) => c.name === 'sc_csrf')?.value ?? '';
  const forbidden = await context.request.post(`${API_URL}/api/v1/login-names/assignments`, {
    headers: { 'x-csrf-token': csrf, origin: process.env.WEB_URL ?? 'http://localhost:3000' },
    data: { employeeId: '00000000-0000-7000-8000-000000000000', loginName: 'SCLN-NOPE' },
  });
  expect(forbidden.status()).toBe(403);

  // Manager deactivates → the employee's very next request fails, token not yet expired.
  await manager.goto('/manager/employees');
  await manager.getByRole('textbox', { name: 'Search' }).fill(employee.email);
  await manager.getByRole('button', { name: `Actions for ${employee.name}` }).click();
  await manager.getByRole('menuitem', { name: 'Deactivate' }).click();
  const dialog = manager.getByRole('dialog', { name: /Deactivate/ });
  await dialog.getByLabel('Reason').fill('E2E session revocation check');
  await dialog.getByRole('button', { name: 'Deactivate' }).click();
  await expect(manager.getByRole('row', { name: new RegExp(employee.code) })).toContainText('Inactive');

  expect((await context.request.get(`${API_URL}/api/v1/auth/me`)).status()).toBe(401);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, employee.email, EMPLOYEE_PASSWORD);
  await expect(alertOf(page)).toContainText(/locked or inactive/);
  await context.close();
});

test('Manager imports employees from a CSV: preview, confirm, result, then sends activation links', async () => {
  await manager.goto('/manager/employees');
  await manager.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = manager.getByRole('dialog', { name: 'Import employees' });
  const rows = [
    'Employee Name,Employee ID,Email,Role',
    ...csvPeople.map((p, i) => `${p.name},${p.code},${p.email},${i === 0 ? 'Coder' : 'Auditor'}`),
    `Dup Person,${csvPeople[0]!.code},dup.${RUN}@example.test,Coder`,
    `Bad Role,E2E-${RUN}-9,bad.${RUN}@example.test,Wizard`,
  ];
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await expect(dialog.getByText(/4 rows/)).toBeVisible();
  await expect(dialog.getByText(/repeated on line/).first()).toBeVisible();
  await expect(dialog.getByText(/not recognised/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Confirm import' }).click();
  await expect(dialog.getByRole('status')).toContainText(/1 created/);

  // Nothing is emailed by the import itself.
  expect(emailsTo(csvPeople[1]!.email, /Activate/, started)).toBe(0);
  await dialog.getByRole('button', { name: /Send activation links to these 1 people/ }).click();
  await linkFromEmail(csvPeople[1]!.email, /Activate your SmartCode account/, started);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(manager.getByRole('row', { name: new RegExp(csvPeople[1]!.code) })).toContainText(
    'Pending activation',
  );
});

test('Password reset: request → email → new password → old one stops working → sign in', async ({
  browser,
}) => {
  // Sign out first: the session is revoked server-side, not only forgotten by the browser.
  await manager.goto('/manager');
  await manager.getByRole('button', { name: 'Sign out' }).click();
  await expect(manager).toHaveURL(/\/login$/);
  expect((await managerContext.request.get(`${API_URL}/api/v1/auth/me`)).status()).toBe(401);

  const requestedAt = new Date();
  await manager.goto('/account/forgot-password');
  await manager.getByLabel('Work email').fill(MANAGER_EMAIL);
  await manager.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(manager.getByRole('status')).toContainText('If that email belongs to an active account');

  const link = await linkFromEmail(MANAGER_EMAIL, /Reset your SmartCode password/, requestedAt);
  await setPassword(browser, link, MANAGER_NEW_PASSWORD, 'Set new password');

  // Single use.
  const reuse = await browser.newContext();
  const reusePage = await reuse.newPage();
  await reusePage.goto(link);
  await expect(alertOf(reusePage)).toContainText('expired or was already used');
  await reuse.close();

  await signIn(manager, MANAGER_EMAIL, MANAGER_PASSWORD);
  await expect(alertOf(manager)).toHaveText('Email or password is incorrect.');
  await signIn(manager, MANAGER_EMAIL, MANAGER_NEW_PASSWORD);
  await expect(manager).toHaveURL(/\/manager$/);
});

test('an unauthenticated visitor to a Manager page is sent to sign in', async ({ page }) => {
  await page.goto('/manager/employees');
  await expect(page).toHaveURL(/\/login$/);
});
