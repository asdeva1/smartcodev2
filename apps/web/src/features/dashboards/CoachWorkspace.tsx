'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { CoachDashboard } from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { dash, num, Section, Tile, Tiles } from './DashboardParts';

const REFRESH_MS = 30_000;

function useDashboard<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<T>(path)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(problemText(e, 'The dashboard could not be loaded.'));
        });
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path]);
  return { data, error };
}

function Dashboard() {
  const { profile, signOut } = useSession();
  const { data, error } = useDashboard<CoachDashboard>('/dashboards/coach');
  return (
    <AppShell
      role="GROUP_COACH"
      title="Quality coaching"
      currentPath="/sme"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3.5, maxWidth: 1200 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {data && data.totals.projects === 0 && (
          <EmptyState
            title="You are not on a project yet"
            description="A Manager adds you to a project. Its audit quality will appear here."
          />
        )}
        {data && data.totals.projects > 0 && (
          <>
            <Typography variant="body2" color="text.secondary">
              Audit figures cover the month from {data.monthFrom} ({data.timeZone}). Refreshes every 30
              seconds.
            </Typography>
            <Section title="Quality this month">
              <Tiles>
                <Tile label="Projects" value={num(data.totals.projects)} />
                <Tile label="Audited charts" value={num(data.totals.auditedCharts)} />
                <Tile label="Audit percentage" value={dash(data.totals.auditPercentage, '%')} />
                <Tile label="Total errors" value={num(data.totals.totalErrors)} />
                <Tile label="Review required" value={num(data.totals.reviewRequired)} />
                <Tile label="Open rework" value={num(data.totals.openRework)} />
              </Tiles>
            </Section>
            <Section title="Projects">
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label="Project quality">
                  <TableHead>
                    <TableRow>
                      <TableCell>Project</TableCell>
                      <TableCell>Client</TableCell>
                      <TableCell align="right">Audited</TableCell>
                      <TableCell align="right">Audit %</TableCell>
                      <TableCell align="right">Errors</TableCell>
                      <TableCell align="right">Review required</TableCell>
                      <TableCell align="right">Open rework</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.projects.map((p) => (
                      <TableRow key={p.projectId}>
                        <TableCell component="th" scope="row">
                          {p.name}
                        </TableCell>
                        <TableCell>{p.client}</TableCell>
                        <TableCell align="right">{num(p.auditedCharts)}</TableCell>
                        <TableCell align="right">{dash(p.auditPercentage, '%')}</TableCell>
                        <TableCell align="right">{num(p.totalErrors)}</TableCell>
                        <TableCell align="right">{num(p.reviewRequired)}</TableCell>
                        <TableCell align="right">{num(p.openRework)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Section>
            <Section title="Coders who need coaching first">
              {data.coders.length === 0 ? (
                <EmptyState
                  title="Nothing audited yet this month"
                  description="Coders appear once their charts are audited."
                />
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Coder quality">
                    <TableHead>
                      <TableRow>
                        <TableCell>Coder</TableCell>
                        <TableCell>Client login</TableCell>
                        <TableCell align="right">Audited</TableCell>
                        <TableCell align="right">Audit %</TableCell>
                        <TableCell align="right">Audit errors</TableCell>
                        <TableCell align="right">Error exceptions</TableCell>
                        <TableCell align="right">Total errors</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.coders.map((c) => (
                        <TableRow key={c.coderId}>
                          <TableCell component="th" scope="row">
                            {c.fullName}
                          </TableCell>
                          <TableCell>{c.loginName ?? '—'}</TableCell>
                          <TableCell align="right">{num(c.auditedCharts)}</TableCell>
                          <TableCell align="right">{dash(c.auditPercentage, '%')}</TableCell>
                          <TableCell align="right">{num(c.auditErrors)}</TableCell>
                          <TableCell align="right">{num(c.errorExceptions)}</TableCell>
                          <TableCell align="right">{num(c.totalErrors)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Section>
          </>
        )}
      </Box>
    </AppShell>
  );
}

/** Signed-in Quality Coaches only; the API limits every figure to the projects they are staffed on. */
export function CoachWorkspace() {
  return (
    <RequireSession role="GROUP_COACH">
      <Dashboard />
    </RequireSession>
  );
}
