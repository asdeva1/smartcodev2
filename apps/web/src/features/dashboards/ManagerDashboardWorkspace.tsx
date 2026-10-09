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
import { CHART_STATUSES, IN_HOUSE_FILTER, type ManagerDashboard, type VendorRecord } from '@smartcode/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { StatusChip } from '@/components/StatusChip';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { usePagedList } from '../admin/ui';

const REFRESH_MS = 30_000;

const num = (n: number) => n.toLocaleString('en-IN');
const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n}${suffix}`);

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, flex: '1 1 170px', minWidth: 160 }}>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

const Tiles = ({ children }: { children: ReactNode }) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{children}</Box>
);

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
            <Section title="People and projects">
              <Tiles>
                <Tile label="Active projects" value={num(data.people.projects)} />
                <Tile label="Teams" value={num(data.people.teams)} />
                <Tile label="Active Team Leads" value={num(data.people.activeTeamLeads)} />
                <Tile label="Active Auditors" value={num(data.people.activeAuditors)} />
                <Tile label="Active Coders" value={num(data.people.activeCoders)} />
              </Tiles>
            </Section>

            <Section title="Production">
              <Tiles>
                <Tile
                  label="Charts coded today"
                  value={num(data.production.today.charts)}
                  hint={`${num(data.production.today.pages)} pages`}
                />
                <Tile
                  label="Charts coded this month"
                  value={num(data.production.month.charts)}
                  hint={`${num(data.production.month.pages)} pages · ${num(data.production.month.icds)} ICDs · ${num(data.production.month.dos)} DOS`}
                />
                <Tile
                  label="CPH"
                  value={dash(data.performance.cph)}
                  hint={`${data.performance.activeHours} active hours this month`}
                />
                <Tile
                  label="Audit percentage"
                  value={dash(data.performance.auditPercentage, '%')}
                  hint={`${num(data.performance.auditedCharts)} audited · ${num(data.performance.totalErrors)} errors`}
                />
              </Tiles>
            </Section>

            <Section title="Charts">
              <Tiles>
                <Tile label="Total charts" value={num(data.charts.total)} />
                <Tile label="Pending allocation" value={num(data.charts.pendingAllocation)} />
                <Tile label="With coders" value={num(data.charts.inProgress)} />
                <Tile label="Pending audit" value={num(data.charts.pendingAudit)} />
                <Tile label="Review required" value={num(data.charts.reviewRequired)} />
                <Tile label="Pending rework" value={num(data.charts.pendingRework)} />
                <Tile label="Completed charts" value={num(data.charts.completed)} />
                <Tile label="Completed audits" value={num(data.audits.completed)} />
              </Tiles>
              <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                {CHART_STATUSES.map((s) => (
                  <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <StatusChip status={s} />
                    <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {num(data.charts.byStatus[s] ?? 0)}
                    </Typography>
                  </Box>
                ))}
              </Paper>
            </Section>

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
