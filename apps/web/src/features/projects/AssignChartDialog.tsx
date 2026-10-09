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
 * "Assign chart": the Manager enters Chart ID, Page Number, Client Login and the coder's email; the chart shows in that
 * coder's allotment. The Client Login is linked to the coder's email when the coder has none yet.
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
  const [pages, setPages] = useState('');
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
      title="Assign chart"
      onClose={() => onClose(null)}
      submitLabel="Assign chart"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        if (!chartId.trim()) return setFieldError('Enter the Chart ID.');
        if (pages.trim() && !/^\d+$/.test(pages.trim()))
          return setFieldError('Page number must be a whole number.');
        if (!email.trim()) return setFieldError('Enter the employee email.');
        const name = (lockedName ?? loginName).trim();
        if (!name) return setFieldError('Enter the Client Login.');
        setFieldError(null);
        void action.run(async () => {
          const r = await apiFetch<CsvResult>(`/projects/${projectId}/charts/assign`, {
            method: 'POST',
            body: JSON.stringify({
              chartId: chartId.trim(),
              ...(pages.trim() ? { pages: Number(pages.trim()) } : {}),
              loginName: name,
              email: email.trim(),
            }),
          });
          if (!r.committed) {
            setFieldError(refusalText(r));
            return null;
          }
          return `Chart ${chartId.trim()} assigned to ${name}. It now shows in the coder’s allotment.`;
        });
      }}
    >
      <Typography variant="body2" color="text.secondary">
        Assign one chart without a file. It shows in the coder’s allotment and dashboard straight away. For a
        chart that is already in the list from the CSV, leave the page number empty to keep its pages.
      </Typography>
      <TextField
        size="small"
        label="Chart ID"
        required
        value={chartId}
        onChange={(e) => setChartId(e.target.value)}
        error={Boolean(fieldError) && !chartId.trim()}
      />
      <TextField
        size="small"
        label="Page number"
        value={pages}
        onChange={(e) => setPages(e.target.value)}
        slotProps={{ htmlInput: { inputMode: 'numeric' } }}
        helperText="Required for a chart that is not in the list yet."
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
            label="Email ID"
            required
            helperText="Pick a coder on this project or type another coder’s email."
          />
        )}
      />
      <TextField
        size="small"
        label="Client Login"
        required
        value={lockedName ?? loginName}
        disabled={Boolean(lockedName)}
        onChange={(e) => setLoginName(e.target.value)}
        helperText={
          lockedName
            ? 'This coder’s existing Client Login.'
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
