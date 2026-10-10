import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalsWorkspace } from '@/features/approvals/ApprovalsWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const me = (role: string, id = 'e1') => ({
  employee: {
    id,
    employeeCode: 'X-1',
    fullName: 'Pat Person',
    email: 'p@example.test',
    role,
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions: {
    'approval.decide': 'ORG',
    'notification.read': 'SELF',
    'employee.read': 'TEAM',
    'project.read': 'PROJECT',
  },
});

const pending = {
  id: 'a1',
  type: 'EMPLOYEE_DEACTIVATION',
  status: 'PENDING',
  subject: 'Naveen P',
  entityId: 'c1',
  requester: { id: 'tl1', fullName: 'Tina Lead', role: 'TEAM_LEAD' },
  request: { reason: 'Left the company', loginName: null },
  comments: null,
  decisionComments: null,
  resolvedBy: null,
  createdAt: '2026-10-09T05:00:00.000Z',
  resolvedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

function stub(role: string, id: string, calls: { path: string; body?: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
      calls.push({ path, body: init?.body as string | undefined });
      if (path === '/auth/me') return json(me(role, id));
      if (path === '/notifications') return json({ unread: 0, items: [] });
      if (path.startsWith('/employees'))
        return json({
          items: [{ id: 'c1', fullName: 'Naveen P', employeeCode: 'C-1' }],
          page: 1,
          pageSize: 100,
          total: 1,
        });
      if (path.endsWith('/decision')) return json({ ...pending, status: 'APPROVED' });
      if (path === '/approvals' && init?.method === 'POST') return json(pending, 201);
      return json({ items: [pending], page: 1, pageSize: 25, total: 1, pendingCount: 1 });
    }),
  );
}

describe('Approvals', () => {
  it('Manager approves a pending request', async () => {
    const user = userEvent.setup();
    const calls: { path: string; body?: string }[] = [];
    stub('MANAGER', 'm1', calls);
    renderWithTheme(<ApprovalsWorkspace />);
    const table = await screen.findByRole('table', { name: 'Approval requests' });
    expect(within(table).getByText('Deactivate employee')).toBeInTheDocument();
    expect(within(table).getByText('Tina Lead')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve Naveen P' }));
    await user.click(await screen.findByRole('button', { name: 'Approve and carry out' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/approvals/a1/decision')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path.endsWith('/decision'))!.body!)).toMatchObject({
      decision: 'APPROVED',
    });
  });

  it('Manager must give a reason to reject', async () => {
    const user = userEvent.setup();
    stub('MANAGER', 'm1', []);
    renderWithTheme(<ApprovalsWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Reject Naveen P' }));
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Say why you are rejecting this')).toBeInTheDocument();
  });

  it('Team Lead asks for approval and can cancel their own open request', async () => {
    const user = userEvent.setup();
    const calls: { path: string; body?: string }[] = [];
    stub('TEAM_LEAD', 'tl1', calls);
    renderWithTheme(<ApprovalsWorkspace />);
    expect(await screen.findByRole('button', { name: 'Cancel Naveen P' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Naveen P' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ask for approval' }));
    await user.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Choose who or what this is about')).toBeInTheDocument();
  });
});
