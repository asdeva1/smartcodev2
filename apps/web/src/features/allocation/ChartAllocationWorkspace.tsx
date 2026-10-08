'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
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
  type ChartLookupRecord,
  LOGIN_NAME_CSV_COLUMNS,
  ROLE_LABELS,
  type Role,
  emailSchema,
  loginNameSchema,
} from '@smartcode/shared';
import { type FormEvent, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { CsvImportDialog } from '@/features/employees/CsvImportDialog';
import { formatDate, problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction, usePagedList } from '../admin/ui';

interface LoginNameRow {
  id: string;
  value: string;
  status: string;
  holder: { id: string; employeeCode: string; fullName: string; email: string; role: Role } | null;
  assignedAt: string | null;
}

const CHART_STATUS_LABEL = (status: string) =>
  status
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ───────── Chart ID search ─────────

function ChartSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ChartLookupRecord[] | null>(null);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    const term = q.trim();
    if (!term) return setError('Enter a Chart ID to search.');
    setBusy(true);
    setError(null);
    try {
      setResults(await apiFetch<ChartLookupRecord[]>(`/allocation/charts?q=${encodeURIComponent(term)}`));
      setSearched(term);
    } catch (e) {
      setError(problemText(e, 'The search could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  const details = (chart: ChartLookupRecord): [string, string][] =>
    chart.allocation
      ? [
          ['Login Name', chart.allocation.loginName],
          ['Assigned to', `${chart.allocation.assignedTo.fullName} (${chart.allocation.assignedTo.email})`],
          ['Allotted by', chart.allocation.allocatedBy.fullName],
          ['Allotted date', formatDateTime(chart.allocation.allocatedAt)],
        ]
      : [];

  return (
    <Paper variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 2 }}>
      <Typography variant="h5" component="h2">
        Find a chart
      </Typography>
      <Box component="form" noValidate onSubmit={(e) => void search(e)} sx={{ display: 'flex', gap: 1.5 }}>
        <TextField
          size="small"
          label="Search Chart ID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ flex: 1, maxWidth: 520 }}
        />
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </Box>
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      {results && results.length === 0 && (
        <Alert severity="info">
          No chart with the ID “{searched}” was found. Charts appear here after they are imported into a
          project.
        </Alert>
      )}
      {results?.map((chart) => (
        <Paper key={`${chart.project.id}-${chart.chartId}`} variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
            <Typography variant="h6" component="h3">
              {chart.chartId}
            </Typography>
            <Chip size="small" variant="outlined" label={CHART_STATUS_LABEL(chart.status)} />
            <Typography variant="body2" color="text.secondary">
              {chart.project.client} · {chart.project.name}
            </Typography>
          </Box>
          {chart.allocation ? (
            <Box
              component="dl"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                columnGap: 3,
                rowGap: 0.75,
                m: 0,
              }}
            >
              {details(chart).map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Typography component="dt" color="text.secondary">
                    {label} :
                  </Typography>
                  <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary">This chart has not been allocated yet.</Typography>
          )}
        </Paper>
      ))}
    </Paper>
  );
}

// ───────── Assign Login Name (manual) ─────────

function AssignLoginNameDialog({ onClose }: { onClose: (message: string | null) => void }) {
  const [loginName, setLoginName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ loginName?: string; email?: string }>({});
  const action = useAction<string>((message) => onClose(message));

  return (
    <FormDialog
      title="Assign Login Name"
      onClose={() => onClose(null)}
      submitLabel="Assign"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        const name = loginNameSchema.safeParse(loginName);
        const mail = emailSchema.safeParse(email);
        const next = {
          ...(name.success ? {} : { loginName: name.error.issues[0]?.message }),
          ...(mail.success ? {} : { email: mail.error.issues[0]?.message }),
        };
        setErrors(next);
        if (!name.success || !mail.success) return;
        void action.run(async () => {
          await apiFetch('/login-names/assignments', {
            method: 'POST',
            body: JSON.stringify({ loginName: name.data, email: mail.data }),
          });
          return `${name.data} assigned to ${mail.data}.`;
        });
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Enter the Login Name and the employee’s email. The employee must be active and in a role that uses a
        Login Name.
      </Typography>
      <TextField
        label="Login Name"
        placeholder="naveen@vlms.com"
        value={loginName}
        onChange={(e) => setLoginName(e.target.value)}
        error={Boolean(errors.loginName)}
        helperText={errors.loginName}
        size="small"
        autoFocus
        required
      />
      <TextField
        label="Email"
        placeholder="naveen@smartcluestech.com"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={Boolean(errors.email)}
        helperText={errors.email}
        size="small"
        required
      />
    </FormDialog>
  );
}

// ───────── Login Names list ─────────

function LoginNames({ onToast }: { onToast: (message: string) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [assigning, setAssigning] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = usePagedList<LoginNameRow>('/login-names', { page: page + 1, pageSize, q: q || undefined });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="h5" component="h2" sx={{ mr: 2 }}>
          Login Names
        </Typography>
        <TextField
          size="small"
          fullWidth={false}
          label="Search Login Name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 260 }}
        />
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={() => setImporting(true)}>
          Import CSV
        </Button>
        <Button variant="contained" onClick={() => setAssigning(true)}>
          Assign Login Name
        </Button>
      </Box>

      <Paper variant="outlined">
        {list.error ? (
          <Box role="alert" sx={{ p: 3 }}>
            {list.error}
          </Box>
        ) : list.data && list.data.total === 0 ? (
          <EmptyState
            title="No Login Names yet"
            description="Assign one by hand with the employee’s email, or import many at once from a CSV file."
            action={
              <Button variant="contained" onClick={() => setAssigning(true)}>
                Assign Login Name
              </Button>
            }
          />
        ) : (
          <>
            <TableContainer>
              <Table size="small" aria-label="Login Names">
                <TableHead>
                  <TableRow>
                    <TableCell>Login Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Assigned to</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Assigned on</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(list.data?.items ?? []).map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>{row.value}</TableCell>
                      <TableCell>{row.holder?.email ?? '—'}</TableCell>
                      <TableCell>
                        {row.holder ? (
                          <>
                            {row.holder.fullName}
                            <Typography variant="caption" color="text.secondary" component="div">
                              {row.holder.employeeCode}
                            </Typography>
                          </>
                        ) : (
                          'Not assigned'
                        )}
                      </TableCell>
                      <TableCell>{row.holder ? ROLE_LABELS[row.holder.role] : '—'}</TableCell>
                      <TableCell>{row.assignedAt ? formatDate(row.assignedAt) : '—'}</TableCell>
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
              rowsPerPageOptions={[10, 25, 50, 100]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            />
          </>
        )}
      </Paper>

      {assigning && (
        <AssignLoginNameDialog
          onClose={(message) => {
            setAssigning(false);
            if (message) {
              onToast(message);
              list.refresh();
            }
          }}
        />
      )}
      {importing && (
        <CsvImportDialog
          title="Import Login Names"
          columns={LOGIN_NAME_CSV_COLUMNS}
          templateRow="naveen@vlms.com,naveen@smartcluestech.com"
          guidance="Columns: Login Name and Email. Each row gives a Login Name to the active employee with that email. Delete the example row from the template before you upload. Rows are flagged when the email is unknown, the employee is pending or inactive, the role does not use a Login Name, or a Login Name or email appears twice."
          previewPath="/login-names/import/preview"
          commitPath="/login-names/import/commit"
          doneVerb="assigned"
          onClose={(changed) => {
            setImporting(false);
            if (changed) {
              onToast('Login Names imported.');
              list.refresh();
            }
          }}
        />
      )}
    </Box>
  );
}

function Workspace() {
  const { profile, signOut } = useSession();
  const [toast, setToast] = useState<string | null>(null);
  return (
    <AppShell
      role={profile.employee.role}
      title="Chart allocation"
      currentPath="/manager/allocation"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3, maxWidth: 1300 }}>
        <ChartSearch />
        <LoginNames onToast={setToast} />
      </Box>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

/** Chart Allocation — Manager only. Login Names and the Chart ID search live here, not in the Employee directory. */
export function ChartAllocationWorkspace() {
  return (
    <RequireSession permission="chart.allocate">
      <Workspace />
    </RequireSession>
  );
}
