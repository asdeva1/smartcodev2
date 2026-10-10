'use client';

import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { NotificationList } from '@smartcode/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { tokens } from '@/theme/tokens';

const REFRESH_MS = 60_000;

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The bell next to the user's name. Shows how many notifications are unread (for a coder: audit errors and
 * rework on their charts). It refreshes every minute and fails quietly — the rest of the page never depends on it.
 */
export function NotificationBell() {
  const [data, setData] = useState<NotificationList | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<NotificationList>('/notifications'));
    } catch {
      // The bell is a convenience: stay as it was.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchNow = () =>
      apiFetch<NotificationList>('/notifications')
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => undefined); // The bell is a convenience: stay as it was.
    void fetchNow();
    const timer = setInterval(() => void fetchNow(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function markRead(id: string) {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) });
    } finally {
      await load();
    }
  }

  async function markAll() {
    try {
      await apiFetch('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) });
    } finally {
      await load();
    }
  }

  const unread = data?.unread ?? 0;
  return (
    <>
      <Tooltip title={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}>
        <IconButton
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            void load();
          }}
        >
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
            Notifications
          </Typography>
          <Button size="small" onClick={() => void markAll()} disabled={unread === 0}>
            Mark all as read
          </Button>
        </Box>
        <Divider />
        {!data || data.items.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2.5 }}>
            Nothing new. You will be told here when an audit finds errors in your charts.
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: 420, overflowY: 'auto' }}>
            {data.items.map((n) => (
              <Box
                component="li"
                key={n.id}
                sx={{
                  px: 2,
                  py: 1.25,
                  borderBottom: `1px solid ${tokens.color.line}`,
                  bgcolor: n.readAt ? 'transparent' : '#EEF4FD',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: n.readAt ? 400 : 600 }}>
                  {n.subject}
                </Typography>
                {n.message && (
                  <Typography variant="body2" color="text.secondary">
                    {n.message}
                  </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                    {when(n.createdAt)}
                  </Typography>
                  {!n.readAt && (
                    <Button size="small" onClick={() => void markRead(n.id)}>
                      Mark as read
                    </Button>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Popover>
    </>
  );
}
