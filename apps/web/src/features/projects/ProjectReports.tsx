'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { LiveTracking, ProductionReport, QualityReport, ReportRange } from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { apiDownload, saveBlob } from '@/lib/api';
import { useResource } from './shared';

const num = { fontVariantNumeric: 'tabular-nums' } as const;

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" component="p" sx={num}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

// ───────── Live chart tracking ─────────

const shortDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function LiveTrackingPanel({ projectId }: { projectId: string }) {
  const live = useResource<LiveTracking>(`/projects/${projectId}/live`);
  const { refresh } = live;
  // Live: refresh every 30 seconds while the tab is open and visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const data = live.data;
  if (live.error) return <Alert severity="error">{live.error}</Alert>;
  if (!data) return <Typography color="text.secondary">Loading live tracking…</Typography>;
  const peak = Math.max(1, ...data.days.map((d) => d.chartsDone));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Paper
        variant="outlined"
        sx={{ p: 2.5, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <Stat
          label="Charts done today"
          value={data.doneToday}
          hint={`Day of ${shortDay(data.today)} · ${data.timeZone}`}
        />
        <Stat label="In production" value={data.inProduction} />
        <Stat label="Allocated, not started" value={data.allocated} />
        <Stat label="Waiting for allocation" value={data.pendingAllocation} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Updates every 30 seconds · as of {new Date(data.asOf).toLocaleTimeString()}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" component="h3" gutterBottom>
          Charts done per day
        </Typography>
        <Box
          role="img"
          aria-label={`Charts done per day, last ${data.days.length} days. Today: ${data.doneToday}.`}
          sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 160 }}
        >
          {data.days.map((d) => (
            <Box
              key={d.date}
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <Typography variant="caption" sx={num}>
                {d.chartsDone}
              </Typography>
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 40,
                  height: d.chartsDone ? Math.max(4, Math.round((d.chartsDone / peak) * 120)) : 2,
                  borderRadius: '3px 3px 0 0',
                  bgcolor: d.date === data.today ? 'primary.main' : 'action.disabled',
                }}
              />
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
          {data.days.map((d) => (
            <Typography
              key={d.date}
              variant="caption"
              color="text.secondary"
              sx={{ flex: 1, textAlign: 'center' }}
            >
              {shortDay(d.date)}
            </Typography>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined">
        <Typography variant="h6" component="h3" sx={{ p: 2, pb: 1 }}>
          By coder
        </Typography>
        {data.coders.length === 0 ? (
          <EmptyState
            title="Nobody is working on this project yet"
            description="Charts appear here once they are allocated to coders."
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Charts by coder today">
              <TableHead>
                <TableRow>
                  <TableCell>Coder</TableCell>
                  <TableCell>Login Name</TableCell>
                  <TableCell align="right">Done today</TableCell>
                  <TableCell align="right">In production</TableCell>
                  <TableCell align="right">Allocated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.coders.map((c) => (
                  <TableRow key={c.coder.id} hover>
                    <TableCell>{c.coder.fullName}</TableCell>
                    <TableCell>{c.coder.loginName ?? '—'}</TableCell>
                    <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>
                      {c.doneToday}
                    </TableCell>
                    <TableCell align="right" sx={num}>
                      {c.inProduction}
                    </TableCell>
                    <TableCell align="right" sx={num}>
                      {c.allocated}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}

// ───────── Production & Quality reports ─────────

function RangePicker({
  range,
  from,
  to,
  onChange,
}: {
  range: ReportRange;
  from: string;
  to: string;
  onChange: (next: { range: ReportRange; from: string; to: string }) => void;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={range}
        aria-label="Report period"
        onChange={(_, next: ReportRange | null) => next && onChange({ range: next, from, to })}
      >
        <ToggleButton value="today">Today (Shift End)</ToggleButton>
        <ToggleButton value="month">Monthly</ToggleButton>
        <ToggleButton value="custom">Date range</ToggleButton>
      </ToggleButtonGroup>
      {range === 'custom' && (
        <>
          <TextField
            size="small"
            type="date"
            label="From"
            fullWidth={false}
            value={from}
            onChange={(e) => onChange({ range, from: e.target.value, to })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            fullWidth={false}
            value={to}
            onChange={(e) => onChange({ range, from, to: e.target.value })}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </>
      )}
    </Box>
  );
}

/** Download the report on screen (same period, same scope) as Excel or CSV. */
function DownloadButtons({
  projectId,
  type,
  query,
  disabled,
}: {
  projectId: string;
  type: 'production' | 'quality';
  query: string;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState<'xlsx' | 'csv' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const download = async (format: 'xlsx' | 'csv' | 'pdf') => {
    setBusy(format);
    setError(null);
    try {
      const file = await apiDownload(
        `/projects/${projectId}/reports/${type}/export?${query}&format=${format}`,
      );
      saveBlob(file.blob, file.filename);
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'The report could not be downloaded. Try again.',
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ml: { sm: 'auto' } }}>
      <Button
        variant="outlined"
        size="small"
        disabled={disabled || busy !== null}
        onClick={() => download('xlsx')}
      >
        {busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}
      </Button>
      <Button
        variant="outlined"
        size="small"
        disabled={disabled || busy !== null}
        onClick={() => download('csv')}
      >
        {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
      </Button>
      <Button
        variant="outlined"
        size="small"
        disabled={disabled || busy !== null}
        onClick={() => download('pdf')}
      >
        {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
      </Button>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Box>
  );
}

function usePeriod() {
  const [period, setPeriod] = useState<{ range: ReportRange; from: string; to: string }>({
    range: 'today',
    from: '',
    to: '',
  });
  const ready =
    period.range !== 'custom' || (period.from !== '' && period.to !== '' && period.from <= period.to);
  const query =
    period.range === 'custom' ? `range=custom&from=${period.from}&to=${period.to}` : `range=${period.range}`;
  return { period, setPeriod, ready, query };
}

const periodLabel = (p: { range: ReportRange; from: string; to: string }) =>
  p.range === 'today' ? `Today (${p.from})` : p.from === p.to ? p.from : `${p.from} to ${p.to}`;

export function ProductionReportPanel({ projectId }: { projectId: string }) {
  const { period, setPeriod, ready, query } = usePeriod();
  const report = useResource<ProductionReport>(
    ready ? `/projects/${projectId}/reports/production?${query}` : null,
  );
  const data = report.data;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <RangePicker {...period} onChange={setPeriod} />
        <DownloadButtons projectId={projectId} type="production" query={query} disabled={!ready} />
      </Box>
      {period.range === 'custom' && !ready && <Alert severity="info">Choose a start and end date.</Alert>}
      {report.error && <Alert severity="error">{report.error}</Alert>}
      {data && (
        <Paper variant="outlined">
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, pb: 0 }}>
            Production {periodLabel(data.period)} · {data.period.timeZone}
          </Typography>
          {data.rows.length === 0 ? (
            <EmptyState
              title="No production in this period"
              description="Submitted charts appear here with their pages, ICDs and DOS."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Production report">
                <TableHead>
                  <TableRow>
                    <TableCell>Coder</TableCell>
                    <TableCell>Login Name</TableCell>
                    <TableCell align="right">Charts</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell align="right">ICDs</TableCell>
                    <TableCell align="right">DOS</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.coder.id} hover>
                      <TableCell>{r.coder.fullName}</TableCell>
                      <TableCell>{r.coder.loginName ?? '—'}</TableCell>
                      <TableCell align="right" sx={num}>
                        {r.charts}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.pages}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.icds}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.dos}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                      Total
                    </TableCell>
                    <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
                      {data.totals.charts}
                    </TableCell>
                    <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
                      {data.totals.pages}
                    </TableCell>
                    <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
                      {data.totals.icds}
                    </TableCell>
                    <TableCell align="right" sx={{ ...num, fontWeight: 700 }}>
                      {data.totals.dos}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
}

export function QualityReportPanel({ projectId }: { projectId: string }) {
  const { period, setPeriod, ready, query } = usePeriod();
  const report = useResource<QualityReport>(ready ? `/projects/${projectId}/reports/quality?${query}` : null);
  const data = report.data;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <RangePicker {...period} onChange={setPeriod} />
        <DownloadButtons projectId={projectId} type="quality" query={query} disabled={!ready} />
      </Box>
      {period.range === 'custom' && !ready && <Alert severity="info">Choose a start and end date.</Alert>}
      {report.error && <Alert severity="error">{report.error}</Alert>}
      {data && (
        <Paper variant="outlined">
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, pb: 0 }}>
            Quality {periodLabel(data.period)} · {data.period.timeZone}
          </Typography>
          {data.rows.length === 0 ? (
            <EmptyState
              title="No audits in this period"
              description="Audited charts appear here with their error counts."
            />
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Quality report">
                <TableHead>
                  <TableRow>
                    <TableCell>Coder</TableCell>
                    <TableCell>Login Name</TableCell>
                    <TableCell align="right">Audited</TableCell>
                    <TableCell align="right">Passed</TableCell>
                    <TableCell align="right">Sent for review</TableCell>
                    <TableCell align="right">Rejected</TableCell>
                    <TableCell align="right">Audit errors</TableCell>
                    <TableCell align="right">Error exceptions</TableCell>
                    <TableCell align="right">Total errors</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.coder.id} hover>
                      <TableCell>{r.coder.fullName}</TableCell>
                      <TableCell>{r.coder.loginName ?? '—'}</TableCell>
                      <TableCell align="right" sx={num}>
                        {r.audited}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.passed}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.reviewRequired}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.rejected}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.auditErrors}
                      </TableCell>
                      <TableCell align="right" sx={num}>
                        {r.errorExceptions}
                      </TableCell>
                      <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>
                        {r.totalErrors}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                      Total
                    </TableCell>
                    {(
                      [
                        'audited',
                        'passed',
                        'reviewRequired',
                        'rejected',
                        'auditErrors',
                        'errorExceptions',
                        'totalErrors',
                      ] as const
                    ).map((k) => (
                      <TableCell key={k} align="right" sx={{ ...num, fontWeight: 700 }}>
                        {data.totals[k]}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </Box>
  );
}
