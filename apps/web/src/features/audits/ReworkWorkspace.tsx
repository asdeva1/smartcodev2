'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
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
  reworkSubmitSchema,
  type ReworkItem,
  type ReworkList,
  type ReworkSubmitted,
} from '@smartcode/shared';
import NextLink from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { formatDateTime, ReadOnlyField, useResource } from '@/features/projects/shared';
import { apiFetch } from '@/lib/api';

const RANGE = 'Enter a whole number from 0 to 9999.';

function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  const { profile, signOut } = useSession();
  return (
    <AppShell
      role={profile.employee.role}
      title={title}
      currentPath="/rework"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      {children}
    </AppShell>
  );
}

function List() {
  const data = useResource<ReworkList>('/rework/mine');
  const list = data.data;
  return (
    <Shell title="Rework">
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1100 }}>
        {data.error && (
          <Alert severity="error" role="alert">
            {data.error}
          </Alert>
        )}
        <Paper variant="outlined">
          {!list ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>
              {data.error ? 'Your rework could not be loaded.' : 'Loading your rework…'}
            </Typography>
          ) : list.total === 0 ? (
            <EmptyState
              title="No rework"
              description="Charts the Manager sends back after review appear here with the reason."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Charts sent back for rework">
                <TableHead>
                  <TableRow>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Client · Project</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Sent back</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {list.items.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <Link
                          component={NextLink}
                          href={`/rework/${r.id}`}
                          aria-label={`Rework chart ${r.chartId}`}
                          underline="hover"
                        >
                          {r.chartId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.project.client} · {r.project.name}
                      </TableCell>
                      <TableCell align="right">{r.pages ?? '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 360 }}>{r.reason}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.assignedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Box>
    </Shell>
  );
}

function Form({ item }: { item: ReworkItem }) {
  const router = useRouter();
  const [icds, setIcds] = useState('');
  const [dos, setDos] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ icds?: string; dos?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReworkSubmitted | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = reworkSubmitSchema.safeParse({ icds, dos });
    if (icds.trim() === '' || dos.trim() === '' || !parsed.success) {
      setFieldErrors({
        icds:
          icds.trim() === '' || !reworkSubmitSchema.shape.icds.safeParse(icds).success ? RANGE : undefined,
        dos: dos.trim() === '' || !reworkSubmitSchema.shape.dos.safeParse(dos).success ? RANGE : undefined,
      });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      setDone(
        await apiFetch<ReworkSubmitted>(`/rework/${encodeURIComponent(item.id)}/submit`, {
          method: 'POST',
          body: JSON.stringify(parsed.data),
        }),
      );
    } catch (e) {
      setError(problemText(e, 'The corrected chart could not be submitted.'));
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
          <Button color="inherit" size="small" onClick={() => router.push('/rework')}>
            Back to rework
          </Button>
        }
      >
        Chart {done.chartId} was resubmitted ({done.icds} ICDs, {done.dos} DOS) and goes to audit again.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" component="form" onSubmit={(e) => void submit(e)} noValidate sx={{ p: 3 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {item.project.client} · {item.project.name}
      </Typography>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {item.reason}
      </Alert>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <ReadOnlyField label="Chart ID" value={item.chartId} />
        <ReadOnlyField label="Page numbers" value={item.pages ?? ''} />
        <Typography variant="body2" color="text.secondary">
          Your earlier submission: {item.previousIcds} ICDs, {item.previousDos} DOS. Enter the corrected
          figures.
        </Typography>
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
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit'}
          </Button>
          <Button onClick={() => router.push('/rework')} disabled={busy}>
            Back to rework
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}

function Detail({ reworkId }: { reworkId: string }) {
  const data = useResource<ReworkList>('/rework/mine');
  const item = data.data?.items.find((r) => r.id === reworkId);
  return (
    <Shell title="Rework chart">
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
        {data.error && (
          <Alert severity="error" role="alert">
            {data.error}
          </Alert>
        )}
        {data.loading && <Typography color="text.secondary">Opening chart…</Typography>}
        {data.data && !item && <Alert severity="info">This rework is not waiting for you any more.</Alert>}
        {item && <Form item={item} />}
      </Box>
    </Shell>
  );
}

/** Coder: charts the Manager sent back, with the reason. */
export function ReworkWorkspace() {
  return (
    <RequireSession permission="rework.perform">
      <List />
    </RequireSession>
  );
}

/** Coder: submit the corrected ICDs and DOS for one rework. */
export function ReworkDetailWorkspace() {
  const params = useParams<{ id: string }>();
  return (
    <RequireSession permission="rework.perform">
      <Detail reworkId={params.id} />
    </RequireSession>
  );
}
