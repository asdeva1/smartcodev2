'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  EMPLOYEE_CSV_COLUMNS,
  EMPLOYEE_STATUSES,
  type EmployeeRecord,
  type Page,
  ROLES,
  ROLE_LABELS,
  type Role,
} from '@smartcode/shared';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { useSession } from '@/features/auth/session';
import { apiDownload, apiFetch, saveBlob } from '@/lib/api';
import { CsvImportDialog } from './CsvImportDialog';
import {
  type DirectoryOptions,
  EmployeeStatusChip,
  STATUS_LABEL,
  formatDate,
  problemText,
  toQuery,
} from './common';
import {
  AddEmployeeDialog,
  DeactivateDialog,
  EmployeeDetailDialog,
  RoleChangeDialog,
} from './EmployeeDialogs';

type SortField = 'employeeCode' | 'fullName' | 'email' | 'role' | 'status' | 'createdAt' | 'activatedAt';
type Dialog =
  | { kind: 'add' }
  | { kind: 'import' }
  | { kind: 'view'; employee: EmployeeRecord }
  | { kind: 'role'; employee: EmployeeRecord }
  | { kind: 'deactivate'; employee: EmployeeRecord }
  | null;

const EMPTY_OPTIONS: DirectoryOptions = { vendors: [], teams: [], projects: [] };

/** Roles the caller may create. A Vendor Admin creates the vendor's own staff only. */
function creatableRoles(role: Role): readonly Role[] {
  return role === 'VENDOR_ADMIN' ? ['TEAM_LEAD', 'AUDITOR', 'CODER'] : ROLES;
}

export function EmployeeDirectory() {
  const { profile, can } = useSession();
  const canCreate = can('employee.create');
  const canUpdate = can('employee.update');
  const canSend = can('employee.sendActivation');
  const canDeactivate = can('employee.deactivate');
  const canReset = can('employee.triggerPasswordReset');
  const canChangeRole = can('employee.changeRole');
  const isManager = profile.employee.role === 'MANAGER';

  const [filters, setFilters] = useState({
    q: '',
    role: '',
    status: '',
    vendorId: '',
    teamId: '',
    projectId: '',
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ field: SortField; direction: 'asc' | 'desc' }>({
    field: 'createdAt',
    direction: 'desc',
  });
  const [data, setData] = useState<Page<EmployeeRecord> | null>(null);
  const [options, setOptions] = useState<DirectoryOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ anchor: HTMLElement; employee: EmployeeRecord } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    apiFetch<DirectoryOptions>('/employees/options')
      .then(setOptions)
      .catch(() => setOptions(EMPTY_OPTIONS));
  }, []);

  // Search and filters wait a moment after typing so a fast typist does not fire a request per key.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      apiFetch<Page<EmployeeRecord>>(
        `/employees${toQuery({ ...filters, page: page + 1, pageSize, sort: sort.field, direction: sort.direction })}`,
      )
        .then((d) => {
          if (!live) return;
          setData(d);
          setError(null);
        })
        .catch((e: unknown) => live && setError(problemText(e, 'The directory could not be loaded.')));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filters, page, pageSize, sort, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const change = (key: keyof typeof filters) => (value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };

  async function exportCsv() {
    try {
      const { blob, filename } = await apiDownload(
        `/employees/export${toQuery({ ...filters, sort: sort.field, direction: sort.direction })}`,
      );
      saveBlob(blob, filename);
    } catch (e) {
      setError(problemText(e, 'The directory could not be exported.'));
    }
  }

  async function act(label: string, path: string, body?: object) {
    try {
      await apiFetch(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      setNotice(label);
      refresh();
    } catch (e) {
      setError(problemText(e));
    }
  }

  async function sendBulk() {
    try {
      const r = await apiFetch<{ sent: number; failed: number; skipped: { reason: string }[] }>(
        '/employees/activation-emails',
        {
          method: 'POST',
          body: JSON.stringify({ employeeIds: [...selected] }),
        },
      );
      setNotice(
        `${r.sent} activation link${r.sent === 1 ? '' : 's'} sent${r.skipped.length ? `, ${r.skipped.length} skipped (already active or not allowed)` : ''}${r.failed ? `, ${r.failed} could not be emailed` : ''}.`,
      );
      setSelected(new Set());
      refresh();
    } catch (e) {
      setError(problemText(e));
    }
  }

  const items = data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((e) => selected.has(e.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const sortBy = (field: SortField) =>
    setSort((s) => ({ field, direction: s.field === field && s.direction === 'asc' ? 'desc' : 'asc' }));
  const head = (field: SortField, label: string) => (
    <TableSortLabel
      active={sort.field === field}
      direction={sort.field === field ? sort.direction : 'asc'}
      onClick={() => sortBy(field)}
    >
      {label}
    </TableSortLabel>
  );

  const closeDialog = (changed: boolean) => {
    setDialog(null);
    if (changed) refresh();
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          label="Search"
          placeholder="Employee ID, name, email"
          value={filters.q}
          onChange={(e) => change('q')(e.target.value)}
          sx={{ minWidth: 280, flex: 1 }}
        />
        <Box sx={{ display: 'flex', gap: 1, ml: 'auto', flexWrap: 'wrap' }}>
          {canSend && (
            <Button variant="outlined" disabled={selected.size === 0} onClick={sendBulk}>
              Send activation links{selected.size ? ` (${selected.size})` : ''}
            </Button>
          )}
          <Button variant="outlined" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
          {canCreate && (
            <>
              <Button variant="outlined" onClick={() => setDialog({ kind: 'import' })}>
                Import CSV
              </Button>
              <Button variant="contained" onClick={() => setDialog({ kind: 'add' })}>
                Add employee
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }} role="group" aria-label="Filters">
        <TextField
          select
          size="small"
          label="Role"
          value={filters.role}
          onChange={(e) => change('role')(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">All roles</MenuItem>
          {ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={filters.status}
          onChange={(e) => change('status')(e.target.value)}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {EMPLOYEE_STATUSES.filter((s) => s !== 'LOCKED').map((s) => (
            <MenuItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </TextField>
        {options.vendors.length > 0 && (
          <TextField
            select
            size="small"
            label="Vendor"
            value={filters.vendorId}
            onChange={(e) => change('vendorId')(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All vendors</MenuItem>
            {options.vendors.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {options.teams.length > 0 && (
          <TextField
            select
            size="small"
            label="Team"
            value={filters.teamId}
            onChange={(e) => change('teamId')(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All teams</MenuItem>
            {options.teams.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        {options.projects.length > 0 && (
          <TextField
            select
            size="small"
            label="Project"
            value={filters.projectId}
            onChange={(e) => change('projectId')(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All projects</MenuItem>
            {options.projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Box>

      {error && (
        <Alert severity="error" role="alert" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        {data && items.length === 0 ? (
          <EmptyState
            title={
              Object.values(filters).some(Boolean) ? 'No employees match these filters' : 'No employees yet'
            }
            description={
              Object.values(filters).some(Boolean)
                ? 'Clear a filter or search for something else.'
                : canCreate
                  ? 'Add the first employee, or import a CSV of Employee ID, name, email and role.'
                  : 'Employees appear here once your Manager adds them.'
            }
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Employees">
              <TableHead>
                <TableRow>
                  {canSend && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={allOnPage}
                        indeterminate={!allOnPage && items.some((e) => selected.has(e.id))}
                        onChange={() => setSelected(allOnPage ? new Set() : new Set(items.map((e) => e.id)))}
                        slotProps={{ input: { 'aria-label': 'Select all on this page' } }}
                      />
                    </TableCell>
                  )}
                  <TableCell>{head('employeeCode', 'Employee ID')}</TableCell>
                  <TableCell>{head('fullName', 'Name')}</TableCell>
                  <TableCell>{head('email', 'Email')}</TableCell>
                  <TableCell>{head('role', 'Role')}</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell>Team Lead</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Vendor</TableCell>
                  <TableCell>Login Name</TableCell>
                  <TableCell>{head('status', 'Status')}</TableCell>
                  <TableCell>{head('createdAt', 'Created')}</TableCell>
                  <TableCell>{head('activatedAt', 'Activated')}</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((e) => (
                  <TableRow key={e.id} hover selected={selected.has(e.id)}>
                    {canSend && (
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selected.has(e.id)}
                          onChange={() => toggle(e.id)}
                          slotProps={{ input: { 'aria-label': `Select ${e.fullName}` } }}
                        />
                      </TableCell>
                    )}
                    <TableCell>{e.employeeCode}</TableCell>
                    <TableCell>{e.fullName}</TableCell>
                    <TableCell>{e.email}</TableCell>
                    <TableCell>{ROLE_LABELS[e.role]}</TableCell>
                    <TableCell>{e.team?.name ?? '—'}</TableCell>
                    <TableCell>{e.teamLead?.fullName ?? '—'}</TableCell>
                    <TableCell>
                      {e.projects.length ? e.projects.map((p) => p.name).join(', ') : '—'}
                    </TableCell>
                    <TableCell>{e.vendor?.name ?? 'In-house'}</TableCell>
                    <TableCell>{e.loginName ?? '—'}</TableCell>
                    <TableCell>
                      <EmployeeStatusChip status={e.status} />
                    </TableCell>
                    <TableCell>{formatDate(e.createdAt)}</TableCell>
                    <TableCell>{formatDate(e.activatedAt)}</TableCell>
                    <TableCell padding="checkbox">
                      <IconButton
                        aria-label={`Actions for ${e.fullName}`}
                        onClick={(ev) => setMenu({ anchor: ev.currentTarget, employee: e })}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
        />
      </Paper>

      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu && (
          <RowMenu
            employee={menu.employee}
            flags={{ canUpdate, canSend, canDeactivate, canReset, canChangeRole, isManager }}
            onPick={(next) => {
              const employee = menu.employee;
              setMenu(null);
              if (next === 'view' || next === 'role' || next === 'deactivate')
                setDialog({ kind: next, employee });
              if (next === 'activation')
                void act(
                  `Activation link sent to ${employee.email}.`,
                  `/employees/${employee.id}/activation-email`,
                );
              if (next === 'reset')
                void act(
                  `Password reset link sent to ${employee.email}.`,
                  `/employees/${employee.id}/password-reset`,
                );
              if (next === 'reactivate')
                void act(
                  `${employee.fullName} reactivated. Send a fresh activation link so they can set a new password.`,
                  `/employees/${employee.id}/reactivate`,
                );
            }}
          />
        )}
      </Menu>

      {dialog?.kind === 'add' && (
        <AddEmployeeDialog
          options={options}
          allowedRoles={creatableRoles(profile.employee.role)}
          lockedVendorId={profile.employee.vendorId}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'view' && (
        <EmployeeDetailDialog employee={dialog.employee} canEdit={canUpdate} onClose={closeDialog} />
      )}
      {dialog?.kind === 'role' && <RoleChangeDialog employee={dialog.employee} onClose={closeDialog} />}
      {dialog?.kind === 'deactivate' && <DeactivateDialog employee={dialog.employee} onClose={closeDialog} />}
      {dialog?.kind === 'import' && (
        <CsvImportDialog
          title="Import employees"
          columns={EMPLOYEE_CSV_COLUMNS}
          guidance="Every row becomes a pending employee. Do not include passwords or teams — people set their own password from the activation link. Login Names are assigned in Chart Allocation."
          previewPath="/employees/import/preview"
          commitPath="/employees/import/commit"
          doneVerb="created"
          onClose={closeDialog}
          renderResultActions={(result) =>
            result.createdIds.length > 0 && canSend ? (
              <Button
                variant="outlined"
                onClick={async () => {
                  await apiFetch('/employees/activation-emails', {
                    method: 'POST',
                    body: JSON.stringify({ employeeIds: result.createdIds }),
                  });
                  setNotice(`Activation links sent to ${result.createdIds.length} people.`);
                }}
              >
                Send activation links to these {result.createdIds.length} people
              </Button>
            ) : null
          }
        />
      )}
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
      />
    </Box>
  );
}

type RowAction = 'view' | 'activation' | 'reset' | 'role' | 'deactivate' | 'reactivate';

function RowMenu({
  employee,
  flags,
  onPick,
}: {
  employee: EmployeeRecord;
  flags: Record<
    'canUpdate' | 'canSend' | 'canDeactivate' | 'canReset' | 'canChangeRole' | 'isManager',
    boolean
  >;
  onPick: (action: RowAction) => void;
}) {
  const item = (action: RowAction, label: string) => (
    <MenuItem key={action} onClick={() => onPick(action)}>
      {label}
    </MenuItem>
  );
  const items = [item('view', flags.canUpdate ? 'View / edit' : 'View')];
  if (flags.canSend && employee.status === 'PENDING_ACTIVATION')
    items.push(item('activation', 'Send activation link'));
  if (flags.canReset && employee.status === 'ACTIVE') items.push(item('reset', 'Send password reset link'));
  if (flags.canChangeRole) items.push(item('role', 'Change role'));
  if (flags.canDeactivate && employee.status !== 'INACTIVE') items.push(item('deactivate', 'Deactivate'));
  if (flags.canDeactivate && employee.status === 'INACTIVE') items.push(item('reactivate', 'Reactivate'));
  return <>{items}</>;
}
