'use client';

import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  type ChannelCreate,
  type ChannelDetail,
  type ChannelMessages,
  type ChannelPerson,
  type ChannelRecord,
  type CollaborationConfig,
  type MessageRecord,
  MESSAGE_MAX_LENGTH,
  channelCreateSchema,
} from '@smartcode/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction } from '../admin/ui';
import { CallDialog } from './CallDialog';

const LIST_REFRESH_MS = 10_000;
const MESSAGE_REFRESH_MS = 4_000;

const ROLE_LABEL: Record<string, string> = {
  MANAGER: 'Manager',
  CODER: 'Coder',
  AUDITOR: 'Auditor',
  TEAM_LEAD: 'Team Lead',
  GROUP_COACH: 'Group Coach',
  VENDOR_ADMIN: 'Vendor Admin',
  HR: 'HR',
};

/** Refreshes while the browser tab is in view, and once more when it comes back. */
function usePolling(fn: () => void, intervalMs: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

function PersonPicker({
  label,
  onPick,
  exclude = [],
}: {
  label: string;
  onPick: (person: ChannelPerson) => void;
  exclude?: string[];
}) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<ChannelPerson[]>([]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<ChannelPerson[]>(`/collab/people?q=${encodeURIComponent(q)}`)
        .then((people) => {
          if (!cancelled) setOptions(people.filter((p) => !exclude.includes(p.id)));
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exclude.join(',')]);
  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => o.fullName}
      filterOptions={(o) => o}
      inputValue={q}
      onInputChange={(_, value, reason) => reason !== 'reset' && setQ(value)}
      value={null}
      onChange={(_, value) => {
        if (value) {
          onPick(value);
          setQ('');
        }
      }}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          {o.fullName} · {ROLE_LABEL[o.role] ?? o.role}
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}

function NewChannelDialog({ onClose }: { onClose: (created: ChannelDetail | null) => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [kind, setKind] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [members, setMembers] = useState<ChannelPerson[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useAction<ChannelDetail>((created) => onClose(created));
  return (
    <FormDialog
      title="New channel"
      submitLabel="Create channel"
      onClose={() => onClose(null)}
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        const parsed = channelCreateSchema.safeParse({
          name,
          topic,
          kind,
          memberIds: members.map((m) => m.id),
        });
        if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Check the name');
        setFieldError(null);
        const body: ChannelCreate = parsed.data;
        void action.run(() =>
          apiFetch<ChannelDetail>('/collab/channels', { method: 'POST', body: JSON.stringify(body) }),
        );
      }}
    >
      <TextField
        label="Channel name"
        size="small"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(fieldError)}
        helperText={fieldError ?? 'For example: coding-questions'}
      />
      <TextField
        label="Topic (optional)"
        size="small"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />
      <TextField
        select
        size="small"
        label="Who can join"
        value={kind}
        onChange={(e) => setKind(e.target.value as 'PUBLIC' | 'PRIVATE')}
        helperText={
          kind === 'PUBLIC'
            ? 'Anyone you work with can find and join this channel.'
            : 'Only the people you add can see this channel.'
        }
      >
        <MenuItem value="PUBLIC">Open to everyone</MenuItem>
        <MenuItem value="PRIVATE">Private</MenuItem>
      </TextField>
      <PersonPicker
        label="Add people"
        exclude={members.map((m) => m.id)}
        onPick={(p) => setMembers((m) => [...m, p])}
      />
      {members.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {members.map((m) => (
            <Chip
              key={m.id}
              label={m.fullName}
              onDelete={() => setMembers((list) => list.filter((x) => x.id !== m.id))}
            />
          ))}
        </Box>
      )}
    </FormDialog>
  );
}

function NewDirectDialog({ onClose }: { onClose: (opened: ChannelDetail | null) => void }) {
  const action = useAction<ChannelDetail>((opened) => onClose(opened));
  return (
    <FormDialog
      title="New message"
      hideSubmit
      onClose={() => onClose(null)}
      busy={action.busy}
      error={action.error}
    >
      <PersonPicker
        label="Search for a person"
        onPick={(p) =>
          void action.run(() =>
            apiFetch<ChannelDetail>('/collab/direct', {
              method: 'POST',
              body: JSON.stringify({ employeeId: p.id }),
            }),
          )
        }
      />
    </FormDialog>
  );
}

function MembersDialog({
  channel,
  onClose,
}: {
  channel: ChannelDetail;
  onClose: (changed: boolean) => void;
}) {
  const { profile } = useSession();
  const [detail, setDetail] = useState(channel);
  const [changed, setChanged] = useState(false);
  const action = useAction<void>(() => undefined);
  const leaveOrRemove = (employeeId: string) =>
    action.run(async () => {
      await apiFetch(`/collab/channels/${channel.id}/members/${employeeId}`, { method: 'DELETE' });
      setDetail(await apiFetch<ChannelDetail>(`/collab/channels/${channel.id}`).catch(() => detail));
      setChanged(true);
    });
  return (
    <FormDialog
      title={`People in ${channel.name}`}
      hideSubmit
      onClose={() => onClose(changed)}
      busy={action.busy}
      error={action.error}
    >
      {channel.canManage && (
        <PersonPicker
          label="Add a person"
          exclude={detail.members.map((m) => m.id)}
          onPick={(p) =>
            void action.run(async () => {
              setDetail(
                await apiFetch<ChannelDetail>(`/collab/channels/${channel.id}/members`, {
                  method: 'POST',
                  body: JSON.stringify({ employeeId: p.id }),
                }),
              );
              setChanged(true);
            })
          }
        />
      )}
      <List dense aria-label="Members">
        {detail.members.map((m) => (
          <ListItemButton key={m.id} disableRipple sx={{ cursor: 'default' }}>
            <ListItemText
              primary={m.fullName}
              secondary={`${ROLE_LABEL[m.role] ?? m.role}${m.isOwner ? ' · owner' : ''}`}
            />
            {(channel.canManage || m.id === profile.employee.id) && channel.kind !== 'TEAM' && (
              <Button size="small" color="error" onClick={() => void leaveOrRemove(m.id)}>
                {m.id === profile.employee.id ? 'Leave' : 'Remove'}
              </Button>
            )}
          </ListItemButton>
        ))}
      </List>
    </FormDialog>
  );
}

function MessageRow({
  m,
  mine,
  canDelete,
  onChanged,
}: {
  m: MessageRecord;
  mine: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const action = useAction<unknown>(() => {
    setEditing(false);
    onChanged();
  });
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Typography variant="caption" color="text.secondary">
        {mine ? 'You' : m.author.fullName} · {timeLabel(m.createdAt)}
        {m.edited && !m.deleted ? ' · edited' : ''}
      </Typography>
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 1,
          maxWidth: { xs: '100%', md: '70%' },
          bgcolor: mine ? '#E8F1FE' : 'background.paper',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {m.deleted ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            This message was deleted.
          </Typography>
        ) : editing ? (
          <Box sx={{ display: 'grid', gap: 1, minWidth: 260 }}>
            <TextField
              size="small"
              multiline
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Edit message"
            />
            {action.error && <Alert severity="error">{action.error}</Alert>}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                disabled={action.busy || !text.trim()}
                onClick={() =>
                  void action.run(() =>
                    apiFetch(`/collab/messages/${m.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ body: text }),
                    }),
                  )
                }
              >
                Save
              </Button>
              <Button size="small" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Box>
          </Box>
        ) : (
          <Typography variant="body2" component="span">
            {m.body}
          </Typography>
        )}
      </Paper>
      {!m.deleted && !editing && (mine || canDelete) && (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {mine && (
            <Button size="small" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button
            size="small"
            color="error"
            onClick={() => void action.run(() => apiFetch(`/collab/messages/${m.id}`, { method: 'DELETE' }))}
          >
            Delete
          </Button>
        </Box>
      )}
    </Box>
  );
}

function Conversation({
  channel,
  config,
  onChanged,
}: {
  channel: ChannelDetail;
  config: CollaborationConfig | null;
  onChanged: () => void;
}) {
  const { profile } = useSession();
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState(false);
  const [call, setCall] = useState<{ video: boolean; announce: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const idRef = useRef(channel.id);

  const markRead = useCallback(() => {
    void apiFetch(`/collab/channels/${channel.id}/read`, { method: 'POST' })
      .then(onChanged)
      .catch(() => undefined);
  }, [channel.id, onChanged]);

  // Opening a channel loads the latest messages.
  useEffect(() => {
    idRef.current = channel.id;
    apiFetch<ChannelMessages>(`/collab/channels/${channel.id}/messages?limit=50`)
      .then((r) => {
        if (idRef.current !== channel.id) return;
        setMessages(r.items);
        setHasMore(r.hasMore);
        markRead();
      })
      .catch((e: unknown) => setError(problemText(e, 'Messages could not be loaded.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  const fetchNew = useCallback(async () => {
    const last = messages.at(-1);
    if (!last) return;
    try {
      const r = await apiFetch<ChannelMessages>(
        `/collab/channels/${channel.id}/messages?after=${last.id}&limit=100`,
      );
      if (idRef.current !== channel.id || r.items.length === 0) return;
      setMessages((m) => [...m, ...r.items]);
      if (r.items.some((i) => i.author.id !== profile.employee.id)) markRead();
    } catch {
      /* the next refresh tries again */
    }
  }, [channel.id, messages, markRead, profile.employee.id]);
  usePolling(() => void fetchNew(), MESSAGE_REFRESH_MS);

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    stick.current = false;
    const r = await apiFetch<ChannelMessages>(
      `/collab/channels/${channel.id}/messages?before=${first.id}&limit=50`,
    ).catch(() => null);
    if (!r) return;
    setMessages((m) => [...r.items, ...m]);
    setHasMore(r.hasMore);
  }

  async function reloadAll() {
    const r = await apiFetch<ChannelMessages>(
      `/collab/channels/${channel.id}/messages?limit=${Math.max(messages.length, 50)}`,
    ).catch(() => null);
    if (r) setMessages(r.items);
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await apiFetch<MessageRecord>(`/collab/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      stick.current = true;
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      setDraft('');
      onChanged();
    } catch (e) {
      setError(problemText(e, 'The message was not sent. Try again.'));
    } finally {
      setSending(false);
    }
  }

  const callsReady = Boolean(config?.callsEnabled) && !channel.archived;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          p: 2,
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          flexWrap: 'wrap',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography variant="h6" component="h2" noWrap>
            {channel.kind === 'DIRECT' ? channel.name : `# ${channel.name}`}
          </Typography>
          {(channel.topic || channel.kind === 'TEAM') && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {channel.topic ?? 'Your team’s channel'}
            </Typography>
          )}
        </Box>
        {channel.kind !== 'DIRECT' && (
          <Button size="small" onClick={() => setMembers(true)}>
            {channel.memberCount} {channel.memberCount === 1 ? 'person' : 'people'}
          </Button>
        )}
        {config && !config.callsEnabled ? (
          <Chip size="small" variant="outlined" label="Calls not set up yet" />
        ) : (
          <>
            <Button
              size="small"
              variant="outlined"
              disabled={!callsReady}
              onClick={() => setCall({ video: false, announce: true })}
            >
              Audio call
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!callsReady}
              onClick={() => setCall({ video: true, announce: true })}
            >
              Video call
            </Button>
            <Button
              size="small"
              disabled={!callsReady}
              onClick={() => setCall({ video: false, announce: false })}
            >
              Join call
            </Button>
          </>
        )}
      </Box>

      <Alert severity="info" sx={{ borderRadius: 0 }}>
        Do not share patient information in chat. Use the chart and its notes for that.
      </Alert>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          p: 2,
          display: 'grid',
          gap: 1.5,
          alignContent: 'start',
        }}
        role="log"
        aria-label="Messages"
        aria-live="polite"
      >
        {hasMore && (
          <Button size="small" onClick={() => void loadOlder()} sx={{ justifySelf: 'center' }}>
            Show earlier messages
          </Button>
        )}
        {messages.length === 0 && !error && (
          <EmptyState
            title="No messages yet"
            description="Say hello. Everyone in this conversation will see it."
          />
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            mine={m.author.id === profile.employee.id}
            canDelete={profile.employee.role === 'MANAGER'}
            onChanged={() => void reloadAll()}
          />
        ))}
        <div ref={endRef} />
      </Box>

      {error && (
        <Alert severity="error" role="alert" sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        sx={{ p: 2, display: 'flex', gap: 1, borderTop: 1, borderColor: 'divider', alignItems: 'flex-end' }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={5}
          size="small"
          placeholder={channel.archived ? 'This channel is archived' : 'Write a message'}
          disabled={channel.archived}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': 'Message', maxLength: MESSAGE_MAX_LENGTH } }}
        />
        <Button type="submit" variant="contained" disabled={sending || !draft.trim() || channel.archived}>
          Send
        </Button>
      </Box>

      {members && (
        <MembersDialog
          channel={channel}
          onClose={(changed) => {
            setMembers(false);
            if (changed) onChanged();
          }}
        />
      )}
      {call && (
        <CallDialog
          channelId={channel.id}
          channelName={channel.name}
          video={call.video}
          announce={call.announce}
          onClose={() => {
            setCall(null);
            void fetchNew();
          }}
        />
      )}
    </Box>
  );
}

function Messages() {
  const { profile, signOut } = useSession();
  const [channels, setChannels] = useState<ChannelRecord[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [config, setConfig] = useState<CollaborationConfig | null>(null);
  const [dialog, setDialog] = useState<'channel' | 'direct' | null>(null);

  const loadList = useCallback(async () => {
    try {
      setChannels(await apiFetch<ChannelRecord[]>('/collab/channels'));
      setListError(null);
    } catch (e) {
      setListError(problemText(e, 'Your conversations could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    apiFetch<ChannelRecord[]>('/collab/channels')
      .then((rows) => setChannels(rows))
      .catch((e: unknown) => setListError(problemText(e, 'Your conversations could not be loaded.')));
    apiFetch<CollaborationConfig>('/collab/config')
      .then(setConfig)
      .catch(() => setConfig({ callsEnabled: false, callsUrl: null }));
  }, []);
  usePolling(() => void loadList(), LIST_REFRESH_MS);

  // The first conversation opens by default.
  const activeId = selected ?? channels?.[0]?.id ?? null;
  const select = useCallback((id: string) => setSelected(id), []);
  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await apiFetch<ChannelDetail>(`/collab/channels/${id}`));
    } catch {
      setDetail(null);
    }
  }, []);
  useEffect(() => {
    if (!activeId) return;
    apiFetch<ChannelDetail>(`/collab/channels/${activeId}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [activeId]);

  const group = (kind: ChannelRecord['kind'][]) => (channels ?? []).filter((c) => kind.includes(c.kind));
  const section = (title: string, rows: ChannelRecord[]) =>
    rows.length === 0 ? null : (
      <List
        dense
        aria-label={title}
        subheader={<ListSubheader sx={{ bgcolor: 'transparent', lineHeight: '28px' }}>{title}</ListSubheader>}
      >
        {rows.map((c) => (
          <ListItemButton key={c.id} selected={c.id === activeId} onClick={() => select(c.id)}>
            <ListItemText
              primary={c.kind === 'DIRECT' ? c.name : `# ${c.name}`}
              secondary={c.lastMessagePreview ?? (c.joined ? 'No messages yet' : 'Open channel')}
              slotProps={{
                primary: { noWrap: true, sx: { fontWeight: c.unread ? 700 : 500 } },
                secondary: { noWrap: true },
              }}
            />
            {c.unread > 0 && <Badge color="primary" badgeContent={c.unread} sx={{ mr: 1 }} />}
          </ListItemButton>
        ))}
      </List>
    );

  return (
    <AppShell
      role={profile.employee.role}
      title="Messages"
      currentPath="/messages"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Paper
        variant="outlined"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '320px 1fr' },
          height: { xs: 'auto', md: 'calc(100vh - 150px)' },
          minHeight: 480,
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            borderRight: { md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: 'divider',
            overflow: 'auto',
            maxHeight: { xs: 320, md: 'none' },
          }}
        >
          <Box sx={{ p: 1.5, display: 'flex', gap: 1 }}>
            <Button size="small" variant="contained" onClick={() => setDialog('direct')}>
              New message
            </Button>
            <Button size="small" variant="outlined" onClick={() => setDialog('channel')}>
              New channel
            </Button>
          </Box>
          {listError && (
            <Alert severity="error" sx={{ m: 1.5 }}>
              {listError}
            </Alert>
          )}
          {channels && channels.length === 0 && (
            <EmptyState
              title="No conversations yet"
              description="Start a message with a colleague or create a channel."
            />
          )}
          {section('Team', group(['TEAM']))}
          {section('Channels', group(['PUBLIC', 'PRIVATE']))}
          {section('Direct messages', group(['DIRECT']))}
        </Box>
        <Box sx={{ minWidth: 0, minHeight: 0 }}>
          {detail && detail.id === activeId ? (
            <Conversation
              key={detail.id}
              channel={detail}
              config={config}
              onChanged={() => {
                void loadList();
                if (activeId) void loadDetail(activeId);
              }}
            />
          ) : (
            <Box sx={{ p: 4 }}>
              <Typography color="text.secondary">Choose a conversation to start.</Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {dialog === 'channel' && (
        <NewChannelDialog
          onClose={(created) => {
            setDialog(null);
            if (created) {
              setSelected(created.id);
              setDetail(created);
              void loadList();
            }
          }}
        />
      )}
      {dialog === 'direct' && (
        <NewDirectDialog
          onClose={(opened) => {
            setDialog(null);
            if (opened) {
              setSelected(opened.id);
              setDetail(opened);
              void loadList();
            }
          }}
        />
      )}
    </AppShell>
  );
}

/** Chat, channels and calls for every signed-in role. The API decides who sees what. */
export function MessagesWorkspace() {
  return (
    <RequireSession>
      <Messages />
    </RequireSession>
  );
}
