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
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import type { VendorDashboard, VendorRecord } from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { usePagedList } from '@/features/admin/ui';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { dash, FigureSections, num, Section } from './DashboardParts';

const REFRESH_MS = 30_000;

function Dashboard() {
  const { profile, signOut } = useSession();
  const [data, setData] = useState<VendorDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The Manager has full access and chooses which vendor to look at; a Vendor Admin always sees their own.
  const isManager = profile.employee.role === 'MANAGER';
  const vendors = usePagedList<VendorRecord>('/vendors', isManager ? { pageSize: 100 } : { pageSize: 1 });
  const [chosen, setChosen] = useState('');
  const vendorId = isManager ? chosen || vendors.data?.items[0]?.id || '' : '';

  useEffect(() => {
    if (isManager && !vendorId) return;
    let cancelled = false;
    const load = () =>
      apiFetch<VendorDashboard>(`/dashboards/vendor${vendorId ? `?vendorId=${vendorId}` : ''}`)
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
  }, [isManager, vendorId]);

  return (
    <AppShell
      role={profile.employee.role}
      title="Vendor dashboard"
      currentPath="/vendor"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3.5, maxWidth: 1200 }}>
        {isManager && vendors.data && vendors.data.items.length > 0 && (
          <TextField
            select
            label="Vendor"
            value={vendorId}
            onChange={(e) => {
              setData(null);
              setChosen(e.target.value);
            }}
            sx={{ maxWidth: 360 }}
          >
            {vendors.data.items.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {isManager && vendors.data && vendors.data.items.length === 0 && (
          <EmptyState title="No vendors yet" description="Add one under Vendors." />
        )}
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

/** Vendor Admins (their own vendor) and the Manager (any vendor); the API enforces which. */
export function VendorDashboardWorkspace() {
  return (
    <RequireSession permission="dashboard.vendor">
      <Dashboard />
    </RequireSession>
  );
}
