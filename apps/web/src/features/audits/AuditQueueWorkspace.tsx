'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { AuditQueue } from '@smartcode/shared';
import NextLink from 'next/link';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { formatDateTime, useResource } from '@/features/projects/shared';

function Queue() {
  const { profile, signOut } = useSession();
  const data = useResource<AuditQueue>('/audits/queue');
  const queue = data.data;

  return (
    <AppShell
      role={profile.employee.role}
      title="Audit queue"
      currentPath="/auditor"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1200 }}>
        {data.error && (
          <Alert severity="error" role="alert">
            {data.error}
          </Alert>
        )}
        <Paper variant="outlined">
          {!queue ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>
              {data.error ? 'The audit queue could not be loaded.' : 'Loading the audit queue…'}
            </Typography>
          ) : queue.total === 0 ? (
            <EmptyState
              title="No charts waiting for audit"
              description="Charts appear here as soon as a Coder submits them on a project you are assigned to."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Charts waiting for audit">
                <TableHead>
                  <TableRow>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Client · Project</TableCell>
                    <TableCell>Coder</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell align="right">ICDs</TableCell>
                    <TableCell align="right">DOS</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Submitted</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {queue.items.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <Link
                          component={NextLink}
                          href={`/auditor/charts/${c.id}`}
                          aria-label={`Audit chart ${c.chartId}`}
                          underline="hover"
                        >
                          {c.chartId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {c.project.client} · {c.project.name}
                      </TableCell>
                      <TableCell>{c.coder}</TableCell>
                      <TableCell align="right">{c.pages ?? '—'}</TableCell>
                      <TableCell align="right">{c.icds}</TableCell>
                      <TableCell align="right">{c.dos}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={c.isReAudit ? 'Re-audit' : 'Audit'} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(c.codedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      </Box>
    </AppShell>
  );
}

/** Auditor home: the charts waiting for audit on the auditor's projects. */
export function AuditQueueWorkspace() {
  return (
    <RequireSession permission="audit.perform">
      <Queue />
    </RequireSession>
  );
}
