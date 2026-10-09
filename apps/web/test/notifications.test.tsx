import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '@/components/NotificationBell';
import { renderWithTheme } from './render';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = (id: string, readAt: string | null) => ({
  id,
  type: 'AUDIT_ERRORS',
  subject: `Audit errors on chart ${id}`,
  message: '2 errors found (1 audit, 1 exception).',
  entityType: 'Chart',
  entityId: 'c1',
  readAt,
  createdAt: '2026-10-09T08:00:00.000Z',
});

describe('Notification bell', () => {
  it('shows the unread count, lists notifications and marks them read', async () => {
    let unread = 1;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.replace(/^.*\/api\/v1/, '').replace(/^https?:\/\/[^/]+/, '');
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path.endsWith('/notifications') && !init?.method)
          return json({ unread, items: [item('A-1', unread ? null : '2026-10-09T09:00:00.000Z')] });
        if (path.endsWith('/read-all')) {
          unread = 0;
          return json({ marked: 1 });
        }
        if (path.includes('/read')) {
          unread = 0;
          return new Response(null, { status: 204 });
        }
        return json({}, 404);
      }),
    );
    const user = userEvent.setup();
    renderWithTheme(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(bell);
    expect(await screen.findByText('Audit errors on chart A-1')).toBeInTheDocument();
    expect(screen.getByText('2 errors found (1 audit, 1 exception).')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/read'))).toBe(true);
  });

  it('stays quiet when notifications cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ title: 'x', status: 500, code: 'INTERNAL_ERROR', type: 'x' }, 500)),
    );
    renderWithTheme(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});
