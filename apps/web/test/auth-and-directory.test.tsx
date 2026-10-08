import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';
import { SetPasswordForm } from '@/features/auth/SetPasswordForm';
import { homeFor, RequireSession } from '@/features/auth/session';
import { EmployeesWorkspace } from '@/features/employees/EmployeesWorkspace';
import { CsvImportDialog } from '@/features/employees/CsvImportDialog';
import { ApiError, apiFetch, readCsrfToken } from '@/lib/api';
import { renderWithTheme } from './render';
import { push } from './setup';

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { 'content-type': 'application/json' },
  });

const profile = (role: string, permissions: Record<string, string>) => ({
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Example',
    email: 'pat@example.test',
    role,
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions,
});
const MANAGER = profile('MANAGER', {
  'employee.read': 'ORG',
  'employee.create': 'ORG',
  'employee.update': 'ORG',
  'employee.sendActivation': 'ORG',
  'employee.deactivate': 'ORG',
  'employee.changeRole': 'ORG',
  'employee.triggerPasswordReset': 'ORG',
  'loginName.read': 'ORG',
  'loginName.assign': 'ORG',
});
const HR = profile('HR', { 'employee.read': 'ORG', 'employee.update': 'ORG' });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'id-1',
  employeeCode: 'EMP-1',
  fullName: 'Casey Coder',
  email: 'casey@example.test',
  role: 'CODER',
  status: 'ACTIVE',
  vendor: null,
  team: null,
  teamLead: null,
  projects: [],
  loginName: null,
  loginNameEligible: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  activatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

/** Routes fetch calls by "METHOD /path" prefix. */
function mockApi(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      calls.push({ url: path, init });
      const key = Object.keys(routes).find((k) => `${init.method ?? 'GET'} ${path}`.startsWith(k));
      return Promise.resolve(
        key ? routes[key]!(init) : json({ status: 404, code: 'NOT_FOUND', title: 'x', type: 'x' }, 404),
      );
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  document.cookie = 'sc_csrf=; Max-Age=0';
});

describe('apiFetch: CSRF and silent refresh', () => {
  it('reads the CSRF cookie and echoes it on unsafe requests only', async () => {
    document.cookie = 'sc_csrf=abc123';
    expect(readCsrfToken()).toBe('abc123');
    const calls = mockApi({ 'GET /a': () => json({}), 'POST /b': () => json({}) });
    await apiFetch('/a', {}, 'http://api.test/api/v1');
    await apiFetch('/b', { method: 'POST', body: '{}' }, 'http://api.test/api/v1');
    expect((calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect((calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('abc123');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    let first = true;
    const calls = mockApi({
      'GET /thing': () =>
        first
          ? ((first = false), json({ status: 401, code: 'UNAUTHENTICATED', title: 'x', type: 'x' }, 401))
          : json({ ok: 1 }),
      'POST /auth/refresh': () => json({}),
    });
    await expect(apiFetch('/thing', {}, 'http://api.test/api/v1')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /thing',
      'POST /auth/refresh',
      'GET /thing',
    ]);
  });

  it('does not loop: a failed refresh surfaces the 401, and sign-in failures never trigger a refresh', async () => {
    const calls = mockApi({
      'GET /thing': () => json({ status: 401, code: 'UNAUTHENTICATED', title: 'x', type: 'x' }, 401),
      'POST /auth/refresh': () => json({ status: 401, code: 'UNAUTHENTICATED', title: 'x', type: 'x' }, 401),
      'POST /auth/login': () => json({ status: 401, code: 'UNAUTHENTICATED', title: 'x', type: 'x' }, 401),
    });
    await expect(apiFetch('/thing', {}, 'http://api.test/api/v1')).rejects.toBeInstanceOf(ApiError);
    await expect(
      apiFetch('/auth/login', { method: 'POST', body: '{}' }, 'http://api.test/api/v1'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.url === '/auth/refresh')).toHaveLength(1);
  });
});

describe('RequireSession', () => {
  it('sends an anonymous visitor to /login', async () => {
    mockApi({
      'GET /auth/me': () => json({ status: 401, code: 'UNAUTHENTICATED', title: 'x', type: 'x' }, 401),
      'POST /auth/refresh': () => json({}, 401),
    });
    renderWithTheme(
      <RequireSession>
        <p>secret</p>
      </RequireSession>,
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
  it('shows an access message when the role or permission is missing', async () => {
    mockApi({ 'GET /auth/me': () => json(HR) });
    renderWithTheme(
      <RequireSession role="MANAGER">
        <p>secret</p>
      </RequireSession>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('do not have access');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });
  it('lands each role on a page that exists', () => {
    expect(homeFor('MANAGER')).toBe('/manager');
    expect(homeFor('CODER')).toBe('/coder');
    expect(homeFor('TEAM_LEAD')).toBe('/projects');
    expect(homeFor('VENDOR_ADMIN')).toBe('/manager/employees');
  });
});

describe('Activation and reset pages', () => {
  it('rejects a missing, used or expired activation link before showing the form', async () => {
    renderWithTheme(<SetPasswordForm kind="ACTIVATION" token={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
  });

  it('activates: checks the link, applies the password policy and confirmation, then offers sign-in', async () => {
    const calls = mockApi({
      'POST /auth/tokens/check': () => json({ valid: true, fullName: 'Casey Coder' }),
      'POST /auth/activation': () => json(null, 204),
    });
    renderWithTheme(<SetPasswordForm kind="ACTIVATION" token={'t'.repeat(43)} />);
    await screen.findByText(/Setting the password for Casey Coder/);
    const submit = screen.getByRole('button', { name: 'Activate account' });

    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12/);

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'Correct-Horse-Battery-7');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different-Horse-Battery-7');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/);
    expect(calls.some((c) => c.url === '/auth/activation')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Correct-Horse-Battery-7');
    await userEvent.click(submit);
    expect(await screen.findByRole('status')).toHaveTextContent(/account is active/);
    const body = JSON.parse(calls.find((c) => c.url === '/auth/activation')!.init.body as string);
    expect(body).toEqual({ token: 't'.repeat(43), password: 'Correct-Horse-Battery-7' });
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('shows the dead-link message when the server says the link is invalid at submit time', async () => {
    mockApi({
      'POST /auth/tokens/check': () => json({ valid: true, fullName: 'Casey Coder' }),
      'POST /auth/password/reset': () =>
        json({ status: 400, code: 'TOKEN_INVALID', title: 'x', type: 'x' }, 400),
    });
    renderWithTheme(<SetPasswordForm kind="PASSWORD_RESET" token={'t'.repeat(43)} />);
    await userEvent.type(await screen.findByLabelText('New password'), 'Correct-Horse-Battery-7');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Correct-Horse-Battery-7');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
  });

  it('forgot password gives the same neutral answer whatever the email', async () => {
    mockApi({ 'POST /auth/password/forgot': () => json({ accepted: true }, 202) });
    renderWithTheme(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText('Work email'), 'anyone@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/If that email belongs to an active account/);
  });
});

describe('Employee Directory', () => {
  const directoryApi = (
    me: unknown,
    items = [
      row(),
      row({
        id: 'id-2',
        employeeCode: 'EMP-2',
        fullName: 'Pia Pending',
        email: 'pia@example.test',
        status: 'PENDING_ACTIVATION',
        activatedAt: null,
        loginName: null,
      }),
    ],
  ) =>
    mockApi({
      'GET /auth/me': () => json(me),
      'GET /employees/options': () => json({ vendors: [], teams: [], projects: [] }),
      'GET /employees?': () => json({ items, page: 1, pageSize: 25, total: items.length }),
    });

  it('lists the specified columns and the Manager’s actions', async () => {
    directoryApi(MANAGER);
    renderWithTheme(<EmployeesWorkspace />);
    const table = await screen.findByRole('table', { name: 'Employees' });
    for (const col of [
      'Employee ID',
      'Name',
      'Email',
      'Role',
      'Team',
      'Team Lead',
      'Project',
      'Vendor',
      'Status',
      'Created',
      'Activated',
    ]) {
      expect(within(table).getByRole('columnheader', { name: col })).toBeInTheDocument();
    }
    expect(await within(table).findByText('Casey Coder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add employee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
    // Login Names are managed in Chart Allocation, not in the directory.
    expect(screen.queryByRole('tab', { name: 'Login Names' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Login Name' })).not.toBeInTheDocument();
  });

  it('offers HR a read-only directory: no add, import or selection', async () => {
    directoryApi(HR);
    renderWithTheme(<EmployeesWorkspace />);
    await screen.findByText('Casey Coder');
    expect(screen.queryByRole('button', { name: 'Add employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send activation links/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Login Names' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Casey Coder' }));
    expect(screen.queryByRole('menuitem', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Change role/ })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View / edit' })).toBeInTheDocument();
  });

  it('shows row actions that match the account state', async () => {
    directoryApi(MANAGER);
    renderWithTheme(<EmployeesWorkspace />);
    await screen.findByText('Casey Coder');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Pia Pending' }));
    expect(screen.getByRole('menuitem', { name: 'Send activation link' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /password reset/i })).not.toBeInTheDocument(); // pending must activate, not reset
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Casey Coder' }));
    expect(screen.getByRole('menuitem', { name: 'Send password reset link' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Login Name/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Send activation link' })).not.toBeInTheDocument();
  });

  it('adds an employee without asking for a password or Login Name', async () => {
    const calls = directoryApi(MANAGER);
    calls.length = 0;
    renderWithTheme(<EmployeesWorkspace />);
    await screen.findByText('Casey Coder');
    await userEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add employee' });
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/login name/i)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Employee ID/), 'EMP-9');
    await userEvent.type(within(dialog).getByLabelText(/Employee name/), 'New Person');
    await userEvent.type(within(dialog).getByLabelText(/Work email/), 'new@example.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add employee' }));
    expect(await within(dialog).findByText('Choose a role')).toBeInTheDocument();
  });

  it('sends activation links to the selected employees in one request', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /employees/options': () => json({ vendors: [], teams: [], projects: [] }),
      'GET /employees?': () =>
        json({
          items: [
            row({ id: 'id-2', fullName: 'Pia Pending', status: 'PENDING_ACTIVATION', activatedAt: null }),
          ],
          page: 1,
          pageSize: 25,
          total: 1,
        }),
      'POST /employees/activation-emails': () => json({ sent: 1, failed: 0, skipped: [] }),
    });
    renderWithTheme(<EmployeesWorkspace />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Select Pia Pending' }));
    await userEvent.click(screen.getByRole('button', { name: /Send activation links \(1\)/ }));
    await waitFor(() => expect(calls.some((c) => c.url === '/employees/activation-emails')).toBe(true));
    const sent = calls.find((c) => c.url === '/employees/activation-emails')!;
    expect(JSON.parse(sent.init.body as string)).toEqual({ employeeIds: ['id-2'] });
  });
});

describe('CSV import dialog', () => {
  const file = (text: string) => new File([text], 'people.csv', { type: 'text/csv' });
  const preview = (over: object = {}) => ({
    total: 2,
    valid: 1,
    invalid: 1,
    duplicates: 0,
    warnings: 0,
    fileErrors: [],
    rows: [
      {
        line: 2,
        status: 'VALID',
        values: { 'Login Name': 'a@vlms.test', Email: 'a@example.test' },
        errors: [],
        warnings: [],
      },
      {
        line: 3,
        status: 'INVALID',
        values: { 'Login Name': 'b@vlms.test', Email: 'b@example.test' },
        errors: ['This employee has not activated their account yet'],
        warnings: [],
      },
    ],
    ...over,
  });

  it('walks upload → preview → confirm → result and commits what the Manager chose', async () => {
    const onClose = vi.fn();
    const calls = mockApi({
      'POST /login-names/import/preview': () => json(preview()),
      'POST /login-names/import/commit': () =>
        json({ committed: true, created: 1, skipped: 1, createdIds: [], preview: preview() }),
    });
    renderWithTheme(
      <CsvImportDialog
        title="Import Login Names"
        columns={['Login Name', 'Email']}
        guidance="x"
        previewPath="/login-names/import/preview"
        commitPath="/login-names/import/commit"
        doneVerb="assigned"
        onClose={onClose}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText('CSV file'),
      file('Login Name,Email\na@vlms.test,a@example.test\n'),
    );
    expect(await screen.findByText(/1 ready/)).toBeInTheDocument();
    expect(screen.getByText('This employee has not activated their account yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('radio', { name: /Assigned nothing unless every row is ready/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 assigned, 1 skipped.');
    const commit = calls.find((c) => c.url === '/login-names/import/commit')!;
    expect(JSON.parse(commit.init.body as string)).toMatchObject({ mode: 'all-or-nothing' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('blocks Continue when the file has header errors or no valid rows', async () => {
    mockApi({
      'POST /employees/import/preview': () =>
        json(preview({ valid: 0, fileErrors: ['Remove the Password column'], rows: [] })),
    });
    renderWithTheme(
      <CsvImportDialog
        title="Import employees"
        columns={['Employee Name']}
        guidance="x"
        previewPath="/employees/import/preview"
        commitPath="/employees/import/commit"
        doneVerb="created"
        onClose={vi.fn()}
      />,
    );
    await userEvent.upload(screen.getByLabelText('CSV file'), file('Employee Name,Password\n'));
    expect(await screen.findByText('Remove the Password column')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
