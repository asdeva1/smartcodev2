'use client';

import Chip from '@mui/material/Chip';
import { ApiError } from '@/lib/api';

export const STATUS_LABEL: Record<string, string> = {
  PENDING_ACTIVATION: 'Pending activation',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LOCKED: 'Locked',
};

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  PENDING_ACTIVATION: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'default',
  LOCKED: 'error',
};

export function EmployeeStatusChip({ status }: { status: string }) {
  return (
    <Chip
      size="small"
      label={STATUS_LABEL[status] ?? status}
      color={STATUS_COLOR[status] ?? 'default'}
      variant="outlined"
    />
  );
}

/** The most useful sentence an API problem offers: field message, then detail, then a fallback. */
export function problemText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(error instanceof ApiError)) return fallback;
  return error.problem.errors?.[0]?.message ?? error.problem.detail ?? fallback;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function toQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const text = q.toString();
  return text ? `?${text}` : '';
}

export interface DirectoryOptions {
  vendors: { id: string; name: string }[];
  teams: { id: string; name: string; vendorId: string | null }[];
  projects: { id: string; name: string; vendorId: string | null }[];
}
