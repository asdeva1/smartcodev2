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
  APPROVAL_STATUSES,
  APPROVAL_TYPE_LABELS,
  APPROVAL_TYPES,
  type ApprovalCreate,
  type ApprovalPage,
  type ApprovalRecord,
  type ApprovalType,
  approvalCreateSchema,
  type EmployeeRecord,
  type Page,
  type ProjectListRecord,
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

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error', CANCELLED: 'default' } as const;
const STATUS_LABEL = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
} as const;

function RequestDialog({
  allowed,
  onClose,
}: {
  allowed: ApprovalType[];
  onClose: (created: boolean) => void;
}) {
  const [type, setType] = useState<ApprovalType | ''>(allowed[0] ?? '');
  const [entity, setEntity] = useState<{ id: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [loginName, setLoginName] = useState('');
  const [comments, setComments] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isProject = type === 'PROJECT_CLOSURE';
  const people = useResource<Page<EmployeeRecord>>(
    type && !isProject ? '/employees?pageSize=100&status=ACTIVE' : null,
  );
  const projects = useResource<Page<ProjectListRecord>>(isProject ? '/projects?pageSize=100' : null);
  const options = isProject
    ? (projects.data?.items ?? []).map((p) => ({ id: p.id, label: `${p.client.name} · ${p.name}` }))
    : (people.data?.items ?? []).map((p) => ({ id: p.id, label: `${p.fullName} (${p.employeeCode})` }));
  const action = useAction<ApprovalRecord>(() => onClose(true));

  function submit() {
    const parsed = approvalCreateSchema.safeParse({
      type: type || undefined,
      entityId: entity?.id,
      ...(type === 'EMPLOYEE_DEACTIVATION' ? { reason } : {}),
      ...(type === 'LOGIN_NAME_CHANGE' ? { loginName } : {}),
      comments,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    void action.run(() =>
      apiFetch<ApprovalRecord>('/approvals', {
        method: 'POST',
        body: JSON.stringify(parsed.data satisfies ApprovalCreate),
      }),
    );
  }

  return (
    <FormDialog
      title="Ask for approval"
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel="Send request"
      busy={action.busy}
      error={action.error}
    >
      <TextField
        select
        label="What do you need?"
        value={type}
        onChange={(e) => {
          setType(e.target.value as ApprovalType);
          setEntity(null);
        }}
        error={Boolean(errors.type)}
        helperText={errors.type}
      >
        {allowed.map((t) => (
          <MenuItem key={t} value={t}>
            {APPROVAL_TYPE_LABELS[t]}
          </MenuItem>
        ))}
      </TextField>
      <Autocomplete
        options={options}
        value={entity}
        onChange={(_, v) => setEntity(v)}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        renderInput={(params) => (
          <TextField
            {...params}
            label={isProject ? 'Project' : 'Employee'}
            error={Boolean(errors.entityId)}
            helperText={errors.entityId}
          />
        )}
      />
      {type === 'EMPLOYEE_DEACTIVATION' && (
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={Boolean(errors.reason)}
          helperText={errors.reason}
        />
      )}
      {type === 'LOGIN_NAME_CHANGE' && (
        <TextField
          label="New client login"
          value={loginName}
          onChange={(e) => setLoginName(e.target.value)}
          error={Boolean(errors.loginName)}
          helperText={errors.loginName}
        />
      )}
      <TextField
        label="Note for the Manager (optional)"
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        multiline
        minRows={2}
      />
    </FormDialog>
  );
}

function DecideDialog({
  request,
  decision,
  onClose,
}: {
  request: ApprovalRecord;
  decision: 'APPROVED' | 'REJECTED';
  onClose: (done: boolean) => void;
}) {
  const [comments, setComments] = useState('');
  const [confirmOpenWork, setConfirmOpenWork] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useAction<ApprovalRecord>(() => onClose(true));
  const reject = decision === 'REJECTED';

  function submit() {
    if (reject && comments.trim().length < 3) {
      setError('Say why you are rejecting this');
      return;
    }
    setError(null);
    void action.run(() =>
      apiFetch<ApprovalRecord>(`/approvals/${request.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, comments: comments.trim() || undefined, confirmOpenWork }),
      }),
    );
  }

  return (
    <FormDialog
      title={reject ? 'Reject request' : 'Approve request'}
      onClose={() => onClose(false)}
      onSubmit={submit}
      submitLabel={reject ? 'Reject' : 'Approve and carry out'}
      submitColor={reject ? 'error' : 'primary'}
      busy={action.busy}
      error={action.error}
    >
      <Typography>
        {APPROVAL_TYPE_LABELS[request.type]}: <strong>{request.subject}</strong>, asked by{' '}
        {request.requester.fullName}.
      </Typography>
      {!reject && request.type === 'EMPLOYEE_DEACTIVATION' && (
        <FormControlLabel
          control={
            <Checkbox checked={confirmOpenWork} onChange={(e) => setConfirmOpenWork(e.target.checked)} />
          }
          label="Confirm even if this person still has charts or open rework"
        />
      )}
      <TextField
        label={reject ? 'Reason' : 'Note (optional)'}
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        error={Boolean(error)}
        helperText={error}
        multiline
        minRows={2}
      />
    </FormDialog>
  );
}

const REQUEST_TYPES: Record<string, ApprovalType[]> = {
  TEAM_LEAD: [...APPROVAL_TYPES],
  GROUP_COACH: [...APPROVAL_TYPES],
  VENDOR_ADMIN: [...APPROVAL_TYPES],
  HR: ['EMPLOYEE_DEACTIVATION', 'LOGIN_NAME_CHANGE'],
};

function Approvals() {
  const { profile, signOut } = useSession();
  const isManager = profile.employee.role === 'MANAGER';
  const [status, setStatus] = useState<string>('');
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{
    request: ApprovalRecord;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useResource<ApprovalPage>(`/approvals${status ? `?status=${status}` : ''}`);
  const data = list.data;
  const allowed = REQUEST_TYPES[profile.employee.role] ?? [];

  async function cancel(id: string) {
    setError(null);
    try {
      await apiFetch(`/approvals/${id}/cancel`, { method: 'POST' });
      list.refresh();
    } catch (e) {
      setError(problemText(e, 'The request could not be cancelled.'));
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Approvals"
      currentPath="/approvals"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Show"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ width: 220 }}
          >
            <MenuItem value="">All requests</MenuItem>
            {APPROVAL_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </TextField>
          {data && (
            <Typography variant="body2" color="text.secondary">
              {isManager ? 'Waiting for you' : 'Waiting for the Manager'}: {data.pendingCount}
            </Typography>
          )}
          {allowed.length > 0 && (
            <Button variant="contained" onClick={() => setRequesting(true)} sx={{ ml: { sm: 'auto' } }}>
              Ask for approval
            </Button>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {list.error && <Alert severity="error">{list.error}</Alert>}
        {data && data.items.length === 0 && (
          <EmptyState
            title="No requests"
            description={
              isManager
                ? 'Requests from Team Leads, HR and Vendor Admins appear here for you to decide.'
                : 'Ask for approval to deactivate someone, change a client login or close a project.'
            }
          />
        )}
        {data && data.items.length > 0 && (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small" aria-label="Approval requests">
                <TableHead>
                  <TableRow>
                    <TableCell>Request</TableCell>
                    <TableCell>About</TableCell>
                    <TableCell>Asked by</TableCell>
                    <TableCell>Details</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Asked</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.items.map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell component="th" scope="row">
                        {APPROVAL_TYPE_LABELS[r.type]}
                      </TableCell>
                      <TableCell>{r.subject}</TableCell>
                      <TableCell>{r.requester.fullName}</TableCell>
                      <TableCell>
                        {[
                          r.request.reason,
                          r.request.loginName,
                          r.comments,
                          r.decisionComments && `Decision: ${r.decisionComments}`,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={STATUS_LABEL[r.status]} color={TONE[r.status]} />
                      </TableCell>
                      <TableCell>{when(r.createdAt)}</TableCell>
                      <TableCell align="right">
                        {r.status === 'PENDING' && isManager && (
                          <Box sx={{ display: 'inline-flex', gap: 1 }}>
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => setDeciding({ request: r, decision: 'APPROVED' })}
                              aria-label={`Approve ${r.subject}`}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              onClick={() => setDeciding({ request: r, decision: 'REJECTED' })}
                              aria-label={`Reject ${r.subject}`}
                            >
                              Reject
                            </Button>
                          </Box>
                        )}
                        {r.status === 'PENDING' && r.requester.id === profile.employee.id && (
                          <Button
                            size="small"
                            onClick={() => void cancel(r.id)}
                            aria-label={`Cancel ${r.subject}`}
                          >
                            Cancel
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
      {requesting && (
        <RequestDialog
          allowed={allowed}
          onClose={(created) => {
            setRequesting(false);
            if (created) list.refresh();
          }}
        />
      )}
      {deciding && (
        <DecideDialog
          request={deciding.request}
          decision={deciding.decision}
          onClose={(done) => {
            setDeciding(null);
            if (done) list.refresh();
          }}
        />
      )}
    </AppShell>
  );
}

/** Managers decide; Team Leads, HR, Vendor Admins and Quality Coaches ask. The API enforces who may do what. */
export function ApprovalsWorkspace() {
  return (
    <RequireSession>
      <Approvals />
    </RequireSession>
  );
}
