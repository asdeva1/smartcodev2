'use client';

import Chip from '@mui/material/Chip';
import { type AllocationType, type ProjectStatus } from '@smartcode/shared';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { problemText } from '@/features/employees/common';

/** One GET, reloadable. `path = null` means "nothing to load yet". */
export function useResource<T>(path: string | null) {
  const [state, setState] = useState<{ path: string; data: T } | { path: string; error: string } | null>(
    null,
  );
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    apiFetch<T>(path)
      .then((data) => {
        if (!cancelled) setState({ path, data });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ path, error: problemText(e, 'This could not be loaded.') });
      });
    return () => {
      cancelled = true;
    };
  }, [path, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const current = state && state.path === path ? state : null;
  return {
    data: current && 'data' in current ? current.data : null,
    error: current && 'error' in current ? current.error : null,
    loading: path !== null && current === null,
    refresh,
  };
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const chartStatusLabel = (status: string) =>
  status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());

export function AllocationChip({ type }: { type: AllocationType }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={type === 'AUTOMATIC' ? 'info' : 'default'}
      label={type === 'AUTOMATIC' ? 'Automatic' : 'Manual'}
    />
  );
}

const PROJECT_STATUS: Record<ProjectStatus, { label: string; color: 'success' | 'warning' | 'default' }> = {
  ACTIVE: { label: 'Active', color: 'success' },
  ON_HOLD: { label: 'On hold', color: 'warning' },
  CLOSED: { label: 'Closed', color: 'default' },
};

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  const { label, color } = PROJECT_STATUS[status];
  return <Chip size="small" variant="outlined" label={label} color={color} />;
}
