'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  type InternalAuditSummary,
  type InternalReviewPage,
  type InternalReviewRecord,
  type InternalSampleItem,
  internalReviewCreateSchema,
} from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction } from '../admin/ui';
import { useResource } from '../projects/shared';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function ReviewDialog({ item, onClose }: { item: InternalSampleItem; onClose: (done: boolean) => void }) {
  const [found, setFound] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAction<InternalReviewRecord>(() => onClose(true));

  function submit() {
    const parsed = internalReviewCreateSchema.safeParse({
      auditId: item.auditId,
      independentErrors: found === '' ? undefined : found,
      notes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the number of errors');
      return;
    }
    setError(null);
    void action.run(() =>
      apiFetch<InternalReviewRecord>('/internal-audit/reviews', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      }),
    );
  }

  return (
    <FormDialog
      title="Review this audit"
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Record review"
      busy={action.busy}
      error={action.error}
    >
      <Typography>
        Chart <strong>{item.chartRef}</strong> in {item.project}. Coded by {item.coder ?? 'unknown'} (
        {item.icds} ICDs, {item.dos} DOS), audited by {item.auditor}.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Count the errors yourself first. The auditor’s total is shown after you save, so it does not bias the
        review.
      </Typography>
      <TextField
        label="Errors you found"
        type="number"
        value={found}
        onChange={(e) => setFound(e.target.value)}
        error={Boolean(error)}
        helperText={error}
        slotProps={{ htmlInput: { min: 0 } }}
      />
      <TextField
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        multiline
        minRows={2}
      />
    </FormDialog>
  );
}

function InternalAudit() {
  const { profile, signOut } = useSession();
  const summary = useResource<InternalAuditSummary>('/internal-audit/summary');
  const reviews = useResource<InternalReviewPage>('/internal-audit/reviews?pageSize=25');
  const [sample, setSample] = useState<InternalSampleItem[] | null>(null);
  const [reviewing, setReviewing] = useState<InternalSampleItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = summary.data;

  async function draw() {
    setError(null);
    try {
      setSample(await apiFetch<InternalSampleItem[]>('/internal-audit/sample?size=10'));
    } catch {
      setError('The sample could not be drawn.');
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Internal audit"
      currentPath="/internal-audit"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3, maxWidth: 1300 }}>
        <Typography variant="body2" color="text.secondary">
          Check the quality of the audits themselves. Draw a random sample of finished audits, count the
          errors yourself, and see how often each auditor agrees with you.
        </Typography>
        {(error ?? summary.error) && <Alert severity="error">{error ?? summary.error}</Alert>}

        <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Typography variant="h6" component="p">
            Reviewed: <strong>{s?.reviewed ?? '—'}</strong>
          </Typography>
          <Typography variant="h6" component="p">
            Agreement: <strong>{s ? pct(s.agreementPct) : '—'}</strong>
          </Typography>
        </Box>

        {s && s.auditors.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Agreement by auditor">
                <TableHead>
                  <TableRow>
                    <TableCell>Auditor</TableCell>
                    <TableCell align="right">Reviewed</TableCell>
                    <TableCell align="right">Agreed</TableCell>
                    <TableCell align="right">Agreement</TableCell>
                    <TableCell align="right">Average gap</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {s.auditors.map((a) => (
                    <TableRow key={a.auditorId}>
                      <TableCell component="th" scope="row">
                        {a.auditor}
                      </TableCell>
                      <TableCell align="right">{a.reviewed}</TableCell>
                      <TableCell align="right">{a.agreed}</TableCell>
                      <TableCell align="right">{pct(a.agreementPct)}</TableCell>
                      <TableCell align="right">
                        {a.averageGap === null ? '—' : a.averageGap > 0 ? `+${a.averageGap}` : a.averageGap}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ p: 1.5, display: 'block' }}>
              Average gap is your errors minus the auditor’s. Above zero: the auditor missed errors. Below
              zero: the auditor was stricter than you.
            </Typography>
          </Paper>
        )}

        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h6" component="h2">
              Sample to review
            </Typography>
            <Button variant="contained" onClick={() => void draw()}>
              Draw a sample
            </Button>
          </Box>
          {sample && sample.length === 0 && (
            <EmptyState
              title="Nothing left to review"
              description="Every finished audit has been reviewed."
            />
          )}
          {sample && sample.length > 0 && (
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small" aria-label="Sample">
                  <TableHead>
                    <TableRow>
                      <TableCell>Chart</TableCell>
                      <TableCell>Project</TableCell>
                      <TableCell>Coder</TableCell>
                      <TableCell>Auditor</TableCell>
                      <TableCell>Audited</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sample.map((i) => (
                      <TableRow key={i.auditId} hover>
                        <TableCell component="th" scope="row">
                          {i.chartRef}
                        </TableCell>
                        <TableCell>{i.project}</TableCell>
                        <TableCell>{i.coder ?? '—'}</TableCell>
                        <TableCell>{i.auditor}</TableCell>
                        <TableCell>{when(i.auditedAt)}</TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => setReviewing(i)}>
                            Review
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>

        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Recent reviews
          </Typography>
          {reviews.data && reviews.data.items.length === 0 && (
            <EmptyState title="No reviews yet" description="Draw a sample to start." />
          )}
          {reviews.data && reviews.data.items.length > 0 && (
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small" aria-label="Reviews">
                  <TableHead>
                    <TableRow>
                      <TableCell>When</TableCell>
                      <TableCell>Chart</TableCell>
                      <TableCell>Auditor</TableCell>
                      <TableCell align="right">Auditor errors</TableCell>
                      <TableCell align="right">Your errors</TableCell>
                      <TableCell>Result</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {reviews.data.items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{when(r.createdAt)}</TableCell>
                        <TableCell>{r.chartRef}</TableCell>
                        <TableCell>{r.auditor}</TableCell>
                        <TableCell align="right">{r.auditorErrors}</TableCell>
                        <TableCell align="right">{r.independentErrors}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={r.outcome === 'AGREE' ? 'success' : 'warning'}
                            label={r.outcome === 'AGREE' ? 'Agreed' : 'Disagreed'}
                          />
                        </TableCell>
                        <TableCell>{r.notes ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Box>
      </Box>
      {reviewing && (
        <ReviewDialog
          item={reviewing}
          onClose={(done) => {
            const finished = reviewing;
            setReviewing(null);
            if (done) {
              setSample((cur) => cur?.filter((i) => i.auditId !== finished.auditId) ?? null);
              summary.refresh();
              reviews.refresh();
            }
          }}
        />
      )}
    </AppShell>
  );
}

/** Manager only (`internalAudit.access`). */
export function InternalAuditWorkspace() {
  return (
    <RequireSession permission="internalAudit.access">
      <InternalAudit />
    </RequireSession>
  );
}
