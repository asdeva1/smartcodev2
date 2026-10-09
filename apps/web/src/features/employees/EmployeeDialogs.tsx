'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  type EmployeeRecord,
  type EmployeeTimelineEntry,
  ROLES,
  ROLE_LABELS,
  type Role,
  employeeCreateSchema,
  isLoginNameEligibleRole,
} from '@smartcode/shared';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { type DirectoryOptions, EmployeeStatusChip, formatDate, problemText } from './common';

const ORG_WIDE: Role[] = ['MANAGER', 'HR', 'GROUP_COACH'];

function FormDialog({
  title,
  onClose,
  onSubmit,
  submitLabel,
  busy,
  error,
  children,
  submitColor,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  children: ReactNode;
  submitColor?: 'primary' | 'error';
}) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="dlg-title">
      <Box component="form" noValidate onSubmit={onSubmit}>
        <DialogTitle id="dlg-title">{title}</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          {children}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" color={submitColor ?? 'primary'} disabled={busy}>
            {busy ? 'Working…' : submitLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Runs an API call with shared busy/error handling and closes on success. */
function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

// ───────── Add employee ─────────

export function AddEmployeeDialog({
  options,
  allowedRoles,
  lockedVendorId,
  onClose,
}: {
  options: DirectoryOptions;
  allowedRoles: readonly Role[];
  /** A Vendor Admin always creates inside their own vendor. */
  lockedVendorId: string | null;
  onClose: (created: boolean) => void;
}) {
  const [form, setForm] = useState({
    employeeCode: '',
    fullName: '',
    email: '',
    role: '' as Role | '',
    vendorId: lockedVendorId ?? '',
    teamId: '',
    sendActivation: true,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const action = useAction(() => onClose(true));
  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));
  const roleHasVendor = form.role !== '' && !ORG_WIDE.includes(form.role);
  const teams = options.teams.filter((t) => (t.vendorId ?? '') === (roleHasVendor ? form.vendorId : ''));

  function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = {
      employeeCode: form.employeeCode,
      fullName: form.fullName,
      email: form.email,
      role: form.role || undefined,
      ...(roleHasVendor && form.vendorId ? { vendorId: form.vendorId } : {}),
      ...(form.teamId ? { teamId: form.teamId } : {}),
      sendActivation: form.sendActivation,
    };
    const parsed = employeeCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!errors[key]) errors[key] = key === 'role' ? 'Choose a role' : issue.message;
      }
      return setFieldErrors(errors);
    }
    if (parsed.data.role === 'VENDOR_ADMIN' && !parsed.data.vendorId)
      return setFieldErrors({ vendorId: 'A Vendor Admin must belong to a vendor' });
    setFieldErrors({});
    void action.run(() => apiFetch('/employees', { method: 'POST', body: JSON.stringify(parsed.data) }));
  }

  return (
    <FormDialog
      title="Add employee"
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Add employee"
      busy={action.busy}
      error={action.error}
    >
      <Typography variant="body2" color="text.secondary">
        The employee chooses their own password from the activation link. You never see it, and Login Names
        are assigned separately once the account is active.
      </Typography>
      <TextField
        label="Employee ID"
        value={form.employeeCode}
        onChange={(e) => set('employeeCode', e.target.value)}
        error={Boolean(fieldErrors.employeeCode)}
        helperText={fieldErrors.employeeCode}
        autoFocus
        required
      />
      <TextField
        label="Employee name"
        value={form.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        error={Boolean(fieldErrors.fullName)}
        helperText={fieldErrors.fullName}
        required
      />
      <TextField
        label="Work email"
        type="email"
        value={form.email}
        onChange={(e) => set('email', e.target.value)}
        error={Boolean(fieldErrors.email)}
        helperText={fieldErrors.email}
        required
      />
      <TextField
        select
        label="Role"
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role, teamId: '' }))}
        error={Boolean(fieldErrors.role)}
        helperText={fieldErrors.role}
        required
      >
        {ROLES.filter((r) => allowedRoles.includes(r)).map((r) => (
          <MenuItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </MenuItem>
        ))}
      </TextField>
      {roleHasVendor && (
        <TextField
          select
          label="Vendor"
          value={form.vendorId}
          onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value, teamId: '' }))}
          disabled={lockedVendorId !== null}
          error={Boolean(fieldErrors.vendorId)}
          helperText={
            fieldErrors.vendorId ??
            (form.role === 'VENDOR_ADMIN' ? 'Required for a Vendor Admin' : 'Leave empty for in-house staff')
          }
        >
          {lockedVendorId === null && <MenuItem value="">In-house (no vendor)</MenuItem>}
          {options.vendors.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      {roleHasVendor && teams.length > 0 && (
        <TextField
          select
          label="Team (optional)"
          value={form.teamId}
          onChange={(e) => set('teamId', e.target.value)}
        >
          <MenuItem value="">No team</MenuItem>
          {teams.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <FormControlLabel
        control={
          <Checkbox checked={form.sendActivation} onChange={(e) => set('sendActivation', e.target.checked)} />
        }
        label="Email the activation link now"
      />
    </FormDialog>
  );
}

// ───────── View / edit ─────────

const ACTION_LABELS: Record<string, string> = {
  'EMPLOYEE.CREATED': 'Account created',
  'EMPLOYEE.UPDATED': 'Details changed',
  'EMPLOYEE.ACTIVATION_SENT': 'Activation link sent',
  'EMPLOYEE.DEACTIVATED': 'Deactivated',
  'EMPLOYEE.REACTIVATED': 'Reactivated',
  'EMPLOYEE.ROLE_CHANGED': 'Role changed',
  'EMPLOYEE.PASSWORD_RESET_TRIGGERED': 'Password reset link sent',
  'EMPLOYEE.ACTIVATED': 'Account activated',
  'EMPLOYEE.IMPORTED': 'Imported from a file',
};
const actionLabel = (a: string) =>
  ACTION_LABELS[a] ??
  a
    .replace(/^EMPLOYEE\./, '')
    .toLowerCase()
    .replaceAll('_', ' ');

function EmployeeTimeline({ employeeId }: { employeeId: string }) {
  const [entries, setEntries] = useState<EmployeeTimelineEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<EmployeeTimelineEntry[]>(`/employees/${employeeId}/timeline`)
      .then((d) => live && setEntries(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [employeeId]);
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        History
      </Typography>
      {failed && <Typography color="text.secondary">The history could not be loaded.</Typography>}
      {entries && entries.length === 0 && <Typography color="text.secondary">No history yet.</Typography>}
      {entries && entries.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5, maxHeight: 220, overflow: 'auto' }}>
          {entries.map((e) => (
            <li key={e.id}>
              <Typography variant="body2">
                {actionLabel(e.action)}
                {e.actor ? ` by ${e.actor.fullName}` : ''} ·{' '}
                {new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </Typography>
            </li>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function EmployeeDetailDialog({
  employee,
  canEdit,
  onClose,
}: {
  employee: EmployeeRecord;
  canEdit: boolean;
  onClose: (changed: boolean) => void;
}) {
  const pending = employee.status === 'PENDING_ACTIVATION';
  const [name, setName] = useState(employee.fullName);
  const [email, setEmail] = useState(employee.email);
  const action = useAction(() => onClose(true));

  function submit(event: FormEvent) {
    event.preventDefault();
    const body: Record<string, string> = {};
    if (name.trim() !== employee.fullName) body.fullName = name.trim();
    if (pending && email.trim() !== employee.email) body.email = email.trim();
    if (Object.keys(body).length === 0) return onClose(false);
    void action.run(() =>
      apiFetch(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    );
  }

  const rows: [string, ReactNode][] = [
    ['Employee ID', employee.employeeCode],
    ['Role', ROLE_LABELS[employee.role]],
    ['Status', <EmployeeStatusChip key="s" status={employee.status} />],
    ['Vendor', employee.vendor?.name ?? 'In-house'],
    ['Team', employee.team?.name ?? '—'],
    ['Team Lead', employee.teamLead?.fullName ?? '—'],
    ['Projects', employee.projects.length ? employee.projects.map((p) => p.name).join(', ') : '—'],
    ['Created', formatDate(employee.createdAt)],
    ['Activated', formatDate(employee.activatedAt)],
  ];

  return (
    <FormDialog
      title={employee.fullName}
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Save changes"
      busy={action.busy}
      error={action.error}
    >
      {canEdit ? (
        <>
          <TextField label="Employee name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Work email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!pending}
            helperText={
              pending
                ? 'Can be corrected until the account is activated.'
                : 'Email is the sign-in identity once active and cannot be edited.'
            }
          />
        </>
      ) : (
        <Typography>{employee.email}</Typography>
      )}
      <Box
        component="dl"
        sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 1, m: 0 }}
      >
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" color="text.secondary">
              {label}
            </Typography>
            <Typography component="dd" sx={{ m: 0 }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
      <EmployeeTimeline employeeId={employee.id} />
    </FormDialog>
  );
}

// ───────── Role change ─────────

export function RoleChangeDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRecord;
  onClose: (changed: boolean) => void;
}) {
  const [role, setRole] = useState<Role | ''>('');
  const [reason, setReason] = useState('');
  const action = useAction(() => onClose(true));
  const losesLoginName = role !== '' && employee.loginName !== null && !isLoginNameEligibleRole(role);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!role) return action.setError('Choose the new role.');
    if (reason.trim().length < 3) return action.setError('Give a reason for the change.');
    void action.run(() =>
      apiFetch(`/employees/${employee.id}/role`, {
        method: 'POST',
        body: JSON.stringify({ role, reason: reason.trim() }),
      }),
    );
  }

  return (
    <FormDialog
      title={`Change role for ${employee.fullName}`}
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Change role"
      busy={action.busy}
      error={action.error}
    >
      <Typography variant="body2" color="text.secondary">
        Currently {ROLE_LABELS[employee.role]}. The change applies on their next request and is recorded in
        the audit log.
      </Typography>
      <TextField
        select
        label="New role"
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        required
      >
        {ROLES.filter((r) => r !== employee.role).map((r) => (
          <MenuItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </MenuItem>
        ))}
      </TextField>
      {losesLoginName && (
        <Alert severity="warning">
          {ROLE_LABELS[role as Role]} does not use a Login Name. {employee.loginName} will be ended (kept in
          the history) and can be assigned to someone else.
        </Alert>
      )}
      <TextField
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        multiline
        minRows={2}
        required
      />
    </FormDialog>
  );
}

// ───────── Deactivate ─────────

export function DeactivateDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRecord;
  onClose: (changed: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmOpenWork, setConfirmOpenWork] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const action = useAction(() => onClose(true));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) return action.setError('Give a reason.');
    void action.run(async () => {
      try {
        await apiFetch(`/employees/${employee.id}/deactivate`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim(), confirmOpenWork }),
        });
      } catch (e) {
        const message = problemText(e);
        if (/allocated|rework|open work/i.test(message)) setNeedsConfirm(true);
        throw e;
      }
    });
  }

  return (
    <FormDialog
      title={`Deactivate ${employee.fullName}?`}
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Deactivate"
      submitColor="error"
      busy={action.busy}
      error={action.error}
    >
      <Typography variant="body2" color="text.secondary">
        They are signed out everywhere at once and cannot sign in again. Their history is kept, and any Login
        Name is released.
      </Typography>
      <TextField
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        multiline
        minRows={2}
        required
        autoFocus
      />
      {needsConfirm && (
        <FormControlLabel
          control={
            <Checkbox checked={confirmOpenWork} onChange={(e) => setConfirmOpenWork(e.target.checked)} />
          }
          label="I understand they still hold open work"
        />
      )}
    </FormDialog>
  );
}
