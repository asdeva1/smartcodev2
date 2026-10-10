'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  CHART_STATUS_LABELS,
  CHART_STATUSES,
  type ChartRepositoryPage,
  type ChartStatus,
  type ChartTimeline,
  type Page,
  type ProjectListRecord,
} from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { StatusChip } from '@/components/StatusChip';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { useResource } from '../projects/shared';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const label = (s: string) => CHART_STATUS_LABELS[s as ChartStatus] ?? s;

function TimelineDialog({ chartId, onClose }: { chartId: string; onClose: () => void }) {
  const timeline = useResource<ChartTimeline>(`/charts/${chartId}/timeline`);
  const t = timeline.data;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="timeline-title">
      <DialogTitle id="timeline-title">{t ? `Chart ${t.chart.chartId}` : 'Chart history'}</DialogTitle>
      <DialogContent>
        {timeline.error && <Alert severity="error">{timeline.error}</Alert>}
        {t && (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t.chart.project.client} · {t.chart.project.name}
            </Typography>
            <Box
              component="ol"
              aria-label="Status history"
              sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.25 }}
            >
              {t.events.map((e, i) => (
                <Box component="li" key={`${e.at}-${i}`} sx={{ display: 'grid', gap: 0.25 }}>
                  <Typography>
                    {e.fromStatus ? `${label(e.fromStatus)} to ${label(e.toStatus)}` : label(e.toStatus)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {when(e.at)}
                    {e.actor ? ` · ${e.actor.fullName}` : ' · System'}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function Repository() {
  const { profile, signOut } = useSession();
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  const projects = useResource<Page<ProjectListRecord>>('/projects?pageSize=100');
  const params = new URLSearchParams({ page: String(page + 1), pageSize: String(pageSize) });
  if (q.trim()) params.set('q', q.trim());
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  const list = useResource<ChartRepositoryPage>(`/charts?${params.toString()}`);
  const data = list.data;
  const counts = data?.statusCounts ?? {};
  const reset = () => setPage(0);

  return (
    <AppShell
      role={profile.employee.role}
      title="Chart repository"
      currentPath="/charts"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search Chart ID"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
            sx={{ width: 240 }}
          />
          <TextField
            select
            size="small"
            label="Project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              reset();
            }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ width: 300 }}
          >
            <MenuItem value="">All projects</MenuItem>
            {(projects.data?.items ?? []).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.client.name} · {p.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} role="group" aria-label="Filter by status">
          <Chip
            label={`All ${Object.values(counts)
              .reduce((n, v) => n + v, 0)
              .toLocaleString('en-IN')}`}
            color={status === '' ? 'primary' : 'default'}
            onClick={() => {
              setStatus('');
              reset();
            }}
          />
          {CHART_STATUSES.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
            <Chip
              key={s}
              label={`${CHART_STATUS_LABELS[s]} ${(counts[s] ?? 0).toLocaleString('en-IN')}`}
              color={status === s ? 'primary' : 'default'}
              onClick={() => {
                setStatus(s);
                reset();
              }}
            />
          ))}
        </Box>
        {list.error && <Alert severity="error">{list.error}</Alert>}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No charts found"
            description="Charts appear here once a Manager uploads a chart file or assigns charts to a project."
          />
        )}
        {data && data.items.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Charts">
                <TableHead>
                  <TableRow>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Project</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell>With coder</TableCell>
                    <TableCell>Last updated</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((c) => (
                    <TableRow key={c.id} hover>
                      <TableCell component="th" scope="row">
                        {c.chartId}
                      </TableCell>
                      <TableCell>
                        {c.project.client} · {c.project.name}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={c.status as ChartStatus} />
                      </TableCell>
                      <TableCell align="right">{c.pages ?? '—'}</TableCell>
                      <TableCell>{c.coder ? `${c.coder.fullName} (${c.coder.loginName})` : '—'}</TableCell>
                      <TableCell>{when(c.updatedAt)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          onClick={() => setOpen(c.id)}
                          aria-label={`History of ${c.chartId}`}
                        >
                          History
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={data.total}
              page={page}
              rowsPerPage={pageSize}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </Paper>
        )}
      </Box>
      {open && <TimelineDialog chartId={open} onClose={() => setOpen(null)} />}
    </AppShell>
  );
}

/** Every chart the signed-in person may see, across projects. The API enforces scope. */
export function ChartRepositoryWorkspace() {
  return (
    <RequireSession permission="chart.read">
      <Repository />
    </RequireSession>
  );
}
