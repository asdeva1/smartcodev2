import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyAccountWorkspace } from '@/features/account/MyAccountWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const profile = {
  employee: {
    id: 'e1',
    employeeCode: 'EMP-9',
    fullName: 'Naveen P',
    email: 'naveen@smartcluestech.com',
    role: 'CODER',
    status: 'ACTIVE',
    vendorId: null,
    loginName: 'naveen@vlms.com',
    loginNameEligible: true,
  },
  permissions: { 'dashboard.coder': 'SELF', 'production.submit': 'SELF' },
};

afterEach(() => vi.unstubAllGlobals());

describe('My account', () => {
  it('shows the signed-in person’s name, Emp ID, email, Client Login and projects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        if (path === '/auth/me') return json(profile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path === '/auth/my-account')
          return json({
            fullName: 'Naveen P',
            employeeCode: 'EMP-9',
            email: 'naveen@smartcluestech.com',
            role: 'CODER',
            status: 'ACTIVE',
            loginName: 'naveen@vlms.com',
            vendor: null,
            team: { id: 't1', name: 'Balaji team', teamLead: 'Tina Lead' },
            projects: [{ id: 'p1', name: 'Cardiology Q4', client: 'Acme Health', projectRole: 'CODER' }],
            activatedAt: '2026-10-05T00:00:00.000Z',
            createdAt: '2026-10-04T00:00:00.000Z',
          });
        return json({}, 404);
      }),
    );
    renderWithTheme(<MyAccountWorkspace />);
    expect(await screen.findByText('Emp ID')).toBeInTheDocument();
    for (const text of [
      'Naveen P',
      'EMP-9',
      'naveen@smartcluestech.com',
      'naveen@vlms.com',
      'In-house',
      'Balaji team · Lead: Tina Lead',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Acme Health · Cardiology Q4/)).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'My account' }))
      expect(link).toHaveAttribute('href', '/my-account');
  });
});
