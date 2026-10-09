import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartRepositoryWorkspace } from '@/features/charts/ChartRepositoryWorkspace';
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
  permissions: { 'chart.read': 'ORG', 'project.read': 'ORG' },
};

afterEach(() => vi.unstubAllGlobals());

describe('Chart repository', () => {
  it('lists charts across projects, filters by status and opens a chart history', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        calls.push(path);
        if (path === '/auth/me') return json(profile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path.startsWith('/projects'))
          return json({
            items: [{ id: 'p1', name: 'Cardiology Q4', client: { id: 'c1', name: 'Acme Health' } }],
            page: 1,
            pageSize: 100,
            total: 1,
          });
        if (path.includes('/timeline'))
          return json({
            chart: {
              id: 'ch1',
              chartId: '609588329',
              status: 'PENDING_AUDIT',
              project: { id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' },
            },
            events: [
              {
                fromStatus: null,
                toStatus: 'PENDING_ALLOCATION',
                actor: null,
                reason: null,
                at: '2026-10-08T05:00:00.000Z',
              },
              {
                fromStatus: 'ALLOCATED',
                toStatus: 'IN_PRODUCTION',
                actor: { id: 'c1', fullName: 'Naveen P' },
                reason: null,
                at: '2026-10-09T05:00:00.000Z',
              },
            ],
          });
        return json({
          items: [
            {
              id: 'ch1',
              chartId: '609588329',
              status: 'PENDING_AUDIT',
              pages: 107,
              pageBucket: '100-249 Pages',
              project: { id: 'p1', name: 'Cardiology Q4', client: 'Acme Health' },
              coder: { id: 'c1', fullName: 'Naveen P', loginName: 'naveen@vlms.com' },
              updatedAt: '2026-10-09T05:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          statusCounts: { PENDING_AUDIT: 1, ALLOCATED: 4 },
        });
      }),
    );
    renderWithTheme(<ChartRepositoryWorkspace />);
    const table = await screen.findByRole('table', { name: 'Charts' });
    expect(within(table).getByText('609588329')).toBeInTheDocument();
    expect(within(table).getByText('Naveen P (naveen@vlms.com)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Allocated 4' }));
    await waitFor(() => expect(calls.some((c) => c.includes('status=ALLOCATED'))).toBe(true));

    await user.click(screen.getByRole('button', { name: 'History of 609588329' }));
    const history = await screen.findByRole('list', { name: 'Status history' });
    expect(within(history).getByText(/Allocated to In Production/)).toBeInTheDocument();
    expect(within(history).getByText(/Naveen P/)).toBeInTheDocument();
  });
});
