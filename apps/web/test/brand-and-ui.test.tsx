import { screen } from '@testing-library/react';
import { CHART_STATUSES } from '@smartcode/shared';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { BrandLogo } from '@/components/BrandLogo';
import { EmptyState } from '@/components/EmptyState';
import { EnvironmentBadge } from '@/components/EnvironmentBadge';
import { LIFECYCLE_STAGES, LifecycleTrack } from '@/components/LifecycleTrack';
import { StatusChip } from '@/components/StatusChip';
import LandingPage from '@/app/page';
import LoginPage from '@/app/login/page';
import NotFound from '@/app/not-found';
import ManagerDashboardPage from '@/app/(workspace)/manager/page';
import { renderWithTheme } from './render';

describe('BrandLogo — official logo only', () => {
  it('serves the synced official asset with original proportions', () => {
    renderWithTheme(<BrandLogo width={298} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/brand/web/smartcode-logo-horizontal@1x.png');
    expect(img).toHaveAttribute('width', '298');
    expect(img).toHaveAttribute('height', String(Math.round((298 * 175) / 596)));
    expect(img.getAttribute('alt')).toContain('SmartClues Technology Product');
  });

  it('uses the full-resolution crop for large sizes and the mark when asked', () => {
    const { unmount } = renderWithTheme(<BrandLogo width={480} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/web/smartcode-logo-horizontal.png');
    unmount();
    renderWithTheme(<BrandLogo variant="mark" width={32} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/brand/web/smartcode-mark.png');
  });

  it('places the original logo in a light container on dark surfaces (no fabricated dark logo)', () => {
    renderWithTheme(<BrandLogo surface="dark" />);
    expect(screen.getByTestId('brand-logo-container')).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('src')).not.toMatch(/dark|white|transparent/);
  });
});

describe('pages show the logo', () => {
  it.each([
    ['landing', <LandingPage key="l" />],
    ['login', <LoginPage key="p" />],
    ['not found', <NotFound key="n" />],
  ])('%s page renders the official logo', (_, page) => {
    renderWithTheme(page);
    expect(
      screen.getAllByRole('img').some((i) => i.getAttribute('src')?.startsWith('/brand/web/smartcode-')),
    ).toBe(true);
  });

  it('login page has the sign-in form', () => {
    renderWithTheme(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
  });

  it('manager workspace renders the shell with the logo and empty state once signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            employee: {
              id: 'e1',
              employeeCode: 'MGR-1',
              fullName: 'Test Manager',
              email: 'm@example.test',
              role: 'MANAGER',
              status: 'ACTIVE',
              vendorId: null,
              loginName: null,
              loginNameEligible: false,
            },
            permissions: { 'dashboard.manager': 'ORG', 'employee.read': 'ORG' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    renderWithTheme(<ManagerDashboardPage />);
    expect(await screen.findByText('No production data yet')).toBeInTheDocument();
    expect(screen.getAllByAltText(/SmartCode/).length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

describe('AppShell', () => {
  it('shows only what the role may access and marks unbuilt modules unavailable', () => {
    renderWithTheme(
      <AppShell role="TEAM_LEAD" title="My team" currentPath="/team-lead" appEnv="staging">
        <p>content</p>
      </AppShell>,
    );
    expect(screen.queryAllByText('Chart allocation')).toHaveLength(0);
    expect(screen.queryAllByText('Audit reviews')).toHaveLength(0);
    expect(screen.getAllByText('My team').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Staging/).length).toBeGreaterThan(0);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('UI building blocks', () => {
  it.each(CHART_STATUSES)('StatusChip renders a readable label for %s', (status) => {
    renderWithTheme(<StatusChip status={status} />);
    expect(screen.getByText(/[A-Z][a-z]/)).toBeInTheDocument();
  });

  it('StatusChip uses the attention tone for review and rework', () => {
    renderWithTheme(<StatusChip status="REVIEW_REQUIRED" />);
    expect(screen.getByText('Review Required').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'attention',
    );
  });

  it('LifecycleTrack lists every stage and the Manager review loop', () => {
    renderWithTheme(<LifecycleTrack />);
    expect(screen.getAllByRole('listitem')).toHaveLength(LIFECYCLE_STAGES.length);
    expect(screen.getByText(/Manager decides/)).toBeInTheDocument();
  });

  it('EnvironmentBadge is hidden in production', () => {
    const { container } = renderWithTheme(<EnvironmentBadge appEnv="production" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('EmptyState is announced as status', () => {
    renderWithTheme(<EmptyState title="No charts" description="Import a client file to start." />);
    expect(screen.getByRole('status')).toHaveTextContent('Import a client file');
  });
});
