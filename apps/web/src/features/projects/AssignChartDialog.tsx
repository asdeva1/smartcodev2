'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CsvResult, ProjectMemberRecord } from '@smartcode/shared';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction } from '../admin/ui';

/** Reasons a row was refused, taken from the allocation check the server ran. */
export function refusalText(result: CsvResult): string {
  const reasons = [...result.preview.fileErrors, ...result.preview.rows.flatMap((row) => row.errors)];
  return reasons.length ? reasons.join(' ') : 'The chart was not added. Check the details and try again.';
}

/**
 * "Add chart": a chart that is already in the project's repository (uploaded with the CSV) is allocated to a coder.
 * The Login Name is linked to the coder's email when the coder has none yet.
 */
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
  const [chartId, setChartId] = useState('');
  const [loginName, setLoginName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const action = useAction<string | null>((message) => {
    if (message) onClose(message);
  });
  const known = coders.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
  const lockedName = known?.loginName ?? null;

  return (
    <FormDialog
      title="Add chart"
      onClose={() => onClose(null)}
      submitLabel="Add chart"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        if (!chartId.trim()) return setFieldError('Enter the Chart ID.');
        if (!email.trim()) return setFieldError('Enter the employee email.');
        const name = (lockedName ?? loginName).trim();
        if (!name) return setFieldError('Enter the Login Name.');
        setFieldError(null);
        void action.run(async () => {
          const r = await apiFetch<CsvResult>(`/projects/${projectId}/charts/assign`, {
            method: 'POST',
            body: JSON.stringify({ chartId: chartId.trim(), loginName: name, email: email.trim() }),
          });
          if (!r.committed) {
            setFieldError(refusalText(r));
            return null;
          }
          return `Chart ${chartId.trim()} added to ${name}. It now shows in the coder’s allotment.`;
        });
      }}
    >
      <Typography variant="body2" color="text.secondary">
        The chart must already be in this project’s chart list (upload it with the CSV first). Adding it
        allots it to the coder, who then sees it in their portal.
      </Typography>
      <TextField
        size="small"
        label="Chart ID"
        required
        value={chartId}
        onChange={(e) => setChartId(e.target.value)}
        error={Boolean(fieldError) && !chartId.trim()}
      />
      <Autocomplete
        freeSolo
        options={coders.map((m) => m.email)}
        inputValue={email}
        onInputChange={(_, v) => setEmail(v)}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label="Employee email"
            required
            helperText="Pick a coder on this project or type another coder’s email."
          />
        )}
      />
      <TextField
        size="small"
        label="Login Name"
        required
        value={lockedName ?? loginName}
        disabled={Boolean(lockedName)}
        onChange={(e) => setLoginName(e.target.value)}
        helperText={
          lockedName
            ? 'This coder’s existing Login Name.'
            : 'Linked to the email above, and to the chart, when you add it.'
        }
        error={Boolean(fieldError) && !(lockedName ?? loginName).trim()}
      />
      {fieldError && (
        <Typography role="alert" variant="body2" color="error">
          {fieldError}
        </Typography>
      )}
    </FormDialog>
  );
}
