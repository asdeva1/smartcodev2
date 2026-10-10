import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityWorkspace, AuditLogWorkspace } from '@/features/logs/LogsWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const me = (role: string, permissions: Record<string, string>) => ({
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Manager',
    email: 'p@example.test',
    role,
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions,
});

afterEach(() => vi.unstubAllGlobals());

describe('Audit log and Activity', () => {
  it('Audit log lists entries, filters by action and shows what changed', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        calls.push(path);
        if (path === '/auth/me') return json(me('MANAGER', { 'auditLog.read': 'ORG' }));
        if (path === '/notifications') return json({ unread: 0, items: [] });
        return json({
          items: [
            {
              id: 'a1',
              action: 'CHART.ALLOCATED',
              entityType: 'Chart',
              entityId: null,
              outcome: 'SUCCESS',
              actor: { id: 'm1', fullName: 'Pat Manager', role: 'MANAGER' },
              ipAddress: '10.0.0.1',
              requestId: null,
              before: null,
              after: { status: 'ALLOCATED' },
              createdAt: '2026-10-09T05:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }),
    );
    renderWithTheme(<AuditLogWorkspace />);
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).getByText('CHART.ALLOCATED')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Action starts with'), 'CHART');
    await waitFor(() => expect(calls.some((c) => c.includes('action=CHART'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Details of CHART.ALLOCATED' }));
    expect(await screen.findByText(/"status": "ALLOCATED"/)).toBeInTheDocument();
  });

  it('Activity shows what happened in the person’s own scope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        if (path === '/auth/me') return json(me('TEAM_LEAD', { 'activityLog.read': 'TEAM' }));
        if (path === '/notifications') return json({ unread: 0, items: [] });
        return json({
          items: [
            {
              id: 'x1',
              action: 'PRODUCTION.SUBMITTED',
              entityType: 'Chart',
              entityId: null,
              actor: { id: 'c1', fullName: 'Naveen P', role: 'CODER' },
              metadata: { charts: 3 },
              createdAt: '2026-10-09T05:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
        });
      }),
    );
    renderWithTheme(<ActivityWorkspace />);
    const table = await screen.findByRole('table', { name: 'Activity' });
    expect(within(table).getByText('Naveen P')).toBeInTheDocument();
    expect(within(table).getByText('charts: 3')).toBeInTheDocument();
  });
});
