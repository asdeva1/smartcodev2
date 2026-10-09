'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ActivityLogPage, AuditLogPage, AuditLogRecord } from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { useResource } from '../projects/shared';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
const who = (a: { fullName: string; role: string | null } | null) => (a ? a.fullName : 'System');

function Filters({
  action,
  from,
  to,
  onChange,
}: {
  action: string;
  from: string;
  to: string;
  onChange: (next: { action: string; from: string; to: string }) => void;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField
        size="small"
        label="Action starts with"
        placeholder="CHART or AUTH.LOGIN"
        value={action}
        onChange={(e) => onChange({ action: e.target.value, from, to })}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: 260 }}
      />
      <TextField
        size="small"
        type="date"
        label="From"
        value={from}
        onChange={(e) => onChange({ action, from: e.target.value, to })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        size="small"
        type="date"
        label="To"
        value={to}
        onChange={(e) => onChange({ action, from, to: e.target.value })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
    </Box>
  );
}

function useLogQuery() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const params = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
  if (filters.action.trim()) params.set('action', filters.action.trim());
  const rangeOk = !filters.from || !filters.to || filters.from <= filters.to;
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return {
    filters,
    setFilters: (next: typeof filters) => {
      setFilters(next);
      setPage(0);
    },
    page,
    setPage,
    pageSize,
    setPageSize,
    query: rangeOk ? params.toString() : null,
    rangeOk,
  };
}

function Pager({
  total,
  page,
  pageSize,
  setPage,
  setPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  setPage: (n: number) => void;
  setPageSize: (n: number) => void;
}) {
  return (
    <TablePagination
      component="div"
      count={total}
      page={page}
      rowsPerPage={pageSize}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => {
        setPageSize(Number(e.target.value));
        setPage(0);
      }}
      rowsPerPageOptions={[10, 25, 50, 100]}
    />
  );
}

function Detail({ row, onClose }: { row: AuditLogRecord; onClose: () => void }) {
  const block = (title: string, value: unknown) =>
    value === null || value === undefined ? null : (
      <Box>
        <Typography variant="subtitle2">{title}</Typography>
        <Box
          component="pre"
          sx={{ m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflow: 'auto', fontSize: 12.5 }}
        >
          {JSON.stringify(value, null, 2)}
        </Box>
      </Box>
    );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="audit-detail-title">
      <DialogTitle id="audit-detail-title">{row.action}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {when(row.createdAt)} · {who(row.actor)} · {row.outcome}
          {row.ipAddress ? ` · ${row.ipAddress}` : ''}
        </Typography>
        {block('Before', row.before)}
        {block('After', row.after)}
        {(row.before ?? null) === null && (row.after ?? null) === null && (
          <Typography color="text.secondary">No before or after values were recorded.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function AuditLog() {
  const { profile, signOut } = useSession();
  const q = useLogQuery();
  const [open, setOpen] = useState<AuditLogRecord | null>(null);
  const list = useResource<AuditLogPage>(q.query ? `/audit-logs?${q.query}` : null);
  const data = list.data;
  return (
    <AppShell
      role={profile.employee.role}
      title="Audit log"
      currentPath="/audit-log"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Typography variant="body2" color="text.secondary">
          A permanent record of sign-ins, people changes, allocations, production and audit decisions. Entries
          cannot be edited or deleted.
        </Typography>
        <Filters {...q.filters} onChange={q.setFilters} />
        {!q.rangeOk && <Alert severity="info">The start date must be on or before the end date.</Alert>}
        {list.error && <Alert severity="error">{list.error}</Alert>}
        {data && data.items.length === 0 && (
          <EmptyState title="No entries found" description="Try a different action or date range." />
        )}
        {data && data.items.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Audit log">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Who</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>{when(r.createdAt)}</TableCell>
                      <TableCell>
                        {who(r.actor)}
                        {r.actor?.role ? (
                          <Typography variant="caption" color="text.secondary" component="div">
                            {r.actor.role}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell component="th" scope="row">
                        {r.action}
                      </TableCell>
                      <TableCell>{r.outcome}</TableCell>
                      <TableCell>{r.entityType}</TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => setOpen(r)} aria-label={`Details of ${r.action}`}>
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pager
              total={data.total}
              page={q.page}
              pageSize={q.pageSize}
              setPage={q.setPage}
              setPageSize={q.setPageSize}
            />
          </Paper>
        )}
      </Box>
      {open && <Detail row={open} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

const describe = (metadata: Record<string, unknown>) =>
  Object.entries(metadata)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');

function Activity() {
  const { profile, signOut } = useSession();
  const q = useLogQuery();
  const list = useResource<ActivityLogPage>(q.query ? `/activity?${q.query}` : null);
  const data = list.data;
  return (
    <AppShell
      role={profile.employee.role}
      title="Activity"
      currentPath="/activity"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Typography variant="body2" color="text.secondary">
          What happened, newest first. You see only the activity of people in your own scope.
        </Typography>
        <Filters {...q.filters} onChange={q.setFilters} />
        {!q.rangeOk && <Alert severity="info">The start date must be on or before the end date.</Alert>}
        {list.error && <Alert severity="error">{list.error}</Alert>}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No activity yet"
            description="Actions by you and your people will appear here."
          />
        )}
        {data && data.items.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Activity">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Who</TableCell>
                    <TableCell>What happened</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell>{when(r.createdAt)}</TableCell>
                      <TableCell>{who(r.actor)}</TableCell>
                      <TableCell component="th" scope="row">
                        {r.action}
                      </TableCell>
                      <TableCell>{describe(r.metadata) || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pager
              total={data.total}
              page={q.page}
              pageSize={q.pageSize}
              setPage={q.setPage}
              setPageSize={q.setPageSize}
            />
          </Paper>
        )}
      </Box>
    </AppShell>
  );
}

/** Manager only; the API refuses everyone else. */
export function AuditLogWorkspace() {
  return (
    <RequireSession permission="auditLog.read">
      <AuditLog />
    </RequireSession>
  );
}

/** Every role sees the activity of its own scope. */
export function ActivityWorkspace() {
  return (
    <RequireSession permission="activityLog.read">
      <Activity />
    </RequireSession>
  );
}
