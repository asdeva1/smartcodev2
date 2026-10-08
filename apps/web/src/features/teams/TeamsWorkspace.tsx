'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
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
import {
  type EmployeeRecord,
  ROLE_LABELS,
  type Role,
  type TeamDetail,
  type TeamRecord,
  type VendorRecord,
  teamCreateSchema,
  teamNameSchema,
} from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { EmployeeStatusChip, problemText, toQuery } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { ActiveChip, FormDialog, type PageResult, useAction, usePagedList } from '../admin/ui';

const IN_HOUSE = 'in-house';

/** Active people the caller may see, optionally limited to one role and to one vendor (or in-house only). */
function useEmployeeChoices(vendorId: string | null | undefined, role?: Role) {
  const [people, setPeople] = useState<EmployeeRecord[]>([]);
  useEffect(() => {
    if (vendorId === undefined) return;
    let cancelled = false;
    apiFetch<PageResult<EmployeeRecord>>(
      `/employees${toQuery({ pageSize: 100, role, vendorId: vendorId ?? undefined, sort: 'fullName', direction: 'asc' })}`,
    )
      .then((r) => {
        if (!cancelled)
          setPeople(r.items.filter((e) => e.status !== 'INACTIVE' && (e.vendor?.id ?? null) === vendorId));
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [vendorId, role]);
  return people;
}

function useVendorChoices(enabled: boolean) {
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  useEffect(() => {
    if (!enabled) return;
    apiFetch<PageResult<VendorRecord>>(`/vendors${toQuery({ pageSize: 100, status: 'ACTIVE' })}`)
      .then((r) => setVendors(r.items))
      .catch(() => setVendors([]));
  }, [enabled]);
  return vendors;
}

function AddTeamDialog({
  ownVendorId,
  canPickVendor,
  onClose,
}: {
  ownVendorId: string | null;
  canPickVendor: boolean;
  onClose: (done: boolean) => void;
}) {
  const vendors = useVendorChoices(canPickVendor);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState<string>(canPickVendor ? IN_HOUSE : (ownVendorId ?? IN_HOUSE));
  const [lead, setLead] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const leads = useEmployeeChoices(vendor === IN_HOUSE ? null : vendor, 'TEAM_LEAD');
  const action = useAction(() => onClose(true));

  return (
    <FormDialog
      title="Add team"
      onClose={() => onClose(false)}
      submitLabel="Create team"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        const parsed = teamCreateSchema.safeParse({
          name,
          ...(canPickVendor && vendor !== IN_HOUSE ? { vendorId: vendor } : {}),
          ...(lead ? { teamLeadId: lead } : {}),
        });
        if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? 'Check the form');
        setFieldError(null);
        void action.run(() => apiFetch('/teams', { method: 'POST', body: JSON.stringify(parsed.data) }));
      }}
    >
      <TextField
        label="Team name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(fieldError)}
        helperText={fieldError}
        size="small"
        required
        autoFocus
      />
      {canPickVendor && (
        <TextField
          select
          size="small"
          label="Belongs to"
          value={vendor}
          onChange={(e) => {
            setVendor(e.target.value);
            setLead('');
          }}
        >
          <MenuItem value={IN_HOUSE}>In-house (SmartClues)</MenuItem>
          {vendors.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label="Team Lead (optional)"
        value={lead}
        onChange={(e) => setLead(e.target.value)}
        helperText={
          leads.length === 0 ? 'No Team Leads are available here yet. You can set one later.' : undefined
        }
      >
        <MenuItem value="">None</MenuItem>
        {leads.map((l) => (
          <MenuItem key={l.id} value={l.id}>
            {l.fullName} ({l.employeeCode})
          </MenuItem>
        ))}
      </TextField>
    </FormDialog>
  );
}

function TeamDetailDialog({
  teamId,
  canManage,
  onClose,
}: {
  teamId: string;
  canManage: boolean;
  onClose: (changed: boolean) => void;
}) {
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [addId, setAddId] = useState('');
  const vendorId = team ? (team.vendor?.id ?? null) : undefined;
  const leads = useEmployeeChoices(vendorId, 'TEAM_LEAD');
  const everyone = useEmployeeChoices(canManage ? vendorId : undefined);
  const action = useAction<TeamDetail | null>((next) => {
    if (next) {
      setTeam(next);
      setName(next.name);
      setChanged(true);
    }
  });

  useEffect(() => {
    apiFetch<TeamDetail>(`/teams/${teamId}`)
      .then((t) => {
        setTeam(t);
        setName(t.name);
      })
      .catch((e: unknown) => setLoadError(problemText(e, 'The team could not be loaded.')));
  }, [teamId]);

  const memberIds = new Set((team?.members ?? []).map((m) => m.id));
  const candidates = everyone.filter((e) => !memberIds.has(e.id));
  const call = (path: string, init: RequestInit) => () =>
    apiFetch<TeamDetail>(`/teams/${teamId}${path}`, init);

  return (
    <FormDialog
      title={team ? team.name : 'Team'}
      onClose={() => onClose(changed)}
      hideSubmit
      maxWidth="md"
      error={loadError ?? action.error}
    >
      {!team ? (
        !loadError && <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <ActiveChip status={team.status} />
            <Typography variant="body2" color="text.secondary">
              {team.vendor ? `Vendor: ${team.vendor.name}` : 'In-house team'} · {team.memberCount} member
              {team.memberCount === 1 ? '' : 's'}
            </Typography>
          </Box>

          {canManage && team.status === 'ACTIVE' && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  label="Team name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={Boolean(nameError)}
                  helperText={nameError}
                  sx={{ flex: 1 }}
                />
                <Button
                  disabled={action.busy || name === team.name}
                  onClick={() => {
                    const parsed = teamNameSchema.safeParse(name);
                    if (!parsed.success)
                      return setNameError(parsed.error.issues[0]?.message ?? 'Enter a name');
                    setNameError(null);
                    void action.run(
                      call('', { method: 'PATCH', body: JSON.stringify({ name: parsed.data }) }),
                    );
                  }}
                >
                  Rename
                </Button>
              </Box>
              <TextField
                select
                size="small"
                label="Team Lead"
                value={team.teamLead?.id ?? ''}
                disabled={action.busy}
                onChange={(e) =>
                  void action.run(
                    call('', {
                      method: 'PATCH',
                      body: JSON.stringify({ teamLeadId: e.target.value || null }),
                    }),
                  )
                }
              >
                <MenuItem value="">No Team Lead</MenuItem>
                {team.teamLead && !leads.some((l) => l.id === team.teamLead?.id) && (
                  <MenuItem value={team.teamLead.id}>{team.teamLead.fullName}</MenuItem>
                )}
                {leads.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.fullName} ({l.employeeCode})
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          {!canManage && (
            <Typography variant="body2">
              Team Lead: {team.teamLead ? team.teamLead.fullName : 'Not assigned'}
            </Typography>
          )}

          <Divider />
          <Typography variant="subtitle2">Members</Typography>
          {team.members.length === 0 ? (
            <Typography color="text.secondary">No members yet.</Typography>
          ) : (
            <Table size="small" aria-label="Team members">
              <TableHead>
                <TableRow>
                  <TableCell>Employee ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  {canManage && <TableCell align="right" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {team.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.employeeCode}</TableCell>
                    <TableCell>{m.fullName}</TableCell>
                    <TableCell>{ROLE_LABELS[m.role as Role] ?? m.role}</TableCell>
                    <TableCell>
                      <EmployeeStatusChip status={m.status} />
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          aria-label={`Remove ${m.fullName} from the team`}
                          disabled={action.busy}
                          onClick={() => void action.run(call(`/members/${m.id}`, { method: 'DELETE' }))}
                        >
                          ✕
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {canManage && team.status === 'ACTIVE' && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                select
                size="small"
                label="Add a member"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                sx={{ flex: 1 }}
                helperText={
                  candidates.length === 0
                    ? 'Everyone in this vendor scope is already in the team.'
                    : 'An employee already in another team moves to this one.'
                }
              >
                {candidates.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.fullName} · {ROLE_LABELS[c.role]} ({c.employeeCode})
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="outlined"
                disabled={!addId || action.busy}
                onClick={() => {
                  const employeeId = addId;
                  setAddId('');
                  void action.run(call('/members', { method: 'POST', body: JSON.stringify({ employeeId }) }));
                }}
              >
                Add
              </Button>
            </Box>
          )}

          {canManage && (
            <Box>
              <Divider sx={{ mb: 2 }} />
              {team.status === 'ACTIVE' ? (
                <Button
                  color="error"
                  disabled={action.busy}
                  onClick={() => void action.run(call('/deactivate', { method: 'POST' }))}
                >
                  Deactivate team
                </Button>
              ) : (
                <Button
                  disabled={action.busy}
                  onClick={() => void action.run(call('/reactivate', { method: 'POST' }))}
                >
                  Reactivate team
                </Button>
              )}
            </Box>
          )}
        </>
      )}
    </FormDialog>
  );
}

function Teams() {
  const { profile, can, signOut } = useSession();
  const manage = can('team.manage');
  const isOrgWide = profile.employee.vendorId === null;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const vendors = useVendorChoices(can('vendor.manage'));
  const list = usePagedList<TeamRecord>('/teams', {
    page: page + 1,
    pageSize,
    q: q || undefined,
    status: status || undefined,
    vendorId: vendorId || undefined,
  });

  return (
    <AppShell
      role={profile.employee.role}
      title="Teams"
      currentPath="/manager/teams"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search team name"
            fullWidth={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 240 }}
          />
          {can('vendor.manage') && (
            <TextField
              size="small"
              select
              label="Vendor"
              fullWidth={false}
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                setPage(0);
              }}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All</MenuItem>
              {vendors.map((v) => (
                <MenuItem key={v.id} value={v.id}>
                  {v.name}
                </MenuItem>
              ))}
            </TextField>
          )}
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
            <Button variant="contained" onClick={() => setAdding(true)}>
              Add team
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
              title="No teams yet"
              description="Create a team, choose its Team Lead and add the coders and auditors who work under them."
              action={
                manage ? (
                  <Button variant="contained" onClick={() => setAdding(true)}>
                    Add team
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TableContainer>
                <Table size="small" aria-label="Teams">
                  <TableHead>
                    <TableRow>
                      <TableCell>Team</TableCell>
                      <TableCell>Vendor</TableCell>
                      <TableCell>Team Lead</TableCell>
                      <TableCell align="right">Members</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(list.data?.items ?? []).map((t) => (
                      <TableRow key={t.id} hover>
                        <TableCell>{t.name}</TableCell>
                        <TableCell>{t.vendor?.name ?? 'In-house'}</TableCell>
                        <TableCell>{t.teamLead?.fullName ?? '—'}</TableCell>
                        <TableCell align="right">{t.memberCount}</TableCell>
                        <TableCell>
                          <ActiveChip status={t.status} />
                        </TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => setOpenId(t.id)}>
                            {manage ? 'Manage' : 'View'}
                          </Button>
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
                rowsPerPageOptions={[10, 25, 50]}
              />
            </>
          )}
        </Paper>
      </Box>

      {adding && (
        <AddTeamDialog
          ownVendorId={profile.employee.vendorId}
          canPickVendor={isOrgWide && can('vendor.manage')}
          onClose={(done) => {
            setAdding(false);
            if (done) {
              setToast('Team created.');
              list.refresh();
            }
          }}
        />
      )}
      {openId && (
        <TeamDetailDialog
          teamId={openId}
          canManage={manage}
          onClose={(changed) => {
            setOpenId(null);
            if (changed) list.refresh();
          }}
        />
      )}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

/** Team management. Managers see every team; a Vendor Admin sees and manages only their vendor's teams. */
export function TeamsWorkspace() {
  return (
    <RequireSession permission="team.read" broader>
      <Teams />
    </RequireSession>
  );
}
