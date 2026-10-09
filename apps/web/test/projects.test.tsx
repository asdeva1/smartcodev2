import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigationFor } from '@/features/navigation/navigation';
import { CoderAllotmentWorkspace } from '@/features/projects/CoderAllotmentWorkspace';
import { CoderChartWorkspace } from '@/features/projects/CoderChartWorkspace';
import { ProjectDetailWorkspace } from '@/features/projects/ProjectDetailWorkspace';
import { ProjectsWorkspace } from '@/features/projects/ProjectsWorkspace';
import { buildAllocationCsv, parseChartIds } from '@/features/projects/AssignChartDialog';
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
  'project.read': 'ORG',
  'project.manage': 'ORG',
  'project.assignStaff': 'ORG',
  'chart.read': 'ORG',
  'chart.allocate': 'ORG',
  'report.read': 'ORG',
  'employee.read': 'ORG',
});
const CODER = profile('CODER', {
  'dashboard.coder': 'SELF',
  'production.submit': 'SELF',
  'project.read': 'PROJECT',
  'chart.read': 'SELF',
});

const base = {
  client: { id: 'c1', name: 'Acme Health' },
  vendor: null,
  status: 'ACTIVE',
  lead: { id: 'l1', fullName: 'Tina Lead' },
  memberCount: 2,
  chartCount: 5,
  createdAt: '2026-10-05T00:00:00.000Z',
};
const MANUAL = { ...base, id: 'p1', name: 'Cardiology Q4', allocationType: 'MANUAL' };
const AUTO = { ...base, id: 'p2', name: 'Auto Intake', allocationType: 'AUTOMATIC' };
const detail = (p: typeof MANUAL) => ({
  ...p,
  members: [
    {
      employeeId: 'm1',
      employeeCode: 'EMP-9',
      fullName: 'Naveen P',
      email: 'naveen@smartcluestech.com',
      projectRole: 'CODER',
      loginName: 'naveen@vlms.com',
      openCharts: 3,
      startedAt: '2026-10-05T00:00:00.000Z',
    },
  ],
  workingNow: 1,
  chartsByStatus: { ALLOCATED: 3, COMPLETED: 2 },
  submittedToClient: 0,
  clientPullbackAt: null,
});
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 25, total: items.length });

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

describe('navigation', () => {
  it('lists Projects for the Manager and offers coders their charts', () => {
    expect(navigationFor('MANAGER').map((i) => i.label)).toContain('Projects');
    expect(navigationFor('MANAGER').map((i) => i.label)).not.toContain('Clients & projects');
    expect(navigationFor('CODER').map((i) => i.label)).toEqual(expect.arrayContaining(['My charts']));
    // The Manager holds every permission but has no personal allotment.
    expect(navigationFor('MANAGER').map((i) => i.label)).not.toContain('My charts');
    expect(navigationFor('TEAM_LEAD').find((i) => i.key === 'projects')?.available).toBe(true);
  });
});

describe('Projects list', () => {
  it('shows client, project, allocation type, lead and members, and offers Create project', async () => {
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects': () => json(page([MANUAL, AUTO])),
    });
    renderWithTheme(<ProjectsWorkspace />);
    const table = await screen.findByRole('table', { name: 'Projects' });
    for (const heading of ['Client', 'Project', 'Allocation type', 'Project lead', 'Members']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(await within(table).findByRole('link', { name: 'Cardiology Q4' })).toHaveAttribute(
      'href',
      '/projects/p1',
    );
    expect(within(table).getByText('Manual')).toBeInTheDocument();
    expect(within(table).getByText('Automatic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });

  it('validates the create form, then creates the project and opens it', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/clients': () => json([{ id: 'c1', name: 'Acme Health', status: 'ACTIVE' }]),
      'GET /employees': () => json(page([])),
      'POST /projects': () => json({ ...detail(AUTO as typeof MANUAL), id: 'new1' }, 201),
      'GET /projects': () => json(page([MANUAL])),
    });
    renderWithTheme(<ProjectsWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByText('Client name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Project name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose Manual or Automatic')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Client name/), 'Acme Health');
    await user.type(within(dialog).getByRole('textbox', { name: /^Project( \*)?$/ }), 'Auto Intake');
    await user.click(within(dialog).getByLabelText(/Allocation type/));
    await user.click(await screen.findByRole('option', { name: 'Automatic' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/new1'));
    const post = calls.find((c) => c.init.method === 'POST' && c.url === '/projects');
    expect(JSON.parse(String(post?.init.body))).toEqual({
      clientName: 'Acme Health',
      name: 'Auto Intake',
      allocationType: 'AUTOMATIC',
    });
  });
});

describe('Project detail', () => {
  it('Manual project: lead, members, reports, live tracking and the chart allocation tab with CSV upload', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/p1/charts': () => json(page([])),
      'GET /projects/p1': () => json(detail(MANUAL)),
    });
    renderWithTheme(<ProjectDetailWorkspace />);
    expect(
      await screen.findByRole('heading', { level: 2, name: /Acme Health · Cardiology Q4/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Project members')).toBeInTheDocument();
    expect(screen.getAllByText('Tina Lead').length).toBeGreaterThan(0);
    const tabs = screen.getByRole('tablist', { name: 'Project sections' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Overview', 'Live tracking', 'Production report', 'Quality report', 'Chart allocation']);
    expect(screen.getByRole('table', { name: 'Project members' })).toBeInTheDocument();
    expect(screen.getByText('naveen@vlms.com')).toBeInTheDocument();

    await user.click(within(tabs).getByRole('tab', { name: 'Chart allocation' }));
    expect(await screen.findByRole('button', { name: /Pull back charts/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Completed charts \(2\)/ })).toBeEnabled();
    await user.click((await screen.findAllByRole('button', { name: 'Upload allocation CSV' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    for (const col of ['Login Name', 'Email ID', 'Chart ID', 'Pages', 'Page Bucket', 'Remarks']) {
      expect(within(dialog).getAllByText(new RegExp(col)).length).toBeGreaterThan(0);
    }
  });

  it('Assign chart: picks a coder, builds the allocation CSV from the typed Chart IDs and commits all-or-nothing', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/p1/charts': () => json(page([])),
      'POST /projects/p1/allocation/commit': () =>
        json({
          committed: true,
          created: 2,
          skipped: 0,
          createdIds: [],
          preview: { rows: [], fileErrors: [] },
        }),
      'GET /projects/p1': () => json(detail(MANUAL)),
    });
    renderWithTheme(<ProjectDetailWorkspace />);
    const tabs = await screen.findByRole('tablist', { name: 'Project sections' });
    await user.click(within(tabs).getByRole('tab', { name: 'Chart allocation' }));
    await user.click((await screen.findAllByRole('button', { name: 'Assign chart' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Coder on this project' }));
    await user.click(await screen.findByRole('option', { name: /Naveen P/ }));
    expect(within(dialog).getByLabelText(/Login Name/)).toHaveValue('naveen@vlms.com');
    await user.type(within(dialog).getByLabelText(/Chart ID/), 'CH-1{enter}CH-2');
    await user.click(within(dialog).getByRole('button', { name: /Assign 2 charts/ }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/allocation/commit'))).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url.endsWith('/allocation/commit'))!.init.body));
    expect(body.mode).toBe('all-or-nothing');
    expect(body.csv).toBe(
      'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks\n' +
        'naveen@vlms.com,naveen@smartcluestech.com,CH-1,,,\n' +
        'naveen@vlms.com,naveen@smartcluestech.com,CH-2,,,',
    );
  });

  it('Assign chart helpers: de-duplicate Chart IDs and quote CSV cells', () => {
    expect(parseChartIds('A1, A2;\nA1\n\n A3 ')).toEqual(['A1', 'A2', 'A3']);
    const csv = buildAllocationCsv({ loginName: 'l', email: 'e@x.y', chartIds: ['C'], remarks: 'a, "b"' });
    expect(csv.split('\n')[1]).toBe('l,e@x.y,C,,,"a, ""b"""');
  });

  it('Automatic project: no chart allocation option', async () => {
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/p1': () => json(detail(AUTO as typeof MANUAL)),
    });
    renderWithTheme(<ProjectDetailWorkspace />);
    await screen.findByRole('heading', { level: 2, name: /Auto Intake/ });
    const tabs = screen.getByRole('tablist', { name: 'Project sections' });
    expect(within(tabs).queryByRole('tab', { name: 'Chart allocation' })).not.toBeInTheDocument();
    expect(screen.getByText(/allocated automatically/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload allocation CSV' })).not.toBeInTheDocument();
  });

  it('Production report offers Today (Shift End), Monthly and Date range and asks for the matching period', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/p1/reports/production': () =>
        json({
          period: { range: 'today', from: '2026-10-09', to: '2026-10-09', timeZone: 'Asia/Kolkata' },
          totals: { charts: 3, pages: 40, icds: 12, dos: 7 },
          rows: [
            {
              coder: { id: 'm1', fullName: 'Naveen P', loginName: 'naveen@vlms.com' },
              charts: 3,
              pages: 40,
              icds: 12,
              dos: 7,
            },
          ],
        }),
      'GET /projects/p1': () => json(detail(MANUAL)),
    });
    renderWithTheme(<ProjectDetailWorkspace />);
    await screen.findByRole('heading', { level: 2, name: /Cardiology Q4/ });
    await user.click(screen.getByRole('tab', { name: 'Production report' }));
    const report = await screen.findByRole('table', { name: 'Production report' });
    expect(within(report).getByText('Naveen P')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today (Shift End)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Monthly' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('reports/production?range=month'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Date range' }));
    expect(await screen.findByText('Choose a start and end date.')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('Live tracking shows charts done today', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /projects/p1/live': () =>
        json({
          asOf: '2026-10-09T10:00:00.000Z',
          timeZone: 'Asia/Kolkata',
          today: '2026-10-09',
          doneToday: 7,
          inProduction: 2,
          allocated: 4,
          pendingAllocation: 9,
          days: [
            { date: '2026-10-08', chartsDone: 3 },
            { date: '2026-10-09', chartsDone: 7 },
          ],
          coders: [
            {
              coder: { id: 'm1', fullName: 'Naveen P', loginName: 'naveen@vlms.com' },
              doneToday: 7,
              inProduction: 2,
              allocated: 4,
            },
          ],
        }),
      'GET /projects/p1': () => json(detail(MANUAL)),
    });
    renderWithTheme(<ProjectDetailWorkspace />);
    await screen.findByRole('heading', { level: 2, name: /Cardiology Q4/ });
    await user.click(screen.getByRole('tab', { name: 'Live tracking' }));
    expect(await screen.findByText('Charts done today')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Charts done per day.*Today: 7/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charts by coder today' })).toBeInTheDocument();
  });
});

describe('Coder portal: My charts', () => {
  it('lists the allotted charts with pages, page bucket and remarks', async () => {
    mockApi({
      'GET /auth/me': () => json(CODER),
      'GET /allocation/mine': () =>
        json({
          loginName: 'naveen@vlms.com',
          total: 1,
          charts: [
            {
              id: 'ch1',
              chartId: 'CH-1001',
              status: 'ALLOCATED',
              pages: 12,
              pageBucket: '1-25',
              remarks: 'Priority',
              loginName: 'naveen@vlms.com',
              allocatedAt: '2026-10-09T08:00:00.000Z',
              heldAt: null,
              holdReason: null,
              project: { id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' },
            },
          ],
        }),
    });
    renderWithTheme(<CoderAllotmentWorkspace />);
    const table = await screen.findByRole('table', { name: 'Charts allotted to you' });
    expect(within(table).getByText('CH-1001')).toBeInTheDocument();
    expect(within(table).getByText('Acme Health · Cardiology Q4')).toBeInTheDocument();
    expect(within(table).getByText('1-25')).toBeInTheDocument();
    expect(within(table).getByText('Priority')).toBeInTheDocument();
    expect(screen.getAllByText('naveen@vlms.com').length).toBeGreaterThan(0);
  });

  it('shows the coder dashboard figures and marks held charts', async () => {
    mockApi({
      'GET /auth/me': () => json(CODER),
      'GET /production/dashboard': () =>
        json({
          totalCoded: 42,
          todayCoded: 7,
          cph: 5.5,
          activeHours: 7.6,
          auditPercentage: 96.4,
          auditedCharts: 10,
          totalErrors: 3,
          onHold: 1,
          pendingWork: 2,
          projects: [{ id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' }],
        }),
      'GET /allocation/mine': () =>
        json({
          loginName: 'naveen@vlms.com',
          total: 1,
          charts: [
            {
              id: 'ch1',
              chartId: 'CH-1001',
              status: 'IN_PRODUCTION',
              pages: 12,
              pageBucket: null,
              remarks: null,
              loginName: 'naveen@vlms.com',
              allocatedAt: '2026-10-09T08:00:00.000Z',
              heldAt: '2026-10-09T09:00:00.000Z',
              holdReason: 'Waiting on client',
              project: { id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' },
            },
          ],
        }),
    });
    renderWithTheme(<CoderAllotmentWorkspace />);
    const group = await screen.findByRole('group', { name: 'Your coding figures' });
    expect(within(group).getByText('Total charts coded')).toBeInTheDocument();
    expect(within(group).getByText('42')).toBeInTheDocument();
    expect(within(group).getByText('Today’s charts')).toBeInTheDocument();
    expect(within(group).getByText('7')).toBeInTheDocument();
    expect(within(group).getByText('5.5')).toBeInTheDocument();
    expect(within(group).getByText('96.4%')).toBeInTheDocument();
    expect(await screen.findByText('Allocated project')).toBeInTheDocument();
    expect(screen.getAllByText('Acme Health · Cardiology Q4').length).toBeGreaterThan(1);
    expect(await screen.findByText('On hold')).toBeInTheDocument();
  });

  it('says so when nothing is allotted', async () => {
    mockApi({
      'GET /auth/me': () => json(CODER),
      'GET /allocation/mine': () => json({ loginName: null, total: 0, charts: [] }),
    });
    renderWithTheme(<CoderAllotmentWorkspace />);
    expect(await screen.findByText('No charts allotted to you')).toBeInTheDocument();
    expect(screen.getByText(/has not given you a Login Name yet/)).toBeInTheDocument();
  });
});

describe('Coder portal: chart workspace', () => {
  const workspace = {
    id: 'ch1',
    chartId: 'CH-1001',
    status: 'IN_PRODUCTION',
    pages: 12,
    pageBucket: '1-25',
    remarks: null,
    loginName: 'naveen@vlms.com',
    heldAt: null,
    holdReason: null,
    project: { id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' },
  };

  it('shows Chart ID and pages read-only, then submits ICDs and DOS', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(CODER),
      'POST /production/charts/p1/open': () => json(workspace),
      'POST /production/charts/p1/submit': () =>
        json({ chartId: 'CH-1001', status: 'PENDING_AUDIT', icds: 5, dos: 2, pages: 12 }),
    });
    const user = userEvent.setup();
    renderWithTheme(<CoderChartWorkspace />);
    const chartId = await screen.findByLabelText('Chart ID');
    expect(chartId).toHaveValue('CH-1001');
    expect(chartId).toHaveAttribute('readonly');
    const project = screen.getByLabelText('Project');
    expect(project).toHaveValue('Acme Health · Cardiology Q4');
    expect(project).toHaveAttribute('readonly');
    const pages = screen.getByLabelText('No of pages');
    expect(pages).toHaveValue('12');
    expect(pages).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: 'Submit chart' }));
    expect(screen.getAllByText('Enter a whole number from 0 to 9999.')).toHaveLength(2);
    expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(false);

    await user.type(screen.getByLabelText('No of ICDs'), '5');
    await user.type(screen.getByLabelText('No of DOS'), '2');
    expect(screen.getByLabelText('Coded date')).toHaveAttribute('readonly');
    await user.type(screen.getByLabelText('Remarks'), 'Unclear scan');
    await user.click(screen.getByRole('button', { name: 'Submit chart' }));
    expect(await screen.findByText(/sent for audit/)).toBeInTheDocument();
    const submit = calls.find((c) => c.url.endsWith('/submit'));
    expect(JSON.parse(String(submit?.init.body))).toEqual({ icds: 5, dos: 2, remarks: 'Unclear scan' });
    await user.click(screen.getByRole('button', { name: 'Back to my charts' }));
    expect(push).toHaveBeenCalledWith('/coder');
  });

  it('holds a chart with a required reason, blocks submit while held, and resumes', async () => {
    const held = { ...workspace, heldAt: '2026-10-09T09:00:00.000Z', holdReason: 'Waiting on client' };
    const calls = mockApi({
      'GET /auth/me': () => json(CODER),
      'POST /production/charts/p1/open': () => json(workspace),
      'POST /production/charts/p1/hold': () => json(held),
      'POST /production/charts/p1/resume': () => json(workspace),
    });
    const user = userEvent.setup();
    renderWithTheme(<CoderChartWorkspace />);
    await screen.findByLabelText('Chart ID');
    await user.click(screen.getByRole('button', { name: 'Hold chart' }));
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByText('Enter the reason for holding this chart')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/hold'))).toBe(false);

    await user.type(screen.getByLabelText('Hold reason'), 'Waiting on client');
    await user.click(screen.getByRole('button', { name: 'Confirm hold' }));
    expect(await screen.findByText(/On hold\./)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on client/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit chart' })).toBeDisabled();
    expect(screen.getByLabelText('No of ICDs')).toBeDisabled();
    const hold = calls.find((c) => c.url.endsWith('/hold'));
    expect(JSON.parse(String(hold?.init.body))).toEqual({ reason: 'Waiting on client' });

    await user.click(screen.getByRole('button', { name: 'Resume chart' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit chart' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Hold chart' })).toBeInTheDocument();
  });

  it('explains when the chart is not available to this coder', async () => {
    mockApi({
      'GET /auth/me': () => json(CODER),
      'POST /production/charts/p1/open': () =>
        json(
          { type: 'x', title: 'Not found', status: 404, code: 'NOT_FOUND', detail: 'Chart not found' },
          404,
        ),
    });
    renderWithTheme(<CoderChartWorkspace />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
