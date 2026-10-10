import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoachWorkspace } from '@/features/dashboards/CoachWorkspace';
import { TeamLeadWorkspace } from '@/features/dashboards/TeamLeadWorkspace';
import { VendorDashboardWorkspace } from '@/features/dashboards/VendorDashboardWorkspace';
import { ManagerDashboardWorkspace } from '@/features/dashboards/ManagerDashboardWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const profile = {
  employee: {
    id: 'e1',
    employeeCode: 'MGR-1',
    fullName: 'Pat Manager',
    email: 'pat@example.test',
    role: 'MANAGER',
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions: { 'dashboard.manager': 'ORG', 'employee.read': 'ORG' },
};

const dashboard = (filter: { vendorId: string | null; name: string } | null) => ({
  asOf: '2026-10-09T10:00:00.000Z',
  timeZone: 'Asia/Kolkata',
  monthFrom: '2026-10-01',
  filter,
  people: { projects: 4, teams: 2, activeTeamLeads: 2, activeAuditors: 3, activeCoders: 18 },
  charts: {
    total: 1234,
    completed: 300,
    pendingAllocation: 600,
    inProgress: 120,
    pendingAudit: 40,
    reviewRequired: 5,
    pendingRework: 7,
    byStatus: { COMPLETED: 300, PENDING_ALLOCATION: 600 },
  },
  audits: { pending: 40, completed: 250 },
  production: {
    today: { charts: 22, pages: 410, icds: 90, dos: 45 },
    month: { charts: 310, pages: 5400, icds: 1100, dos: 600 },
  },
  performance: { cph: 6.4, activeHours: 48.4, auditPercentage: 97.2, auditedCharts: 120, totalErrors: 33 },
  vendors: [
    {
      vendorId: null,
      name: 'In-house',
      activeCoders: 10,
      chartsToday: 12,
      chartsMonth: 150,
      pagesMonth: 2500,
      cph: 7,
      auditPercentage: 98.1,
      completedCharts: 200,
    },
    {
      vendorId: 'v1',
      name: 'Balaji Vendor',
      activeCoders: 8,
      chartsToday: 10,
      chartsMonth: 160,
      pagesMonth: 2900,
      cph: null,
      auditPercentage: null,
      completedCharts: 100,
    },
  ],
});

afterEach(() => vi.unstubAllGlobals());

describe('Manager dashboard', () => {
  it('shows the counts, production, CPH, audit % and vendor performance, and filters by vendor', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        calls.push(path);
        if (path === '/auth/me') return json(profile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path.startsWith('/vendors'))
          return json({ items: [{ id: 'v1', name: 'Balaji Vendor' }], page: 1, pageSize: 100, total: 1 });
        if (path.includes('vendorId=v1')) return json(dashboard({ vendorId: 'v1', name: 'Balaji Vendor' }));
        return json(dashboard(null));
      }),
    );
    renderWithTheme(<ManagerDashboardWorkspace />);
    expect(await screen.findByText('Active projects')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('6.4')).toBeInTheDocument();
    expect(screen.getByText('97.2%')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Vendor performance' });
    expect(within(table).getByText('In-house')).toBeInTheDocument();
    expect(within(table).getByText('Balaji Vendor')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Show' }));
    await user.click(await screen.findByRole('option', { name: 'Balaji Vendor' }));
    await waitFor(() => expect(calls.some((c) => c.includes('/dashboards/manager?vendorId=v1'))).toBe(true));
  });
});

describe('Vendor dashboard', () => {
  it('shows the vendor’s own figures and a row per coder', async () => {
    const vendorProfile = {
      employee: { ...profile.employee, role: 'VENDOR_ADMIN', vendorId: 'v1', fullName: 'Vera Admin' },
      permissions: { 'dashboard.vendor': 'VENDOR', 'employee.read': 'VENDOR' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        if (path === '/auth/me') return json(vendorProfile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        return json({
          ...dashboard({ vendorId: 'v1', name: 'Balaji Vendor' }),
          vendor: { id: 'v1', name: 'Balaji Vendor' },
          coders: [
            {
              coderId: 'c1',
              fullName: 'Naveen P',
              loginName: 'naveen@vlms.com',
              chartsToday: 3,
              chartsMonth: 40,
              pagesMonth: 800,
              cph: 6.5,
              auditPercentage: null,
              openCharts: 12,
            },
          ],
        });
      }),
    );
    renderWithTheme(<VendorDashboardWorkspace />);
    const table = await screen.findByRole('table', { name: 'Coder performance' });
    expect(within(table).getByText('Naveen P')).toBeInTheDocument();
    expect(within(table).getByText('naveen@vlms.com')).toBeInTheDocument();
    expect(within(table).getByText('6.5')).toBeInTheDocument();
    expect(screen.getByText('Active projects')).toBeInTheDocument();
    expect(screen.getByText(/Balaji Vendor\./)).toBeInTheDocument();
  });
});

const roleMock = (role: string, permission: string, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      if (path === '/auth/me')
        return json({
          employee: { ...profile.employee, role, fullName: 'Sam Person' },
          permissions: { [permission]: 'TEAM' },
        });
      if (path === '/notifications') return json({ unread: 0, items: [] });
      return json(body);
    }),
  );

describe('Team Lead workspace', () => {
  it('shows team figures, what is waiting and a row per coder', async () => {
    roleMock('TEAM_LEAD', 'dashboard.teamLead', {
      asOf: '2026-10-09T10:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      monthFrom: '2026-10-01',
      teams: [{ id: 't1', name: 'Alpha' }],
      totals: {
        coders: 2,
        openCharts: 9,
        chartsToday: 4,
        chartsMonth: 50,
        pagesMonth: 900,
        cph: 6.2,
        auditPercentage: 96.5,
        auditedCharts: 20,
        totalErrors: 3,
      },
      pending: { audit: 5, reviewRequired: 1, rework: 2 },
      coders: [
        {
          coderId: 'c1',
          fullName: 'Naveen P',
          loginName: 'naveen@vlms.com',
          chartsToday: 4,
          chartsMonth: 50,
          pagesMonth: 900,
          cph: 6.2,
          auditPercentage: 96.5,
          openCharts: 9,
        },
      ],
    });
    renderWithTheme(<TeamLeadWorkspace />);
    const table = await screen.findByRole('table', { name: 'Team coders' });
    expect(within(table).getByText('Naveen P')).toBeInTheDocument();
    expect(screen.getByText('Pending audit')).toBeInTheDocument();
    expect(screen.getAllByText('96.5%').length).toBeGreaterThan(1);
  });

  it('says so when the Team Lead leads no team', async () => {
    roleMock('TEAM_LEAD', 'dashboard.teamLead', {
      asOf: '2026-10-09T10:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      monthFrom: '2026-10-01',
      teams: [],
      totals: {},
      pending: {},
      coders: [],
    });
    renderWithTheme(<TeamLeadWorkspace />);
    expect(await screen.findByText('You do not lead a team yet')).toBeInTheDocument();
  });
});

describe('Quality coaching', () => {
  it('lists projects and the coders with the lowest accuracy first', async () => {
    roleMock('GROUP_COACH', 'dashboard.groupCoach', {
      asOf: '2026-10-09T10:00:00.000Z',
      timeZone: 'Asia/Kolkata',
      monthFrom: '2026-10-01',
      totals: {
        projects: 1,
        auditedCharts: 10,
        auditPercentage: 92.5,
        totalErrors: 8,
        reviewRequired: 2,
        openRework: 1,
      },
      projects: [
        {
          projectId: 'p1',
          name: 'Cardiology Q4',
          client: 'Acme Health',
          auditedCharts: 10,
          auditPercentage: 92.5,
          totalErrors: 8,
          reviewRequired: 2,
          openRework: 1,
        },
      ],
      coders: [
        {
          coderId: 'c1',
          fullName: 'Naveen P',
          loginName: 'naveen@vlms.com',
          auditedCharts: 10,
          auditPercentage: 92.5,
          auditErrors: 5,
          errorExceptions: 3,
          totalErrors: 8,
        },
      ],
    });
    renderWithTheme(<CoachWorkspace />);
    const projects = await screen.findByRole('table', { name: 'Project quality' });
    expect(within(projects).getByText('Cardiology Q4')).toBeInTheDocument();
    const coders = screen.getByRole('table', { name: 'Coder quality' });
    expect(within(coders).getByText('Naveen P')).toBeInTheDocument();
    expect(within(coders).getByText('Error exceptions', { selector: 'th' })).toBeInTheDocument();
  });
});
