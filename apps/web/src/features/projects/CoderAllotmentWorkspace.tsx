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
import type { CoderDashboard, MyAllotment } from '@smartcode/shared';
import NextLink from 'next/link';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { chartStatusLabel, formatDateTime, useResource } from './shared';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, flex: '1 1 200px', minWidth: 180 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function Allotment() {
  const { profile, signOut } = useSession();
  const data = useResource<MyAllotment>('/allocation/mine');
  const allotment = data.data;
  const dash = useResource<CoderDashboard>('/production/dashboard').data;

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
        {dash && (
          <Box
            sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}
            role="group"
            aria-label="Your coding figures"
          >
            <Tile label="Total charts coded" value={String(dash.totalCoded)} />
            <Tile label="Today’s charts" value={String(dash.todayCoded)} />
            <Tile
              label="CPH (charts per hour)"
              value={dash.cph === null ? '—' : dash.cph.toFixed(1)}
              hint={
                dash.cph === null
                  ? 'Calculated from your active time once you submit a chart'
                  : `Over ${dash.activeHours} active hours; time on hold is not counted`
              }
            />
            <Tile
              label="Audit percentage"
              value={dash.auditPercentage === null ? '—' : `${dash.auditPercentage.toFixed(1)}%`}
              hint={
                dash.auditPercentage === null
                  ? 'Appears after your first chart is audited'
                  : `${dash.totalErrors} error${dash.totalErrors === 1 ? '' : 's'} in ${dash.auditedCharts} audited chart${dash.auditedCharts === 1 ? '' : 's'}`
              }
            />
          </Box>
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
                Allocated project{dash && dash.projects.length > 1 ? 's' : ''}
              </Typography>
              <Typography variant="h5" component="p" sx={{ mt: 0.75 }}>
                {dash && dash.projects.length > 0
                  ? dash.projects.map((p) => `${p.client} · ${p.name}`).join(', ')
                  : 'None yet'}
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
                      <TableCell sx={{ fontWeight: 600 }}>
                        <Link
                          component={NextLink}
                          href={`/coder/charts/${c.id}`}
                          aria-label={`Open chart ${c.chartId}`}
                          underline="hover"
                        >
                          {c.chartId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {c.project.client} · {c.project.name}
                      </TableCell>
                      <TableCell align="right">{c.pages ?? '—'}</TableCell>
                      <TableCell>{c.pageBucket ?? '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>{c.remarks ?? '—'}</TableCell>
                      <TableCell>
                        {c.heldAt ? (
                          <Chip
                            size="small"
                            color="warning"
                            label="On hold"
                            title={c.holdReason ?? undefined}
                          />
                        ) : (
                          <Chip size="small" variant="outlined" label={chartStatusLabel(c.status)} />
                        )}
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

/** Coder portal home: the charts allotted to the signed-in coder. Clicking a chart opens its workspace. */
export function CoderAllotmentWorkspace() {
  return (
    <RequireSession permission="dashboard.coder">
      <Allotment />
    </RequireSession>
  );
}
