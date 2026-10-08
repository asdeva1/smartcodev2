import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartAllocationWorkspace } from '@/features/allocation/ChartAllocationWorkspace';
import { navigationFor } from '@/features/navigation/navigation';
import { renderWithTheme } from './render';
import { push } from './setup';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const profile = (role: string, permissions: Record<string, string>) => ({
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Manager',
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
  'chart.allocate': 'ORG',
  'loginName.read': 'ORG',
  'loginName.assign': 'ORG',
});
const HR = profile('HR', { 'employee.read': 'ORG' });

const loginNames = {
  items: [
    {
      id: 'ln1',
      value: 'naveen@vlms.com',
      status: 'ACTIVE',
      holder: {
        id: 'e2',
        employeeCode: 'EMP-2',
        fullName: 'Naveen P',
        email: 'naveen@smartcluestech.com',
        role: 'CODER',
        status: 'ACTIVE',
      },
      assignedAt: '2026-10-05T00:00:00.000Z',
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
};

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
});

describe('Chart allocation (Manager): Login Names and Chart ID search', () => {
  it('lists Login Names with the employee email and offers manual assign and CSV import', async () => {
    mockApi({ 'GET /auth/me': () => json(MANAGER), 'GET /login-names': () => json(loginNames) });
    renderWithTheme(<ChartAllocationWorkspace />);
    const table = await screen.findByRole('table', { name: 'Login Names' });
    expect(within(table).getByRole('columnheader', { name: 'Login Name' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Email' })).toBeInTheDocument();
    expect(await within(table).findByText('naveen@vlms.com')).toBeInTheDocument();
    expect(within(table).getByText('naveen@smartcluestech.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Login Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
  });

  it('assigns a Login Name by email', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /login-names': () => json(loginNames),
      'POST /login-names/assignments': () =>
        json({ changed: true, loginName: 'ravi@vlms.com', previousLoginName: null }),
    });
    renderWithTheme(<ChartAllocationWorkspace />);
    await screen.findByText('naveen@vlms.com');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Login Name' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Login Name/), 'ravi@vlms.com');
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'ravi@smartcluestech.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    const sent = calls.find((c) => c.url === '/login-names/assignments')!;
    expect(JSON.parse(sent.init.body as string)).toEqual({
      loginName: 'ravi@vlms.com',
      email: 'ravi@smartcluestech.com',
    });
  });

  it('checks the email before sending', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /login-names': () => json(loginNames),
    });
    renderWithTheme(<ChartAllocationWorkspace />);
    await screen.findByText('naveen@vlms.com');
    await userEvent.click(screen.getByRole('button', { name: 'Assign Login Name' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Login Name/), 'ravi@vlms.com');
    await userEvent.type(within(dialog).getByLabelText(/Email/), 'not-an-email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await within(dialog).findByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls.some((c) => c.url === '/login-names/assignments')).toBe(false);
  });

  it('shows Login Name, Assigned to, Allotted by and Allotted date for a searched Chart ID', async () => {
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /login-names': () => json(loginNames),
      'GET /allocation/charts': () =>
        json([
          {
            chartId: 'CH-1001',
            project: { id: 'p1', name: 'Inpatient 2026', client: 'Acme Health' },
            status: 'ALLOCATED',
            allocation: {
              loginName: 'naveen@vlms.com',
              assignedTo: { id: 'e2', fullName: 'Naveen P', email: 'naveen@smartcluestech.com' },
              allocatedBy: { id: 'e1', fullName: 'Pat Manager' },
              allocatedAt: '2026-10-07T09:30:00.000Z',
            },
          },
        ]),
    });
    renderWithTheme(<ChartAllocationWorkspace />);
    await userEvent.type(await screen.findByLabelText('Search Chart ID'), 'CH-1001');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('heading', { name: 'CH-1001' })).toBeInTheDocument();
    for (const label of ['Login Name :', 'Assigned to :', 'Allotted by :', 'Allotted date :']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Naveen P (naveen@smartcluestech.com)')).toBeInTheDocument();
    expect(screen.getByText('Pat Manager')).toBeInTheDocument();
  });

  it('says so plainly when no chart matches', async () => {
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /login-names': () => json(loginNames),
      'GET /allocation/charts': () => json([]),
    });
    renderWithTheme(<ChartAllocationWorkspace />);
    await userEvent.type(await screen.findByLabelText('Search Chart ID'), 'NOPE-1');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No chart with the ID/)).toBeInTheDocument();
  });

  it('is closed to everyone but the Manager', async () => {
    mockApi({ 'GET /auth/me': () => json(HR) });
    renderWithTheme(<ChartAllocationWorkspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this page.');
  });

  it('puts Chart allocation in the Manager menu and Login Names nowhere else', () => {
    expect(navigationFor('MANAGER').map((i) => i.key)).toContain('allocation');
    expect(navigationFor('MANAGER').map((i) => i.key)).not.toContain('login-names');
    for (const role of ['HR', 'VENDOR_ADMIN', 'TEAM_LEAD', 'AUDITOR', 'CODER', 'GROUP_COACH'] as const) {
      expect(navigationFor(role).map((i) => i.key)).not.toContain('allocation');
    }
  });
});
