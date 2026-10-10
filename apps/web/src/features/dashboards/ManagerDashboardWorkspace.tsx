'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { IN_HOUSE_FILTER, type ManagerDashboard, type VendorRecord } from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { usePagedList } from '../admin/ui';
import { dash, FigureSections, num, Section } from './DashboardParts';

const REFRESH_MS = 30_000;

function Dashboard() {
  const { profile, signOut } = useSession();
  const [filter, setFilter] = useState('');
  const [data, setData] = useState<ManagerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vendors = usePagedList<VendorRecord>('/vendors', { page: 1, pageSize: 100 });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<ManagerDashboard>(`/dashboards/manager${filter ? `?vendorId=${filter}` : ''}`)
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
  }, [filter]);

  return (
    <AppShell
      role="MANAGER"
      title="Manager dashboard"
      currentPath="/manager"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3.5, maxWidth: 1200 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ width: 300, flex: 'none' }}
          >
            <MenuItem value="">In-house and all vendors</MenuItem>
            <MenuItem value={IN_HOUSE_FILTER}>In-house only</MenuItem>
            {(vendors.data?.items ?? []).map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
              </MenuItem>
            ))}
          </TextField>
          {data && (
            <Typography variant="body2" color="text.secondary">
              Production and quality figures cover the month from {data.monthFrom} ({data.timeZone}).
              Refreshes every 30 seconds.
            </Typography>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {data && (
          <>
            <FigureSections data={data} />

            <Section title="Vendor performance">
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" aria-label="Vendor performance">
                  <TableHead>
                    <TableRow>
                      <TableCell>Vendor</TableCell>
                      <TableCell align="right">Active coders</TableCell>
                      <TableCell align="right">Charts today</TableCell>
                      <TableCell align="right">Charts this month</TableCell>
                      <TableCell align="right">Pages this month</TableCell>
                      <TableCell align="right">CPH</TableCell>
                      <TableCell align="right">Audit %</TableCell>
                      <TableCell align="right">Completed charts</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.vendors.map((v) => (
                      <TableRow key={v.vendorId ?? 'in-house'}>
                        <TableCell component="th" scope="row">
                          {v.name}
                        </TableCell>
                        <TableCell align="right">{num(v.activeCoders)}</TableCell>
                        <TableCell align="right">{num(v.chartsToday)}</TableCell>
                        <TableCell align="right">{num(v.chartsMonth)}</TableCell>
                        <TableCell align="right">{num(v.pagesMonth)}</TableCell>
                        <TableCell align="right">{dash(v.cph)}</TableCell>
                        <TableCell align="right">{dash(v.auditPercentage, '%')}</TableCell>
                        <TableCell align="right">{num(v.completedCharts)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Section>
          </>
        )}
      </Box>
    </AppShell>
  );
}

/** Signed-in Managers only; the API enforces every figure, this only decides what to show. */
export function ManagerDashboardWorkspace() {
  return (
    <RequireSession role="MANAGER">
      <Dashboard />
    </RequireSession>
  );
}
