'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { problemText, toQuery } from '@/features/employees/common';

/** Shared building blocks for the Phase 4 admin screens (vendors, teams, settings). */

export function FormDialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  children,
  submitColor,
  hideSubmit,
  maxWidth = 'sm',
}: {
  title: string;
  onClose: () => void;
  onSubmit?: (event: FormEvent) => void;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  children: ReactNode;
  submitColor?: 'primary' | 'error';
  hideSubmit?: boolean;
  maxWidth?: 'sm' | 'md';
}) {
  return (
    <Dialog open onClose={onClose} maxWidth={maxWidth} fullWidth aria-labelledby="admin-dlg-title">
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
      >
        <DialogTitle id="admin-dlg-title">{title}</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          {children}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{hideSubmit ? 'Close' : 'Cancel'}</Button>
          {!hideSubmit && (
            <Button type="submit" variant="contained" color={submitColor ?? 'primary'} disabled={busy}>
              {busy ? 'Working…' : (submitLabel ?? 'Save')}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Runs an API call with shared busy/error handling; `onDone` runs only on success. */
export function useAction<R = unknown>(onDone: (result: R) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<R>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Loads one server-paginated list and reloads on demand. */
export function usePagedList<T>(path: string, params: Record<string, string | number | undefined>) {
  const [data, setData] = useState<PageResult<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const key = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PageResult<T>>(`${path}${toQuery(JSON.parse(key) as Record<string, string | number>)}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(problemText(e, 'The list could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, [path, key, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  return { data, error, loading: data === null && error === null, refresh };
}

export function ActiveChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={status === 'ACTIVE' ? 'Active' : 'Inactive'}
      color={status === 'ACTIVE' ? 'success' : 'default'}
    />
  );
}
