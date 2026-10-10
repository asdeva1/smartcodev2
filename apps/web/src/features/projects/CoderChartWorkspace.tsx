'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  holdChartSchema,
  productionSubmitSchema,
  type ChartWorkspace,
  type ProductionSubmitted,
} from '@smartcode/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { ReadOnlyField } from './shared';
import { apiFetch } from '@/lib/api';

function Workspace({ chartRef }: { chartRef: string }) {
  const { profile, signOut } = useSession();
  const router = useRouter();
  const [chart, setChart] = useState<ChartWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [icds, setIcds] = useState('');
  const [dos, setDos] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ icds?: string; dos?: string; remarks?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<ProductionSubmitted | null>(null);
  const [remarks, setRemarks] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codedDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const onHold = Boolean(chart?.heldAt);

  async function hold() {
    const parsed = holdChartSchema.safeParse({ reason: holdReason });
    if (!parsed.success) {
      setHoldError(parsed.error.issues[0]?.message ?? 'Enter the reason for holding this chart');
      return;
    }
    setHoldError(null);
    setBusy(true);
    try {
      setChart(
        await apiFetch<ChartWorkspace>(`/production/charts/${encodeURIComponent(chartRef)}/hold`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
      setHolding(false);
      setHoldReason('');
    } catch (e) {
      setHoldError(problemText(e, 'The chart could not be put on hold.'));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setSubmitError(null);
    setBusy(true);
    try {
      setChart(
        await apiFetch<ChartWorkspace>(`/production/charts/${encodeURIComponent(chartRef)}/resume`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    } catch (e) {
      setSubmitError(problemText(e, 'The chart could not be resumed.'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    apiFetch<ChartWorkspace>(`/production/charts/${encodeURIComponent(chartRef)}/open`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then((c) => {
        if (!cancelled) setChart(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(problemText(e, 'This chart could not be opened.'));
      });
    return () => {
      cancelled = true;
    };
  }, [chartRef]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    const parsed = productionSubmitSchema.safeParse({ icds, dos, remarks });
    if (icds.trim() === '' || dos.trim() === '' || !parsed.success) {
      setFieldErrors({
        icds:
          icds.trim() === '' || !productionSubmitSchema.shape.icds.safeParse(icds).success
            ? 'Enter a whole number from 0 to 9999.'
            : undefined,
        dos:
          dos.trim() === '' || !productionSubmitSchema.shape.dos.safeParse(dos).success
            ? 'Enter a whole number from 0 to 9999.'
            : undefined,
        remarks: remarks.trim().length > 1000 ? 'Remarks must be at most 1000 characters' : undefined,
      });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await apiFetch<ProductionSubmitted>(
        `/production/charts/${encodeURIComponent(chartRef)}/submit`,
        { method: 'POST', body: JSON.stringify(parsed.data) },
      );
      setDone(result);
    } catch (e) {
      setSubmitError(problemText(e, 'The chart could not be submitted.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Chart workspace"
      currentPath="/coder"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
        {loadError && (
          <Alert severity="error" role="alert">
            {loadError}
          </Alert>
        )}
        {!chart && !loadError && <Typography color="text.secondary">Opening chart…</Typography>}
        {done && (
          <Alert
            severity="success"
            role="status"
            action={
              <Button color="inherit" size="small" onClick={() => router.push('/coder')}>
                Back to my charts
              </Button>
            }
          >
            Chart {done.chartId} submitted ({done.icds} ICDs, {done.dos} DOS). It has been removed from your
            charts and sent for audit.
          </Alert>
        )}
        {chart && !done && (
          <Paper
            variant="outlined"
            component="form"
            onSubmit={(e) => void submit(e)}
            noValidate
            sx={{ p: 3 }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {chart.project.client} · {chart.project.name}
              {chart.pageBucket ? ` · Page bucket ${chart.pageBucket}` : ''}
            </Typography>
            {chart.remarks && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {chart.remarks}
              </Alert>
            )}
            {onHold && (
              <Alert severity="warning" sx={{ mb: 2 }} role="status">
                <strong>On hold.</strong> Reason: {chart.holdReason}. The Manager cannot pull this chart back
                while it is on hold. Resume it to enter ICDs and DOS and submit.
              </Alert>
            )}
            <Box sx={{ display: 'grid', gap: 2 }}>
              <ReadOnlyField label="Chart ID" value={chart.chartId} />
              <ReadOnlyField label="Project" value={`${chart.project.client} · ${chart.project.name}`} />
              <ReadOnlyField label="No of pages" value={chart.pages ?? ''} />
              <TextField
                label="No of ICDs"
                value={icds}
                onChange={(e) => setIcds(e.target.value)}
                error={Boolean(fieldErrors.icds)}
                helperText={fieldErrors.icds}
                disabled={onHold}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                autoFocus
              />
              <TextField
                label="No of DOS"
                value={dos}
                onChange={(e) => setDos(e.target.value)}
                error={Boolean(fieldErrors.dos)}
                helperText={fieldErrors.dos}
                disabled={onHold}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              <ReadOnlyField label="Coded date" value={codedDate} />
              <TextField
                label="Remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                error={Boolean(fieldErrors.remarks)}
                helperText={fieldErrors.remarks ?? 'Optional'}
                disabled={onHold}
                multiline
                minRows={2}
              />
              {holding && !onHold && (
                <Box sx={{ display: 'grid', gap: 1.5, p: 2, bgcolor: '#FFF8E6', borderRadius: 1 }}>
                  <TextField
                    label="Hold reason"
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    error={Boolean(holdError)}
                    helperText={holdError ?? 'Required. The Manager can see this reason.'}
                    multiline
                    minRows={2}
                    autoFocus
                  />
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button variant="contained" color="warning" onClick={() => void hold()} disabled={busy}>
                      {busy ? 'Holding…' : 'Confirm hold'}
                    </Button>
                    <Button
                      onClick={() => {
                        setHolding(false);
                        setHoldError(null);
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Box>
              )}
              {submitError && (
                <Alert severity="error" role="alert">
                  {submitError}
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Button type="submit" variant="contained" disabled={submitting || onHold || busy}>
                  {submitting ? 'Submitting…' : 'Submit chart'}
                </Button>
                {onHold ? (
                  <Button variant="outlined" onClick={() => void resume()} disabled={busy}>
                    {busy ? 'Resuming…' : 'Resume chart'}
                  </Button>
                ) : (
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={() => setHolding(true)}
                    disabled={holding}
                  >
                    Hold chart
                  </Button>
                )}
                <Button onClick={() => router.push('/coder')} disabled={submitting || busy}>
                  Back to my charts
                </Button>
              </Box>
            </Box>
          </Paper>
        )}
      </Box>
    </AppShell>
  );
}

/** What the Coder sees after clicking a chart: Chart ID and pages are read-only; ICDs and DOS are entered. */
export function CoderChartWorkspace() {
  const params = useParams<{ id: string }>();
  return (
    <RequireSession permission="production.submit">
      <Workspace chartRef={params.id} />
    </RequireSession>
  );
}
