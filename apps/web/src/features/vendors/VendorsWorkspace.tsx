'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
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
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type VendorRecord, vendorCreateSchema, vendorNameSchema } from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { EmployeeStatusChip } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { ActiveChip, FormDialog, useAction, usePagedList } from '../admin/ui';

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; vendor: VendorRecord }
  | { kind: 'status'; vendor: VendorRecord }
  | null;

function AddVendorDialog({ onClose }: { onClose: (created: string | null) => void }) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    employeeCode: '',
    fullName: '',
    email: '',
    sendActivation: true,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const action = useAction<string>((message) => onClose(message));
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function submit() {
    const parsed = vendorCreateSchema.safeParse({
      code: form.code,
      name: form.name,
      admin: { employeeCode: form.employeeCode, fullName: form.fullName, email: form.email },
      sendActivation: form.sendActivation,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 1 ? String(issue.path[1]) : String(issue.path[0]);
        next[key] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    void action.run(async () => {
      await apiFetch('/vendors', { method: 'POST', body: JSON.stringify(parsed.data) });
      return `${parsed.data.name} was created. ${
        parsed.data.sendActivation
          ? `An activation link was emailed to ${parsed.data.admin.email}.`
          : 'Send the activation link from the Employee directory when ready.'
      }`;
    });
  }

  const field = (key: keyof typeof form, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={form[key] as string}
      onChange={set(key)}
      error={Boolean(fieldErrors[key])}
      helperText={fieldErrors[key]}
      required
      size="small"
      {...extra}
    />
  );

  return (
    <FormDialog
      title="Add vendor"
      onClose={() => onClose(null)}
      onSubmit={submit}
      submitLabel="Create vendor"
      busy={action.busy}
      error={action.error}
    >
      <Typography variant="body2" color="text.secondary">
        A vendor is created together with its Vendor Admin. The Vendor Admin sets their own password from the
        activation email — you never see it.
      </Typography>
      {field('name', 'Vendor name')}
      {field('code', 'Vendor code', {
        helperText: fieldErrors.code ?? 'Short and unique, for example VND01',
      })}
      <Typography variant="subtitle2" sx={{ mt: 1 }}>
        Vendor Admin
      </Typography>
      {field('employeeCode', 'Employee ID')}
      {field('fullName', 'Full name')}
      {field('email', 'Email', { type: 'email' })}
      <FormControlLabel
        control={
          <Checkbox
            checked={form.sendActivation}
            onChange={(e) => setForm((f) => ({ ...f, sendActivation: e.target.checked }))}
          />
        }
        label="Email the activation link now"
      />
    </FormDialog>
  );
}

function RenameDialog({ vendor, onClose }: { vendor: VendorRecord; onClose: (done: boolean) => void }) {
  const [name, setName] = useState(vendor.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useAction(() => onClose(true));
  return (
    <FormDialog
      title="Rename vendor"
      onClose={() => onClose(false)}
      onSubmit={() => {
        const parsed = vendorNameSchema.safeParse(name);
        if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Enter a name');
        setFieldError(null);
        void action.run(() =>
          apiFetch(`/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify({ name: parsed.data }) }),
        );
      }}
      busy={action.busy}
      error={action.error}
    >
      <TextField
        label="Vendor name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(fieldError)}
        helperText={fieldError}
        size="small"
        autoFocus
      />
    </FormDialog>
  );
}

function StatusDialog({ vendor, onClose }: { vendor: VendorRecord; onClose: (done: boolean) => void }) {
  const deactivating = vendor.status === 'ACTIVE';
  const action = useAction(() => onClose(true));
  return (
    <FormDialog
      title={deactivating ? 'Deactivate vendor' : 'Reactivate vendor'}
      onClose={() => onClose(false)}
      onSubmit={() =>
        void action.run(() =>
          apiFetch(`/vendors/${vendor.id}/${deactivating ? 'deactivate' : 'reactivate'}`, { method: 'POST' }),
        )
      }
      submitLabel={deactivating ? 'Deactivate' : 'Reactivate'}
      submitColor={deactivating ? 'error' : 'primary'}
      busy={action.busy}
      error={action.error}
    >
      <Typography>
        {deactivating
          ? `${vendor.name} will be marked inactive. A vendor can only be deactivated once all of its employees are inactive.`
          : `${vendor.name} will be active again and can have employees and teams added.`}
      </Typography>
    </FormDialog>
  );
}

function Vendors() {
  const { profile, can, signOut } = useSession();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const list = usePagedList<VendorRecord>('/vendors', {
    page: page + 1,
    pageSize,
    q: q || undefined,
    status: status || undefined,
  });
  const manage = can('vendor.manage');

  return (
    <AppShell
      role={profile.employee.role}
      title="Vendors"
      currentPath="/manager/vendors"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search name or code"
            fullWidth={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 260 }}
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
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="INACTIVE">Inactive</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          {manage && (
            <Button variant="contained" onClick={() => setDialog({ kind: 'add' })}>
              Add vendor
            </Button>
          )}
        </Box>

        <Paper variant="outlined">
          {list.error ? (
            <Box role="alert" sx={{ p: 3 }}>
              {list.error}
            </Box>
          ) : list.data && list.data.total === 0 ? (
            <EmptyState
              title="No vendors yet"
              description="Add a vendor and its Vendor Admin. The admin then manages their own employees and teams."
              action={
                manage ? (
                  <Button variant="contained" onClick={() => setDialog({ kind: 'add' })}>
                    Add vendor
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TableContainer>
                <Table size="small" aria-label="Vendors">
                  <TableHead>
                    <TableRow>
                      <TableCell>Vendor</TableCell>
                      <TableCell>Code</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Vendor Admin</TableCell>
                      <TableCell align="right">Employees</TableCell>
                      <TableCell align="right">Teams</TableCell>
                      {manage && <TableCell align="right">Actions</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(list.data?.items ?? []).map((v) => (
                      <TableRow key={v.id} hover>
                        <TableCell>{v.name}</TableCell>
                        <TableCell>{v.code}</TableCell>
                        <TableCell>
                          <ActiveChip status={v.status} />
                        </TableCell>
                        <TableCell>
                          {v.admins.length === 0
                            ? '—'
                            : v.admins.map((a) => (
                                <Box key={a.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                  <span>
                                    {a.fullName} ({a.email})
                                  </span>
                                  <EmployeeStatusChip status={a.status} />
                                </Box>
                              ))}
                        </TableCell>
                        <TableCell align="right">{v.employeeCount}</TableCell>
                        <TableCell align="right">{v.teamCount}</TableCell>
                        {manage && (
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            <Button size="small" onClick={() => setDialog({ kind: 'rename', vendor: v })}>
                              Rename
                            </Button>
                            <Button
                              size="small"
                              color={v.status === 'ACTIVE' ? 'error' : 'primary'}
                              onClick={() => setDialog({ kind: 'status', vendor: v })}
                            >
                              {v.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </TableCell>
                        )}
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
                rowsPerPageOptions={[10, 25, 50]}
              />
            </>
          )}
        </Paper>
      </Box>

      {dialog?.kind === 'add' && (
        <AddVendorDialog
          onClose={(message) => {
            setDialog(null);
            if (message) {
              setToast(message);
              list.refresh();
            }
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDialog
          vendor={dialog.vendor}
          onClose={(done) => {
            setDialog(null);
            if (done) {
              setToast('Vendor renamed.');
              list.refresh();
            }
          }}
        />
      )}
      {dialog?.kind === 'status' && (
        <StatusDialog
          vendor={dialog.vendor}
          onClose={(done) => {
            setDialog(null);
            if (done) {
              setToast('Vendor updated.');
              list.refresh();
            }
          }}
        />
      )}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

/** Vendor management. The API enforces `vendor.read` / `vendor.manage`; a Vendor Admin sees only their own vendor. */
export function VendorsWorkspace() {
  return (
    <RequireSession permission="vendor.read">
      <Vendors />
    </RequireSession>
  );
}
