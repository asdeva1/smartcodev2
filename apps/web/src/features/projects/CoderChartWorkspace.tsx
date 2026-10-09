'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { productionSubmitSchema, type ChartWorkspace, type ProductionSubmitted } from '@smartcode/shared';
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
  const [fieldErrors, setFieldErrors] = useState<{ icds?: string; dos?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<ProductionSubmitted | null>(null);

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
    const parsed = productionSubmitSchema.safeParse({ icds, dos });
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
            <Box sx={{ display: 'grid', gap: 2 }}>
              <ReadOnlyField label="Chart ID" value={chart.chartId} />
              <ReadOnlyField label="Page numbers" value={chart.pages ?? ''} />
              <TextField
                label="ICDs"
                value={icds}
                onChange={(e) => setIcds(e.target.value)}
                error={Boolean(fieldErrors.icds)}
                helperText={fieldErrors.icds}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                autoFocus
              />
              <TextField
                label="DOS"
                value={dos}
                onChange={(e) => setDos(e.target.value)}
                error={Boolean(fieldErrors.dos)}
                helperText={fieldErrors.dos}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              />
              {submitError && (
                <Alert severity="error" role="alert">
                  {submitError}
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Button type="submit" variant="contained" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit'}
                </Button>
                <Button onClick={() => router.push('/coder')} disabled={submitting}>
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
