'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
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
  ALLOCATION_CSV_COLUMNS,
  type ProjectChartRecord,
  type ProjectDetail,
  type PullbackResult,
  type SubmitToClientResult,
} from '@smartcode/shared';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { CsvImportDialog } from '@/features/employees/CsvImportDialog';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction, usePagedList } from '../admin/ui';
import { chartStatusLabel, formatDateTime } from './shared';

const PULLABLE = new Set(['ALLOCATED', 'IN_PRODUCTION']);
/** A chart the coder has on hold cannot be pulled back. */
const canPullBack = (c: { status: string; heldAt: string | null }) => PULLABLE.has(c.status) && !c.heldAt;
const STATUS_FILTERS = [
  'PENDING_ALLOCATION',
  'ALLOCATED',
  'IN_PRODUCTION',
  'CODED',
  'PENDING_AUDIT',
  'REVIEW_REQUIRED',
  'REWORK',
  'RE_AUDIT',
  'AUDITED',
  'COMPLETED',
];

type Dialog = 'upload' | 'pullback' | 'submit' | null;

export function ProjectAllocation({
  project,
  onChanged,
  onToast,
}: {
  project: ProjectDetail;
  onChanged: () => void;
  onToast: (message: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const list = usePagedList<ProjectChartRecord>(`/projects/${project.id}/charts`, {
    page: page + 1,
    pageSize,
    q: q || undefined,
    status: status || undefined,
  });
  const active = project.status === 'ACTIVE';
  const rows = list.data?.items ?? [];
  const pullableRows = rows.filter(canPullBack);
  const completedWaiting = (project.chartsByStatus.COMPLETED ?? 0) - project.submittedToClient;
  const openCharts = (project.chartsByStatus.ALLOCATED ?? 0) + (project.chartsByStatus.IN_PRODUCTION ?? 0);

  const refreshAll = () => {
    setSelected(new Set());
    list.refresh();
    onChanged();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Paper
        variant="outlined"
        sx={{ p: 2, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Button variant="contained" disabled={!active} onClick={() => setDialog('upload')}>
          Upload allocation CSV
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={selected.size === 0 && openCharts === 0}
          onClick={() => setDialog('pullback')}
        >
          Pull back charts{selected.size ? ` (${selected.size} selected)` : ''}
        </Button>
        <Button variant="outlined" disabled={completedWaiting <= 0} onClick={() => setDialog('submit')}>
          Completed charts{completedWaiting > 0 ? ` (${completedWaiting})` : ''}
        </Button>
      </Paper>
      {!active && (
        <Alert severity="info">
          Only an active project can receive charts. Set the project to Active to upload.
        </Alert>
      )}
      {project.clientPullbackAt && (
        <Alert severity="warning">
          All charts were pulled back on {formatDateTime(project.clientPullbackAt)}. Every coder’s allotment
          for the charts still in progress was cleared.
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Search Chart ID"
          fullWidth={false}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 240 }}
        />
        <TextField
          size="small"
          select
          label="Status"
          fullWidth={false}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All</MenuItem>
          {STATUS_FILTERS.map((s) => (
            <MenuItem key={s} value={s}>
              {chartStatusLabel(s)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Paper variant="outlined">
        {list.error ? (
          <Box role="alert" sx={{ p: 3 }}>
            {list.error}
          </Box>
        ) : list.data && list.data.total === 0 ? (
          <EmptyState
            title={q || status ? 'No charts match' : 'No charts in this project yet'}
            description="Upload the allocation CSV: Login Name, Email ID, Chart ID, Pages, Page Bucket, Remarks. Each chart is allotted to that coder, who sees it in the Coder portal."
            action={
              !q && !status && active ? (
                <Button variant="contained" onClick={() => setDialog('upload')}>
                  Upload allocation CSV
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <TableContainer>
              <Table size="small" aria-label="Project charts">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        slotProps={{ input: { 'aria-label': 'Select all pullable charts on this page' } }}
                        checked={pullableRows.length > 0 && pullableRows.every((r) => selected.has(r.id))}
                        indeterminate={
                          pullableRows.some((r) => selected.has(r.id)) &&
                          !pullableRows.every((r) => selected.has(r.id))
                        }
                        disabled={pullableRows.length === 0}
                        onChange={(e) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            for (const r of pullableRows) {
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                            }
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>Chart ID</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Login Name</TableCell>
                    <TableCell>Assigned to</TableCell>
                    <TableCell align="right">Pages</TableCell>
                    <TableCell>Page bucket</TableCell>
                    <TableCell>Remarks</TableCell>
                    <TableCell>Allotted</TableCell>
                    <TableCell>Completed</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} hover selected={selected.has(c.id)}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          disabled={!canPullBack(c)}
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          slotProps={{ input: { 'aria-label': `Select ${c.chartId}` } }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.chartId}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Chip size="small" variant="outlined" label={chartStatusLabel(c.status)} />
                        {c.heldAt && (
                          <Chip
                            size="small"
                            color="warning"
                            label="On hold"
                            title={c.holdReason ?? undefined}
                            sx={{ ml: 0.75 }}
                          />
                        )}
                        {c.heldAt && c.holdReason && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {c.holdReason}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{c.allocation?.loginName ?? '—'}</TableCell>
                      <TableCell>{c.allocation ? c.allocation.assignedTo.fullName : '—'}</TableCell>
                      <TableCell align="right">{c.pages ?? '—'}</TableCell>
                      <TableCell>{c.pageBucket ?? '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>{c.remarks ?? '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {c.allocation ? formatDateTime(c.allocation.allocatedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        {c.submittedToClientAt ? (
                          <Chip size="small" color="success" variant="outlined" label="Completed" />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={list.data?.total ?? 0}
              page={page}
              rowsPerPage={pageSize}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </>
        )}
      </Paper>

      {dialog === 'upload' && (
        <CsvImportDialog
          title="Upload allocation CSV"
          columns={ALLOCATION_CSV_COLUMNS}
          templateRow="naveen@vlms.com,naveen@smartcluestech.com,CH-10001,12,1-25,Priority"
          guidance="Each row allots one chart to the coder with that Email ID under that Login Name. Pages, Page Bucket and Remarks are optional. If the coder has no Login Name yet it is assigned from the file, and the coder is added to this project. Delete the example row from the template before you upload. A chart that is already allotted must be pulled back first."
          previewPath={`/projects/${project.id}/allocation/preview`}
          commitPath={`/projects/${project.id}/allocation/commit`}
          doneVerb="allotted"
          onClose={(changed) => {
            setDialog(null);
            if (changed) {
              onToast('Charts allotted. Coders can see them in their portal.');
              refreshAll();
            }
          }}
        />
      )}
      {dialog === 'pullback' && (
        <PullbackDialog
          projectId={project.id}
          selectedIds={[...selected]}
          openCharts={openCharts}
          onClose={(message) => {
            setDialog(null);
            if (message) {
              onToast(message);
              refreshAll();
            }
          }}
        />
      )}
      {dialog === 'submit' && (
        <SubmitDialog
          projectId={project.id}
          waiting={completedWaiting}
          onClose={(message) => {
            setDialog(null);
            if (message) {
              onToast(message);
              refreshAll();
            }
          }}
        />
      )}
    </Box>
  );
}

function PullbackDialog({
  projectId,
  selectedIds,
  openCharts,
  onClose,
}: {
  projectId: string;
  selectedIds: string[];
  openCharts: number;
  onClose: (message: string | null) => void;
}) {
  const [scope, setScope] = useState<'selected' | 'all'>(selectedIds.length ? 'selected' : 'all');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useAction<string>((message) => onClose(message));
  const plural = (n: number) => `${n} chart${n === 1 ? '' : 's'}`;
  return (
    <FormDialog
      title="Pull back charts"
      onClose={() => onClose(null)}
      submitLabel="Pull back"
      submitColor="error"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        if (scope === 'all' && reason.trim().length < 3)
          return setError('Give a short reason, for example the client’s ticket number.');
        setError(null);
        void action.run(async () => {
          const body = reason.trim();
          const r =
            scope === 'selected'
              ? await apiFetch<PullbackResult>(`/projects/${projectId}/charts/pull-back`, {
                  method: 'POST',
                  body: JSON.stringify({ chartIds: selectedIds, ...(body ? { reason: body } : {}) }),
                })
              : await apiFetch<PullbackResult>(`/projects/${projectId}/client-pullback`, {
                  method: 'POST',
                  body: JSON.stringify({ reason: body }),
                });
          return `${plural(r.pulledBack)} pulled back.`;
        });
      }}
    >
      <Typography>
        Pulled-back charts return to the project and disappear from the coders’ allotment. Work already
        submitted for audit is not changed.
      </Typography>
      <RadioGroup value={scope} onChange={(e) => setScope(e.target.value as 'selected' | 'all')}>
        <FormControlLabel
          value="selected"
          disabled={selectedIds.length === 0}
          control={<Radio />}
          label={`Selected charts (${selectedIds.length})`}
        />
        <FormControlLabel
          value="all"
          disabled={openCharts === 0}
          control={<Radio />}
          label={`All ${plural(openCharts)} the coders still hold — every coder’s allotment becomes zero`}
        />
      </RadioGroup>
      <TextField
        size="small"
        label={scope === 'all' ? 'Reason' : 'Reason (optional)'}
        required={scope === 'all'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={Boolean(error)}
        helperText={error}
      />
    </FormDialog>
  );
}

function SubmitDialog({
  projectId,
  waiting,
  onClose,
}: {
  projectId: string;
  waiting: number;
  onClose: (message: string | null) => void;
}) {
  const action = useAction<string>((message) => onClose(message));
  return (
    <FormDialog
      title="Completed charts"
      onClose={() => onClose(null)}
      submitLabel={`Mark ${waiting} completed`}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(async () => {
          const r = await apiFetch<SubmitToClientResult>(`/projects/${projectId}/charts/submit-to-client`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          return `${r.submitted} chart${r.submitted === 1 ? '' : 's'} marked completed.`;
        })
      }
    >
      <Typography>
        {waiting} completed chart{waiting === 1 ? ' is' : 's are'} ready. Submitting records today’s date as
        the date they went back to the client.
      </Typography>
    </FormDialog>
  );
}
