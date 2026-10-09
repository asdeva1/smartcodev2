'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  auditSubmitSchema,
  type AuditQueue,
  type AuditQueueItem,
  type AuditSubmitted,
} from '@smartcode/shared';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { ReadOnlyField, useResource } from '@/features/projects/shared';
import { apiFetch } from '@/lib/api';

const RANGE = 'Enter a whole number from 0 to 9999.';

function Form({ item }: { item: AuditQueueItem }) {
  const router = useRouter();
  const [auditErrors, setAuditErrors] = useState('');
  const [errorExceptions, setErrorExceptions] = useState('');
  const [result, setResult] = useState<'PASS' | 'REVIEW_REQUIRED'>('PASS');
  const [remarks, setRemarks] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ auditErrors?: string; errorExceptions?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AuditSubmitted | null>(null);

  const total =
    auditErrors.trim() !== '' && errorExceptions.trim() !== ''
      ? Number(auditErrors) + Number(errorExceptions)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = auditSubmitSchema.safeParse({ auditErrors, errorExceptions, result, remarks });
    if (auditErrors.trim() === '' || errorExceptions.trim() === '' || !parsed.success) {
      setFieldErrors({
        auditErrors:
          auditErrors.trim() === '' || !auditSubmitSchema.shape.auditErrors.safeParse(auditErrors).success
            ? RANGE
            : undefined,
        errorExceptions:
          errorExceptions.trim() === '' ||
          !auditSubmitSchema.shape.errorExceptions.safeParse(errorExceptions).success
            ? RANGE
            : undefined,
      });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      setDone(
        await apiFetch<AuditSubmitted>(`/audits/charts/${encodeURIComponent(item.id)}/submit`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      setError(problemText(e, 'The audit could not be submitted.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Alert
        severity="success"
        role="status"
        action={
          <Button color="inherit" size="small" onClick={() => router.push('/auditor')}>
            Back to audit queue
          </Button>
        }
      >
        {done.result === 'PASS'
          ? `Chart ${done.chartId} passed and is completed.`
          : `Chart ${done.chartId} was sent to the Manager for review.`}{' '}
        Total errors: {done.totalErrors}.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" component="form" onSubmit={(e) => void submit(e)} noValidate sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {item.project.client} · {item.project.name}
        {item.isReAudit ? ' · Re-audit of the corrected version' : ''}
      </Typography>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <ReadOnlyField label="Chart ID" value={item.chartId} />
        <ReadOnlyField label="Coder" value={`${item.coder} (${item.loginName})`} />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <ReadOnlyField label="Page numbers" value={item.pages ?? '—'} />
          <ReadOnlyField label="ICDs" value={item.icds} />
          <ReadOnlyField label="DOS" value={item.dos} />
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <TextField
            label="Audit Errors"
            value={auditErrors}
            onChange={(e) => setAuditErrors(e.target.value)}
            error={Boolean(fieldErrors.auditErrors)}
            helperText={fieldErrors.auditErrors}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            autoFocus
          />
          <TextField
            label="Error Exceptions"
            value={errorExceptions}
            onChange={(e) => setErrorExceptions(e.target.value)}
            error={Boolean(fieldErrors.errorExceptions)}
            helperText={fieldErrors.errorExceptions}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <ReadOnlyField
            label="Total Errors"
            value={total === null || Number.isNaN(total) ? '' : total}
            helperText="Audit Errors + Error Exceptions"
          />
        </Box>
        <TextField
          select
          label="Result"
          value={result}
          onChange={(e) => setResult(e.target.value as typeof result)}
        >
          <MenuItem value="PASS">Pass</MenuItem>
          <MenuItem value="REVIEW_REQUIRED">Send to Manager for review</MenuItem>
        </TextField>
        <TextField
          label="Remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          multiline
          minRows={2}
        />
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit audit'}
          </Button>
          <Button onClick={() => router.push('/auditor')} disabled={busy}>
            Back to audit queue
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}

function Workspace({ chartKey }: { chartKey: string }) {
  const { profile, signOut } = useSession();
  const queue = useResource<AuditQueue>('/audits/queue');
  const item = queue.data?.items.find((i) => i.id === chartKey);
  return (
    <AppShell
      role={profile.employee.role}
      title="Audit chart"
      currentPath="/auditor"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 760 }}>
        {queue.error && (
          <Alert severity="error" role="alert">
            {queue.error}
          </Alert>
        )}
        {queue.loading && <Typography color="text.secondary">Opening chart…</Typography>}
        {queue.data && !item && <Alert severity="info">This chart is not waiting for audit any more.</Alert>}
        {item && <Form item={item} />}
      </Box>
    </AppShell>
  );
}

/** What the Auditor sees: production figures read-only, then the audit figures and a result. */
export function AuditChartWorkspace() {
  const params = useParams<{ id: string }>();
  return (
    <RequireSession permission="audit.perform">
      <Workspace chartKey={params.id} />
    </RequireSession>
  );
}
