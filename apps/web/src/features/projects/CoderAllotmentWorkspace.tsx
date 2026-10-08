'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { MyAllotment } from '@smartcode/shared';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { chartStatusLabel, formatDateTime, useResource } from './shared';

function Allotment() {
  const { profile, signOut } = useSession();
  const data = useResource<MyAllotment>('/allocation/mine');
  const allotment = data.data;

  return (
    <AppShell
      role={profile.employee.role}
      title="My charts"
      currentPath="/coder"
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
        {allotment && (
          <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Charts allotted to you
              </Typography>
              <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {allotment.total}
              </Typography>
            </Box>
            <Box>
              <Typography variant="body2" color="text.secondary">
                Your Login Name
              </Typography>
              <Typography variant="h5" component="p" sx={{ mt: 0.75 }}>
                {allotment.loginName ?? 'Not assigned yet'}
              </Typography>
            </Box>
          </Paper>
        )}
        {allotment && !allotment.loginName && (
          <Alert severity="info">
            The Manager has not given you a Login Name yet. Charts are allotted to your Login Name.
          </Alert>
        )}
        <Paper variant="outlined">
          {!allotment ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>
              {data.error ? 'Your charts could not be loaded.' : 'Loading your charts…'}
            </Typography>
          ) : allotment.total === 0 ? (
            <EmptyState
              title="No charts allotted to you"
              description="When the Manager uploads an allocation file that includes your email, your charts appear here."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Charts allotted to you">
                <TableHead>
                  <TableRow>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Client · Project</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell>Page bucket</TableCell>
                    <TableCell>Remarks</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Allotted</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {allotment.charts.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{c.chartId}</TableCell>
                      <TableCell>
                        {c.project.client} · {c.project.name}
                      </TableCell>
                      <TableCell align="right">{c.pages ?? '—'}</TableCell>
                      <TableCell>{c.pageBucket ?? '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>{c.remarks ?? '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={chartStatusLabel(c.status)} />
                      </TableCell>
                      <TableCell>{formatDateTime(c.allocatedAt)}</TableCell>
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

/** Coder portal home: the charts allotted to the signed-in coder. Starting and submitting production is Phase 8. */
export function CoderAllotmentWorkspace() {
  return (
    <RequireSession permission="dashboard.coder">
      <Allotment />
    </RequireSession>
  );
}
