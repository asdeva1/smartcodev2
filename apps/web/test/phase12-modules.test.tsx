import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HrIntegrationWorkspace } from '@/features/hr-integration/HrIntegrationWorkspace';
import { InternalAuditWorkspace } from '@/features/internal-audit/InternalAuditWorkspace';
import { VisitorsWorkspace } from '@/features/visitors/VisitorsWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const me = (role: string, permissions: Record<string, string>) => ({
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Person',
    email: 'p@example.test',
    role,
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions: { 'notification.read': 'SELF', ...permissions },
});

afterEach(() => vi.unstubAllGlobals());

function stub(
  profile: ReturnType<typeof me>,
  routes: Record<string, unknown>,
  calls: { path: string; method?: string }[] = [],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      calls.push({ path, method: init?.method });
      if (path === '/auth/me') return json(profile);
      if (path === '/notifications') return json({ unread: 0, items: [] });
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      return json(key ? routes[key] : {});
    }),
  );
  return calls;
}

const visit = {
  id: 'v1',
  status: 'EXPECTED',
  visitor: { id: 'vi1', fullName: 'Asha Verma', company: 'Acme Health', phone: null, email: null },
  host: { id: 'h1', fullName: 'Hari Host' },
  purpose: 'Contract review',
  expectedAt: null,
  badgeNumber: null,
  checkedInAt: null,
  checkedOutAt: null,
  notes: null,
  createdAt: '2026-10-10T05:00:00.000Z',
};

describe('Visitors', () => {
  it('lists visits and checks an expected visitor in', async () => {
    const calls = stub(me('HR', { 'visitor.manage': 'ORG' }), {
      '/visits/v1/check-in': { ...visit, status: 'CHECKED_IN', badgeNumber: 'V-20261010-001' },
      '/visits/v1/badge': {
        badgeNumber: 'V-20261010-001',
        visitorName: 'Asha Verma',
        company: 'Acme Health',
        hostName: 'Hari Host',
        date: '2026-10-10',
        checkedInAt: '2026-10-10T05:30:00.000Z',
      },
      '/visits': { items: [visit], page: 1, pageSize: 50, total: 1, insideNow: 0 },
    });
    renderWithTheme(<VisitorsWorkspace />);
    expect(await screen.findByText('Asha Verma')).toBeInTheDocument();
    expect(screen.getByText('Hari Host')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(calls).toContainEqual({ path: '/visits/v1/check-in', method: 'POST' }));
    expect(await screen.findByText('V-20261010-001')).toBeInTheDocument();
  });
});

describe('Internal audit', () => {
  it('shows agreement per auditor and draws a sample to review', async () => {
    stub(me('MANAGER', { 'internalAudit.access': 'ORG' }), {
      '/internal-audit/summary': {
        reviewed: 3,
        agreed: 1,
        agreementPct: 33.3,
        auditors: [
          {
            auditorId: 'a1',
            auditor: 'Anita Auditor',
            reviewed: 3,
            agreed: 1,
            agreementPct: 33.3,
            averageGap: 0.7,
          },
        ],
      },
      '/internal-audit/reviews': { items: [], page: 1, pageSize: 25, total: 0 },
      '/internal-audit/sample': [
        {
          auditId: 'au1',
          chartRef: 'CH-100',
          project: 'Acme Project',
          coder: 'Cody Coder',
          auditor: 'Anita Auditor',
          icds: 5,
          dos: 2,
          auditorErrors: 1,
          auditedAt: '2026-10-09T05:00:00.000Z',
        },
      ],
    });
    renderWithTheme(<InternalAuditWorkspace />);
    expect(await screen.findByText('Anita Auditor')).toBeInTheDocument();
    expect(screen.getAllByText('33.3%').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Draw a sample' }));
    expect(await screen.findByText('CH-100')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    // The auditor's own total is not shown before the Manager counts.
    expect(await screen.findByText(/Count the errors yourself first/)).toBeInTheDocument();
  });
});

describe('Smart HRMS', () => {
  it('says that no HRMS is connected and lists the integration points', async () => {
    stub(me('HR', { 'hrIntegration.read': 'ORG' }), {
      '/hr-integration/status': {
        configured: false,
        adapter: 'none',
        identity: 'EMPLOYEE_ID',
        message: 'Smart HRMS is not connected yet.',
        points: [
          {
            key: 'employee-master',
            title: 'Employee master data',
            purpose: 'Compare details.',
            direction: 'HRMS_TO_SMARTCODE',
          },
        ],
      },
    });
    renderWithTheme(<HrIntegrationWorkspace />);
    expect(await screen.findByText(/not connected yet/)).toBeInTheDocument();
    expect(screen.getByText('Employee master data')).toBeInTheDocument();
    expect(screen.getByText('From HRMS')).toBeInTheDocument();
  });
});
