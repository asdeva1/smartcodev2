import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessagesWorkspace } from '@/features/collaboration/MessagesWorkspace';
import { renderWithTheme } from './render';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const profile = {
  employee: {
    id: 'e1',
    employeeCode: 'X-1',
    fullName: 'Pat Person',
    email: 'p@example.test',
    role: 'CODER',
    status: 'ACTIVE',
    vendorId: null,
    loginName: null,
    loginNameEligible: false,
  },
  permissions: { 'notification.read': 'SELF' },
};

const channel = {
  id: 'c1',
  kind: 'TEAM',
  name: 'Alpha Team',
  topic: null,
  teamId: 't1',
  otherPerson: null,
  unread: 2,
  lastMessageAt: '2026-10-10T05:00:00.000Z',
  lastMessagePreview: 'Morning team',
  memberCount: 3,
  canManage: false,
  joined: true,
  archived: false,
};
const message = {
  id: 'm1',
  channelId: 'c1',
  author: { id: 'e2', fullName: 'Ravi Lead', role: 'TEAM_LEAD' },
  body: 'Morning team',
  deleted: false,
  edited: false,
  createdAt: '2026-10-10T05:00:00.000Z',
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('Messages', () => {
  it('shows the team channel, its messages and sends a new one', async () => {
    const calls: { path: string; method?: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        calls.push({ path, method: init?.method, body: init?.body as string | undefined });
        if (path === '/auth/me') return json(profile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path === '/collab/config') return json({ callsEnabled: false, callsUrl: null });
        if (path === '/collab/channels') return json([channel]);
        if (path === '/collab/channels/c1') return json({ ...channel, members: [] });
        if (path.startsWith('/collab/channels/c1/messages') && init?.method === 'POST') {
          return json(
            {
              ...message,
              id: 'm2',
              author: { id: 'e1', fullName: 'Pat Person', role: 'CODER' },
              body: 'On it',
            },
            201,
          );
        }
        if (path.startsWith('/collab/channels/c1/messages'))
          return json({ items: [message], hasMore: false });
        return new Response(null, { status: 204 });
      }),
    );
    renderWithTheme(<MessagesWorkspace />);
    expect(await screen.findByRole('heading', { name: '# Alpha Team' })).toBeInTheDocument();
    expect(await screen.findByText(/Ravi Lead/)).toBeInTheDocument();
    expect(screen.getByText(/Do not share patient information/)).toBeInTheDocument();
    expect(screen.getByText('Calls not set up yet')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'On it');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        path: '/collab/channels/c1/messages',
        method: 'POST',
        body: JSON.stringify({ body: 'On it' }),
      }),
    );
    expect(await screen.findByText('On it')).toBeInTheDocument();
  });

  it('offers audio, video and join buttons when calls are set up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '');
        if (path === '/auth/me') return json(profile);
        if (path === '/notifications') return json({ unread: 0, items: [] });
        if (path === '/collab/config')
          return json({ callsEnabled: true, callsUrl: 'wss://calls.example.test' });
        if (path === '/collab/channels') return json([channel]);
        if (path === '/collab/channels/c1') return json({ ...channel, members: [] });
        return json({ items: [], hasMore: false });
      }),
    );
    renderWithTheme(<MessagesWorkspace />);
    expect(await screen.findByRole('button', { name: 'Video call' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Audio call' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Join call' })).toBeEnabled();
  });
});
