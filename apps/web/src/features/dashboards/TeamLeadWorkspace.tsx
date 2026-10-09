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
import type { TeamLeadDashboard } from '@smartcode/shared';
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
  const { data, error } = useDashboard<TeamLeadDashboard>('/dashboards/team-lead');
  return (
    <AppShell
      role="TEAM_LEAD"
      title="My team"
      currentPath="/team-lead"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3.5, maxWidth: 1200 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {data && data.teams.length === 0 && (
          <EmptyState
            title="You do not lead a team yet"
            description="Ask a Manager to make you the Team Lead of a team. Your coders will appear here."
          />
        )}
        {data && data.teams.length > 0 && (
          <>
            <Typography variant="body2" color="text.secondary">
              {data.teams.map((t) => t.name).join(', ')}. Figures cover the month from {data.monthFrom} (
              {data.timeZone}). Refreshes every 30 seconds.
            </Typography>
            <Section title="Team today and this month">
              <Tiles>
                <Tile label="Coders" value={num(data.totals.coders)} />
                <Tile label="Charts with coders" value={num(data.totals.openCharts)} />
                <Tile label="Charts coded today" value={num(data.totals.chartsToday)} />
                <Tile
                  label="Charts coded this month"
                  value={num(data.totals.chartsMonth)}
                  hint={`${num(data.totals.pagesMonth)} pages`}
                />
                <Tile label="CPH" value={dash(data.totals.cph)} hint="Average across coders" />
                <Tile
                  label="Audit percentage"
                  value={dash(data.totals.auditPercentage, '%')}
                  hint={`${num(data.totals.auditedCharts)} audited · ${num(data.totals.totalErrors)} errors`}
                />
              </Tiles>
            </Section>
            <Section title="Waiting on the team">
              <Tiles>
                <Tile label="Pending audit" value={num(data.pending.audit)} />
                <Tile label="Review required" value={num(data.pending.reviewRequired)} />
                <Tile label="Open rework" value={num(data.pending.rework)} />
              </Tiles>
            </Section>
            <Section title="Coders">
              {data.coders.length === 0 ? (
                <EmptyState
                  title="No coders in your team yet"
                  description="A Manager adds coders to a team."
                />
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Team coders">
                    <TableHead>
                      <TableRow>
                        <TableCell>Coder</TableCell>
                        <TableCell>Client login</TableCell>
                        <TableCell align="right">With coder now</TableCell>
                        <TableCell align="right">Charts today</TableCell>
                        <TableCell align="right">Charts this month</TableCell>
                        <TableCell align="right">Pages this month</TableCell>
                        <TableCell align="right">CPH</TableCell>
                        <TableCell align="right">Audit %</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.coders.map((c) => (
                        <TableRow key={c.coderId}>
                          <TableCell component="th" scope="row">
                            {c.fullName}
                          </TableCell>
                          <TableCell>{c.loginName ?? '—'}</TableCell>
                          <TableCell align="right">{num(c.openCharts)}</TableCell>
                          <TableCell align="right">{num(c.chartsToday)}</TableCell>
                          <TableCell align="right">{num(c.chartsMonth)}</TableCell>
                          <TableCell align="right">{num(c.pagesMonth)}</TableCell>
                          <TableCell align="right">{dash(c.cph)}</TableCell>
                          <TableCell align="right">{dash(c.auditPercentage, '%')}</TableCell>
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

/** Signed-in Team Leads only; the API limits every figure to the teams they lead. */
export function TeamLeadWorkspace() {
  return (
    <RequireSession role="TEAM_LEAD">
      <Dashboard />
    </RequireSession>
  );
}
