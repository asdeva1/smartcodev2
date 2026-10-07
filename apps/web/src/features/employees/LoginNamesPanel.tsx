'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
  type EmployeeRecord,
  LOGIN_NAME_CSV_COLUMNS,
  LOGIN_NAME_ELIGIBLE_ROLES,
  type Page,
  ROLE_LABELS,
} from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { apiFetch } from '@/lib/api';
import { CsvImportDialog } from './CsvImportDialog';
import { EmployeeStatusChip, problemText, toQuery } from './common';
import { LoginNameDialog } from './EmployeeDialogs';

/**
 * Manager-only Login Name administration. Lists the people who can hold a Login Name (eligible roles) with their
 * current one; the Manager assigns or changes it per person or in bulk from a CSV.
 */
export function LoginNamesPanel() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<EmployeeRecord> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmployeeRecord | null>(null);
  const [importing, setImporting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      // Roles that never hold a Login Name are not listed; one request per eligible role keeps paging exact.
      const roles = role ? [role] : LOGIN_NAME_ELIGIBLE_ROLES;
      Promise.all(
        roles.map((r) =>
          apiFetch<Page<EmployeeRecord>>(
            `/employees${toQuery({ q, role: r, status, pageSize: 100, sort: 'fullName', direction: 'asc' })}`,
          ),
        ),
      )
        .then((pages) => {
          if (!live) return;
          const items = pages.flatMap((p) => p.items).sort((a, b) => a.fullName.localeCompare(b.fullName));
          setData({ items, page: 1, pageSize: items.length, total: items.length });
          setError(null);
        })
        .catch((e: unknown) => live && setError(problemText(e, 'Login Names could not be loaded.')));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, role, status, reload]);

  const all = data?.items ?? [];
  const rows = all.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          label="Search"
          placeholder="Name, email, Employee ID, Login Name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 280, flex: 1 }}
        />
        <TextField
          select
          size="small"
          label="Role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All eligible roles</MenuItem>
          {LOGIN_NAME_ELIGIBLE_ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 170 }}
        >
          <MenuItem value="ACTIVE">Active</MenuItem>
          <MenuItem value="PENDING_ACTIVATION">Pending activation</MenuItem>
          <MenuItem value="INACTIVE">Inactive</MenuItem>
        </TextField>
        <Button variant="contained" onClick={() => setImporting(true)} sx={{ ml: 'auto' }}>
          Import CSV
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary">
        Login Names go to active Coders, Auditors, Team Leads and Group Coaches. Managers, HR and Vendor
        Admins do not use one.
      </Typography>
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      <Paper variant="outlined">
        {data && all.length === 0 ? (
          <EmptyState
            title="No one to show"
            description="Only active people in a Login Name role can be assigned one. Activate employees first, or change the filters."
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Login Names">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Current Login Name</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell>
                      {e.fullName}
                      <Typography variant="caption" color="text.secondary" component="div">
                        {e.employeeCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{e.email}</TableCell>
                    <TableCell>{ROLE_LABELS[e.role]}</TableCell>
                    <TableCell>
                      <EmployeeStatusChip status={e.status} />
                    </TableCell>
                    <TableCell>{e.loginName ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        disabled={e.status !== 'ACTIVE'}
                        onClick={() => setEditing(e)}
                        aria-label={`${e.loginName ? 'Change' : 'Assign'} Login Name for ${e.fullName}`}
                      >
                        {e.loginName ? 'Change' : 'Assign'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <TablePagination
          component="div"
          count={all.length}
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

      {editing && (
        <LoginNameDialog
          employee={editing}
          onClose={(changed) => {
            setEditing(null);
            if (changed) setReload((n) => n + 1);
          }}
        />
      )}
      {importing && (
        <CsvImportDialog
          title="Import Login Names"
          columns={LOGIN_NAME_CSV_COLUMNS}
          guidance="Each row assigns a Login Name to an active employee in an eligible role. Rows are flagged when the email is unknown, the employee is pending or inactive, the role is not eligible, or a Login Name or employee appears twice."
          previewPath="/login-names/import/preview"
          commitPath="/login-names/import/commit"
          doneVerb="assigned"
          onClose={(changed) => {
            setImporting(false);
            if (changed) setReload((n) => n + 1);
          }}
        />
      )}
    </Box>
  );
}
