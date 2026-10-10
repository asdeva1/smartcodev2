import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsWorkspace } from '@/features/reports/ReportsWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Reports hub', () => {
  it('runs a report for the chosen project and offers Excel, CSV and PDF downloads', async () => {
    const user = userEvent.setup();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        calls.push(path);
        if (path === '/auth/me')
          return json({
            employee: {
              id: 'e1',
              employeeCode: 'M-1',
              fullName: 'Pat Manager',
              email: 'p@example.test',
              role: 'MANAGER',
              status: 'ACTIVE',
              vendorId: null,
              loginName: null,
              loginNameEligible: false,
            },
            permissions: { 'report.read': 'ORG', 'project.read': 'ORG' },
          });
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path.startsWith('/projects?'))
          return json({
            items: [{ id: 'p1', name: 'Cardiology Q4', client: { id: 'c1', name: 'Acme Health' } }],
            page: 1,
            pageSize: 100,
            total: 1,
          });
        if (path.includes('/export'))
          return new Response('x', {
            status: 200,
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': 'attachment; filename="r.pdf"',
            },
          });
        return json({
          period: { range: 'today', from: '2026-10-09', to: '2026-10-09', timeZone: 'Asia/Kolkata' },
          totals: { charts: 0, pages: 0, icds: 0, dos: 0 },
          rows: [],
        });
      }),
    );
    renderWithTheme(<ReportsWorkspace />);
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith('/projects/p1/reports/production'))).toBe(true),
    );
    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));
    await waitFor(() =>
      expect(calls.some((c) => c.includes('production/export') && c.includes('format=pdf'))).toBe(true),
    );
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Quality report' }));
    await waitFor(() => expect(calls.some((c) => c.startsWith('/projects/p1/reports/quality'))).toBe(true));
  });
});
