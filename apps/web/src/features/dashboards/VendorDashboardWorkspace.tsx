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
import type { VendorDashboard } from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { dash, FigureSections, num, Section } from './DashboardParts';

const REFRESH_MS = 30_000;

function Dashboard() {
  const { profile, signOut } = useSession();
  const [data, setData] = useState<VendorDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<VendorDashboard>('/dashboards/vendor')
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
  }, []);

  return (
    <AppShell
      role="VENDOR_ADMIN"
      title="Vendor dashboard"
      currentPath="/vendor"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3.5, maxWidth: 1200 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {data && (
          <>
            <Typography variant="body2" color="text.secondary">
              {data.vendor.name}. Production and quality figures cover the month from {data.monthFrom} (
              {data.timeZone}). Refreshes every 30 seconds.
            </Typography>
            <FigureSections data={data} />
            <Section title="Coders">
              {data.coders.length === 0 ? (
                <EmptyState title="No active coders yet" description="Add coders under Employees." />
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Coder performance">
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

/** Signed-in Vendor Admins only; the API limits every figure to their own vendor. */
export function VendorDashboardWorkspace() {
  return (
    <RequireSession role="VENDOR_ADMIN">
      <Dashboard />
    </RequireSession>
  );
}
