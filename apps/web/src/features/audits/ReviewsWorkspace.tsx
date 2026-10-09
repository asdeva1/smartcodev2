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
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AuditResolved, ReviewItem, ReviewQueue } from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { formatDateTime, useResource } from '@/features/projects/shared';
import { apiFetch } from '@/lib/api';

function RejectDialog({
  item,
  onClose,
  onDone,
}: {
  item: ReviewItem;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reject() {
    if (reason.trim() === '') {
      setError('Give a reason when you send a chart back for rework');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch<AuditResolved>(`/audits/${item.auditId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED', reason }),
      });
      onDone(`Chart ${item.chartId} was sent back to ${item.coder} for rework.`);
    } catch (e) {
      setError(problemText(e, 'The chart could not be sent back.'));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Send chart {item.chartId} back for rework</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {item.coder} will see your reason and must submit a corrected version, which is then audited again.
        </Typography>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          multiline
          minRows={3}
          autoFocus
          error={Boolean(error)}
          helperText={error ?? undefined}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={() => void reject()} disabled={busy}>
          {busy ? 'Sending…' : 'Send back for rework'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Reviews() {
  const { profile, signOut } = useSession();
  const data = useResource<ReviewQueue>('/audits/reviews');
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const queue = data.data;

  async function approve(item: ReviewItem) {
    setBusyId(item.auditId);
    setError(null);
    try {
      await apiFetch<AuditResolved>(`/audits/${item.auditId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      });
      setMessage(`Chart ${item.chartId} was approved and is completed.`);
      data.refresh();
    } catch (e) {
      setError(problemText(e, 'The chart could not be approved.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Audit reviews"
      currentPath="/audit-reviews"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        {(data.error ?? error) && (
          <Alert severity="error" role="alert">
            {data.error ?? error}
          </Alert>
        )}
        {message && (
          <Alert severity="success" role="status" onClose={() => setMessage(null)}>
            {message}
          </Alert>
        )}
        <Paper variant="outlined">
          {!queue ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>
              {data.error ? 'Reviews could not be loaded.' : 'Loading reviews…'}
            </Typography>
          ) : queue.total === 0 ? (
            <EmptyState
              title="Nothing to review"
              description="Charts the Auditor sends for review appear here. Only the Manager can approve them or send them back."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Audits waiting for your decision">
                <TableHead>
                  <TableRow>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Client · Project</TableCell>
                    <TableCell>Coder</TableCell>
                    <TableCell>Auditor</TableCell>
                    <TableCell align="right">Audit Errors</TableCell>
                    <TableCell align="right">Error Exceptions</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell>Remarks</TableCell>
                    <TableCell>Audited</TableCell>
                    <TableCell align="right">Decision</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {queue.items.map((r) => (
                    <TableRow key={r.auditId} hover>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.chartId}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {r.project.client} · {r.project.name}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.coder}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.auditor}</TableCell>
                      <TableCell align="right">{r.auditErrors}</TableCell>
                      <TableCell align="right">{r.errorExceptions}</TableCell>
                      <TableCell align="right">{r.totalErrors}</TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>{r.remarks ?? '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.auditedAt)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => void approve(r)}
                          disabled={busyId === r.auditId}
                          aria-label={`Approve chart ${r.chartId}`}
                          sx={{ mr: 1 }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setRejecting(r)}
                          disabled={busyId === r.auditId}
                          aria-label={`Reject chart ${r.chartId}`}
                        >
                          Reject
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Box>
      {rejecting && (
        <RejectDialog
          item={rejecting}
          onClose={() => setRejecting(null)}
          onDone={(m) => {
            setRejecting(null);
            setMessage(m);
            data.refresh();
          }}
        />
      )}
    </AppShell>
  );
}

/** Manager only: approve a reviewed chart, or send it back to the Coder with a reason (decision D-01). */
export function ReviewsWorkspace() {
  return (
    <RequireSession permission="audit.resolveReview">
      <Reviews />
    </RequireSession>
  );
}
