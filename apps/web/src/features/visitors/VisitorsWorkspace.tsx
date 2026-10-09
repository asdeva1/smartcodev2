'use client';

import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
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
import {
  type EmployeeRecord,
  type Page,
  VISIT_STATUS_LABELS,
  VISIT_STATUSES,
  type VisitBadge,
  type VisitCreate,
  type VisitPage,
  type VisitRecord,
  visitCreateSchema,
} from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction } from '../admin/ui';
import { useResource } from '../projects/shared';

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const TONE = {
  EXPECTED: 'info',
  CHECKED_IN: 'success',
  CHECKED_OUT: 'default',
  CANCELLED: 'default',
} as const;

function RegisterDialog({ onClose }: { onClose: (created: boolean) => void }) {
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [host, setHost] = useState<{ id: string; label: string } | null>(null);
  const [purpose, setPurpose] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [walkIn, setWalkIn] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const people = useResource<Page<EmployeeRecord>>('/employees?pageSize=100&status=ACTIVE');
  const known = useResource<
    { id: string; fullName: string; company: string | null; phone: string | null; email: string | null }[]
  >(fullName.trim().length >= 2 ? `/visitors?q=${encodeURIComponent(fullName.trim())}` : null);
  const hosts = (people.data?.items ?? []).map((p) => ({
    id: p.id,
    label: `${p.fullName} (${p.employeeCode})`,
  }));
  const action = useAction<VisitRecord>(() => onClose(true));

  function submit() {
    const parsed = visitCreateSchema.safeParse({
      fullName,
      company,
      phone,
      email,
      hostId: host?.id,
      purpose,
      expectedAt: !walkIn && expectedAt ? new Date(expectedAt).toISOString() : undefined,
      checkIn: walkIn,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    void action.run(() =>
      apiFetch<VisitRecord>('/visits', {
        method: 'POST',
        body: JSON.stringify(parsed.data satisfies VisitCreate),
      }),
    );
  }

  return (
    <FormDialog
      title="Register a visit"
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel={walkIn ? 'Register and check in' : 'Register visit'}
      busy={action.busy}
      error={action.error}
    >
      <Autocomplete
        freeSolo
        options={known.data ?? []}
        getOptionLabel={(o) =>
          typeof o === 'string' ? o : `${o.fullName}${o.company ? ` · ${o.company}` : ''}`
        }
        inputValue={fullName}
        onInputChange={(_, v) => setFullName(v)}
        onChange={(_, v) => {
          if (v && typeof v !== 'string') {
            setFullName(v.fullName);
            setCompany(v.company ?? '');
            setPhone(v.phone ?? '');
            setEmail(v.email ?? '');
          }
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Visitor name"
            error={Boolean(errors.fullName)}
            helperText={errors.fullName ?? 'Returning visitors appear as you type'}
          />
        )}
      />
      <TextField label="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
      <TextField
        label="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={Boolean(errors.phone)}
        helperText={errors.phone}
      />
      <TextField
        label="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={Boolean(errors.email)}
        helperText={errors.email}
      />
      <Autocomplete
        options={hosts}
        value={host}
        onChange={(_, v) => setHost(v)}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Who are they visiting?"
            error={Boolean(errors.hostId)}
            helperText={errors.hostId}
          />
        )}
      />
      <TextField
        label="Purpose of the visit"
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        error={Boolean(errors.purpose)}
        helperText={errors.purpose}
      />
      <FormControlLabel
        control={<Checkbox checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />}
        label="The visitor is here now (check in and issue a badge)"
      />
      {!walkIn && (
        <TextField
          type="datetime-local"
          label="Expected at (optional)"
          value={expectedAt}
          onChange={(e) => setExpectedAt(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )}
    </FormDialog>
  );
}

function BadgeDialog({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const badge = useResource<VisitBadge>(`/visits/${visitId}/badge`);
  const b = badge.data;
  return (
    <FormDialog title="Visitor badge" onClose={onClose} hideSubmit>
      {badge.error && <Alert severity="error">{badge.error}</Alert>}
      {b && (
        <>
          <Box
            id="visitor-badge"
            sx={{
              border: '2px solid',
              borderColor: 'primary.main',
              borderRadius: 2,
              p: 3,
              textAlign: 'center',
            }}
          >
            <Typography variant="overline">Visitor</Typography>
            <Typography variant="h4" component="p" sx={{ fontWeight: 700 }}>
              {b.visitorName}
            </Typography>
            {b.company && <Typography color="text.secondary">{b.company}</Typography>}
            <Typography sx={{ mt: 1 }}>Visiting {b.hostName}</Typography>
            <Typography variant="h6" component="p" sx={{ mt: 1, fontFamily: 'monospace' }}>
              {b.badgeNumber}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {b.date}
            </Typography>
          </Box>
          <Button variant="outlined" onClick={() => window.print()}>
            Print badge
          </Button>
        </>
      )}
    </FormDialog>
  );
}

function Visitors() {
  const { profile, signOut } = useSession();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [registering, setRegistering] = useState(false);
  const [badgeFor, setBadgeFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams({ pageSize: '50' });
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  if (date) params.set('date', date);
  const list = useResource<VisitPage>(`/visits?${params.toString()}`);
  const data = list.data;

  async function act(id: string, what: 'check-in' | 'check-out' | 'cancel') {
    setError(null);
    try {
      await apiFetch(`/visits/${id}/${what}`, { method: 'POST', body: what === 'cancel' ? '{}' : undefined });
      list.refresh();
      if (what === 'check-in') setBadgeFor(id);
    } catch (e) {
      setError(problemText(e, 'That could not be done.'));
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Visitors"
      currentPath="/visitors"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="h6" component="p">
            In the office now: <strong>{data?.insideNow ?? '—'}</strong>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" onClick={() => setRegistering(true)}>
            Register a visit
          </Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Search"
            placeholder="Visitor, company, host or badge"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ width: 280 }}
          />
          <TextField
            size="small"
            select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ width: 180 }}
          >
            <MenuItem value="">All</MenuItem>
            {VISIT_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {VISIT_STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Day"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
        {(error ?? list.error) && <Alert severity="error">{error ?? list.error}</Alert>}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No visits found"
            description="Register a visit when someone arrives or is expected."
          />
        )}
        {data && data.items.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Visits">
                <TableHead>
                  <TableRow>
                    <TableCell>Visitor</TableCell>
                    <TableCell>Visiting</TableCell>
                    <TableCell>Purpose</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Badge</TableCell>
                    <TableCell>In</TableCell>
                    <TableCell>Out</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((v) => (
                    <TableRow key={v.id} hover>
                      <TableCell component="th" scope="row">
                        {v.visitor.fullName}
                        {v.visitor.company && (
                          <Typography variant="body2" color="text.secondary">
                            {v.visitor.company}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{v.host.fullName}</TableCell>
                      <TableCell>{v.purpose}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={TONE[v.status]}
                          variant="outlined"
                          label={VISIT_STATUS_LABELS[v.status]}
                        />
                      </TableCell>
                      <TableCell>{v.badgeNumber ?? '—'}</TableCell>
                      <TableCell>{time(v.checkedInAt)}</TableCell>
                      <TableCell>{time(v.checkedOutAt)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {v.status === 'EXPECTED' && (
                          <>
                            <Button size="small" onClick={() => void act(v.id, 'check-in')}>
                              Check in
                            </Button>
                            <Button size="small" color="inherit" onClick={() => void act(v.id, 'cancel')}>
                              Cancel
                            </Button>
                          </>
                        )}
                        {v.status === 'CHECKED_IN' && (
                          <>
                            <Button size="small" onClick={() => setBadgeFor(v.id)}>
                              Badge
                            </Button>
                            <Button size="small" onClick={() => void act(v.id, 'check-out')}>
                              Check out
                            </Button>
                          </>
                        )}
                        {v.status === 'CHECKED_OUT' && (
                          <Button size="small" onClick={() => setBadgeFor(v.id)}>
                            Badge
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}
      </Box>
      {registering && (
        <RegisterDialog
          onClose={(created) => {
            setRegistering(false);
            if (created) list.refresh();
          }}
        />
      )}
      {badgeFor && <BadgeDialog visitId={badgeFor} onClose={() => setBadgeFor(null)} />}
    </AppShell>
  );
}

/** HR and the Manager (`visitor.manage`). */
export function VisitorsWorkspace() {
  return (
    <RequireSession permission="visitor.manage">
      <Visitors />
    </RequireSession>
  );
}
