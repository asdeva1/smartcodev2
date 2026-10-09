import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
