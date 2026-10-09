'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { ALLOCATION_CSV_COLUMNS, type CsvResult, type ProjectMemberRecord } from '@smartcode/shared';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction } from '../admin/ui';

/** Splits a pasted list of Chart IDs (one per line, or separated by commas / semicolons / tabs). */
export function parseChartIds(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n\r,;\t]+/)) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Builds the same CSV the upload uses, so manual and file allocation share one set of rules on the server. */
export function buildAllocationCsv(input: {
  loginName: string;
  email: string;
  chartIds: string[];
  pages?: string;
  pageBucket?: string;
  remarks?: string;
}): string {
  const lines = [ALLOCATION_CSV_COLUMNS.join(',')];
  for (const id of input.chartIds) {
    lines.push(
      [input.loginName, input.email, id, input.pages ?? '', input.pageBucket ?? '', input.remarks ?? '']
        .map((v) => cell(v.trim()))
        .join(','),
    );
  }
  return lines.join('\n');
}

export function AssignChartDialog({
  projectId,
  members,
  onClose,
}: {
  projectId: string;
  members: ProjectMemberRecord[];
  onClose: (message: string | null) => void;
}) {
  const coders = members.filter((m) => m.projectRole === 'CODER');
  const [coder, setCoder] = useState<ProjectMemberRecord | null>(null);
  const [email, setEmail] = useState('');
  const [loginName, setLoginName] = useState('');
  const [chartText, setChartText] = useState('');
  const [pages, setPages] = useState('');
  const [bucket, setBucket] = useState('');
  const [remarks, setRemarks] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useAction<string>((message) => onClose(message));
  const chartIds = parseChartIds(chartText);
  const hasLogin = Boolean(coder?.loginName);

  return (
    <FormDialog
      title="Assign chart"
      onClose={() => onClose(null)}
      submitLabel={`Assign ${chartIds.length || ''} chart${chartIds.length === 1 ? '' : 's'}`.replace(
        '  ',
        ' ',
      )}
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        setProblems([]);
        const mail = (coder?.email ?? email).trim();
        if (!mail) return setFieldError('Enter the coder’s email.');
        if (!loginName.trim()) return setFieldError('Enter the Login Name.');
        if (chartIds.length === 0) return setFieldError('Enter at least one Chart ID.');
        setFieldError(null);
        void action.run(async () => {
          const csv = buildAllocationCsv({
            loginName: loginName.trim(),
            email: mail,
            chartIds,
            pages,
            pageBucket: bucket,
            remarks,
          });
          const r = await apiFetch<CsvResult>(`/projects/${projectId}/allocation/commit`, {
            method: 'POST',
            body: JSON.stringify({ csv, mode: 'all-or-nothing' }),
          });
          if (!r.committed) {
            const list = [
              ...r.preview.fileErrors,
              ...r.preview.rows.flatMap((row) =>
                row.errors.map((e) => `${row.values['Chart ID'] ?? `Row ${row.line}`}: ${e}`),
              ),
            ];
            setProblems(list.length ? list : ['Nothing was assigned. Check the details and try again.']);
            throw new Error('Nothing was assigned. Fix the problems below and try again.');
          }
          return `${chartIds.length} chart${chartIds.length === 1 ? '' : 's'} assigned to ${loginName.trim()}.`;
        });
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Assign charts without a CSV. The Login Name is linked to the coder’s email and to each Chart ID, and
        the coder is added to this project.
      </Typography>
      <Autocomplete
        options={coders}
        value={coder}
        getOptionLabel={(m) => `${m.fullName} (${m.email})`}
        onChange={(_, m) => {
          setCoder(m);
          if (m) {
            setEmail(m.email);
            setLoginName(m.loginName ?? '');
          }
        }}
        renderInput={(params) => <TextField {...params} size="small" label="Coder on this project" />}
        noOptionsText="No coders on this project yet"
      />
      <TextField
        size="small"
        label="Coder email"
        required
        value={coder?.email ?? email}
        disabled={Boolean(coder)}
        onChange={(e) => setEmail(e.target.value)}
        helperText={coder ? undefined : 'Or type the email of a coder who is not on this project yet.'}
      />
      <TextField
        size="small"
        label="Login Name"
        required
        value={loginName}
        disabled={hasLogin}
        onChange={(e) => setLoginName(e.target.value)}
        helperText={
          hasLogin
            ? 'This coder’s existing Login Name.'
            : 'Linked to the email above when the charts are assigned.'
        }
      />
      <TextField
        size="small"
        label="Chart ID(s)"
        required
        multiline
        minRows={3}
        value={chartText}
        onChange={(e) => setChartText(e.target.value)}
        helperText={`One per line or separated by commas.${chartIds.length ? ` ${chartIds.length} found.` : ''}`}
      />
      <TextField
        size="small"
        label="Pages (optional)"
        value={pages}
        onChange={(e) => setPages(e.target.value)}
      />
      <TextField
        size="small"
        label="Page bucket (optional)"
        value={bucket}
        onChange={(e) => setBucket(e.target.value)}
      />
      <TextField
        size="small"
        label="Remarks (optional)"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
      />
      {fieldError && <Alert severity="warning">{fieldError}</Alert>}
      {problems.length > 0 && (
        <Alert severity="error">
          {problems.slice(0, 8).map((p) => (
            <div key={p}>{p}</div>
          ))}
          {problems.length > 8 && <div>…and {problems.length - 8} more</div>}
        </Alert>
      )}
    </FormDialog>
  );
}
