import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditChartWorkspace } from '@/features/audits/AuditChartWorkspace';
import { AuditQueueWorkspace } from '@/features/audits/AuditQueueWorkspace';
import { ReviewsWorkspace } from '@/features/audits/ReviewsWorkspace';
import { ReworkDetailWorkspace, ReworkWorkspace } from '@/features/audits/ReworkWorkspace';
import { navigationFor } from '@/features/navigation/navigation';
import { renderWithTheme } from './render';
import { push } from './setup';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const profile = (role: string, permissions: Record<string, string>) => ({
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Person',
    email: 'pat@example.test',
    role,
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions,
});
const AUDITOR = profile('AUDITOR', {
  'audit.perform': 'PROJECT',
  'audit.read': 'PROJECT',
  'project.read': 'PROJECT',
});
const MANAGER = profile('MANAGER', {
  'audit.resolveReview': 'ORG',
  'audit.read': 'ORG',
  'project.read': 'ORG',
});
const CODER = profile('CODER', {
  'rework.perform': 'SELF',
  'rework.read': 'SELF',
  'dashboard.coder': 'SELF',
});

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

const project = { id: 'pr1', name: 'Cardiology Q4', client: 'Acme Health' };
const queueItem = {
  id: 'p1',
  chartId: 'CH-1001',
  status: 'PENDING_AUDIT',
  project,
  coder: 'Naveen Coder',
  loginName: 'naveen@vlms.com',
  pages: 12,
  icds: 5,
  dos: 2,
  codedAt: '2026-10-09T08:00:00.000Z',
  isReAudit: false,
  version: 1,
};

describe('navigation for audit and rework', () => {
  it('shows each role its own pages', () => {
    expect(navigationFor('AUDITOR').map((i) => i.label)).toContain('Audit queue');
    expect(navigationFor('MANAGER').map((i) => i.label)).toContain('Audit reviews');
    expect(navigationFor('MANAGER').map((i) => i.label)).not.toContain('Audit queue');
    expect(navigationFor('CODER').map((i) => i.label)).toContain('Rework');
    expect(navigationFor('MANAGER').map((i) => i.label)).not.toContain('Rework');
  });
});

describe('Auditor: audit queue', () => {
  it('lists charts waiting for audit with a link to each', async () => {
    mockApi({
      'GET /auth/me': () => json(AUDITOR),
      'GET /audits/queue': () => json({ total: 1, items: [queueItem] }),
    });
    renderWithTheme(<AuditQueueWorkspace />);
    const table = await screen.findByRole('table', { name: 'Charts waiting for audit' });
    expect(within(table).getByText('Naveen Coder')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Audit chart CH-1001' })).toHaveAttribute(
      'href',
      '/auditor/charts/p1',
    );
  });

  it('says so when the queue is empty', async () => {
    mockApi({
      'GET /auth/me': () => json(AUDITOR),
      'GET /audits/queue': () => json({ total: 0, items: [] }),
    });
    renderWithTheme(<AuditQueueWorkspace />);
    expect(await screen.findByText('No charts waiting for audit')).toBeInTheDocument();
  });
});

describe('Auditor: audit a chart', () => {
  it('shows production read-only, computes the total and submits the audit', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(AUDITOR),
      'GET /audits/queue': () => json({ total: 1, items: [queueItem] }),
      'POST /audits/charts/p1/submit': () =>
        json({
          chartId: 'CH-1001',
          auditId: 'a1',
          result: 'PASS',
          chartStatus: 'COMPLETED',
          auditErrors: 1,
          errorExceptions: 2,
          totalErrors: 3,
        }),
    });
    const user = userEvent.setup();
    renderWithTheme(<AuditChartWorkspace />);
    for (const [label, value] of [
      ['Chart ID', 'CH-1001'],
      ['Page numbers', '12'],
      ['ICDs', '5'],
      ['DOS', '2'],
    ] as const) {
      const field = await screen.findByLabelText(label);
      expect(field).toHaveValue(value);
      expect(field).toHaveAttribute('readonly');
    }

    await user.click(screen.getByRole('button', { name: 'Submit audit' }));
    expect(screen.getAllByText('Enter a whole number from 0 to 9999.')).toHaveLength(2);
    expect(calls.some((c) => c.url.endsWith('/submit'))).toBe(false);

    await user.type(screen.getByLabelText('Audit Errors'), '1');
    await user.type(screen.getByLabelText('Error Exceptions'), '2');
    expect(screen.getByLabelText('Total Errors')).toHaveValue('3');
    await user.click(screen.getByRole('button', { name: 'Submit audit' }));
    expect(await screen.findByText(/passed and is completed/)).toBeInTheDocument();
    const submit = calls.find((c) => c.url.endsWith('/submit'));
    expect(JSON.parse(String(submit?.init.body))).toEqual({
      auditErrors: 1,
      errorExceptions: 2,
      result: 'PASS',
    });
  });
});

describe('Manager: audit reviews', () => {
  const review = {
    auditId: 'au1',
    id: 'p1',
    chartId: 'CH-2002',
    project,
    coder: 'Naveen Coder',
    auditor: 'Audrey Auditor',
    pages: 30,
    icds: 6,
    dos: 1,
    auditErrors: 5,
    errorExceptions: 1,
    totalErrors: 6,
    remarks: 'Missed codes',
    auditedAt: '2026-10-09T09:00:00.000Z',
    isReAudit: false,
  };

  it('approves a reviewed chart', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /audits/reviews': () => json({ total: 1, items: [review] }),
      'POST /audits/au1/resolve': () =>
        json({ chartId: 'CH-2002', auditId: 'au1', decision: 'APPROVED', chartStatus: 'COMPLETED' }),
    });
    const user = userEvent.setup();
    renderWithTheme(<ReviewsWorkspace />);
    expect(await screen.findByText('Missed codes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve chart CH-2002' }));
    expect(await screen.findByText(/CH-2002 was approved and is completed/)).toBeInTheDocument();
    const resolve = calls.find((c) => c.url === '/audits/au1/resolve');
    expect(JSON.parse(String(resolve?.init.body))).toEqual({ decision: 'APPROVED' });
  });

  it('needs a reason to send a chart back for rework', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(MANAGER),
      'GET /audits/reviews': () => json({ total: 1, items: [review] }),
      'POST /audits/au1/resolve': () =>
        json({ chartId: 'CH-2002', auditId: 'au1', decision: 'REJECTED', chartStatus: 'REWORK' }),
    });
    const user = userEvent.setup();
    renderWithTheme(<ReviewsWorkspace />);
    await user.click(await screen.findByRole('button', { name: 'Reject chart CH-2002' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Send back for rework' }));
    expect(
      await within(dialog).findByText('Give a reason when you send a chart back for rework'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/resolve'))).toBe(false);

    await user.type(within(dialog).getByLabelText('Reason'), 'Recode the diagnoses');
    await user.click(within(dialog).getByRole('button', { name: 'Send back for rework' }));
    expect(await screen.findByText(/was sent back to Naveen Coder for rework/)).toBeInTheDocument();
    const resolve = calls.find((c) => c.url === '/audits/au1/resolve');
    expect(JSON.parse(String(resolve?.init.body))).toEqual({
      decision: 'REJECTED',
      reason: 'Recode the diagnoses',
    });
  });
});

describe('Coder: rework', () => {
  const rework = {
    id: 'p1',
    chartId: 'CH-2002',
    chart: 'ch2',
    status: 'OPEN',
    reason: 'Recode the diagnoses',
    project,
    pages: 30,
    previousIcds: 6,
    previousDos: 1,
    assignedAt: '2026-10-09T10:00:00.000Z',
  };

  it('lists charts sent back with the reason', async () => {
    mockApi({
      'GET /auth/me': () => json(CODER),
      'GET /rework/mine': () => json({ total: 1, items: [rework] }),
    });
    renderWithTheme(<ReworkWorkspace />);
    const table = await screen.findByRole('table', { name: 'Charts sent back for rework' });
    expect(within(table).getByText('Recode the diagnoses')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Rework chart CH-2002' })).toHaveAttribute(
      'href',
      '/rework/p1',
    );
  });

  it('submits corrected ICDs and DOS', async () => {
    const calls = mockApi({
      'GET /auth/me': () => json(CODER),
      'GET /rework/mine': () => json({ total: 1, items: [rework] }),
      'POST /rework/p1/submit': () => json({ chartId: 'CH-2002', status: 'RE_AUDIT', icds: 9, dos: 3 }),
    });
    const user = userEvent.setup();
    renderWithTheme(<ReworkDetailWorkspace />);
    expect(await screen.findByText('Recode the diagnoses')).toBeInTheDocument();
    expect(screen.getByLabelText('Chart ID')).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getAllByText('Enter a whole number from 0 to 9999.')).toHaveLength(2);
    await user.type(screen.getByLabelText('ICDs'), '9');
    await user.type(screen.getByLabelText('DOS'), '3');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/goes to audit again/)).toBeInTheDocument();
    const submit = calls.find((c) => c.url === '/rework/p1/submit');
    expect(JSON.parse(String(submit?.init.body))).toEqual({ icds: 9, dos: 3 });
    await waitFor(() => expect(push).not.toHaveBeenCalled());
  });
});
