'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { CsvPreview, CsvResult } from '@smartcode/shared';
import { type ChangeEvent, type ReactNode, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { problemText } from './common';

const STEPS = ['Upload', 'Preview', 'Confirm', 'Result'] as const;

export interface CsvImportConfig {
  title: string;
  /** Columns the file must have, shown to the person and used for the downloadable template. */
  columns: readonly string[];
  /** Notes on what the file must not contain, and what happens next. */
  guidance: ReactNode;
  previewPath: string;
  commitPath: string;
  /** Wording for what a successful row does: "created" / "assigned". */
  doneVerb: string;
  onClose: (changed: boolean) => void;
  /** Extra actions on the result step (e.g. send activation links to the people just created). */
  renderResultActions?: (result: CsvResult) => ReactNode;
}

function statusChip(status: string) {
  const color = status === 'VALID' ? 'success' : status === 'DUPLICATE' ? 'warning' : 'error';
  return (
    <Chip
      size="small"
      color={color}
      variant="outlined"
      label={status === 'VALID' ? 'Ready' : status === 'DUPLICATE' ? 'Duplicate' : 'Needs fixing'}
    />
  );
}

/**
 * Upload → Preview → Confirm → Result. The file is read in the browser and sent as text; the server re-validates on
 * commit, so what is created always matches the rules at that moment, not just what the preview showed.
 */
export function CsvImportDialog(config: CsvImportConfig) {
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mode, setMode] = useState<'valid-only' | 'all-or-nothing'>('valid-only');
  const [result, setResult] = useState<CsvResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    setBusy(true);
    try {
      const p = await apiFetch<CsvPreview>(config.previewPath, {
        method: 'POST',
        body: JSON.stringify({ csv: text }),
      });
      setPreview(p);
      setStep(1);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<CsvResult>(config.commitPath, {
        method: 'POST',
        body: JSON.stringify({ csv, mode }),
      });
      setResult(r);
      setStep(3);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${config.columns.join(',')}\n`)}`;
  const blocked = Boolean(preview && (preview.fileErrors.length > 0 || preview.valid === 0));
  const allValid = Boolean(
    preview && preview.invalid === 0 && preview.duplicates === 0 && preview.fileErrors.length === 0,
  );

  return (
    <Dialog
      open
      onClose={() => config.onClose(Boolean(result?.committed))}
      maxWidth="md"
      fullWidth
      aria-labelledby="csv-title"
    >
      <DialogTitle id="csv-title">{config.title}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && (
          <Alert severity="error" role="alert" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 0 && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography>
              Required columns: <strong>{config.columns.join(', ')}</strong>.
            </Typography>
            <Typography color="text.secondary" component="div">
              {config.guidance}
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button component="label" variant="contained" disabled={busy}>
                {busy ? 'Checking file…' : 'Choose CSV file'}
                <input hidden type="file" accept=".csv,text/csv" onChange={onFile} aria-label="CSV file" />
              </Button>
              <Button component="a" href={template} download="template.csv" variant="text">
                Download template
              </Button>
              {fileName && <Typography variant="body2">{fileName}</Typography>}
            </Box>
          </Box>
        )}

        {step >= 1 && step <= 2 && preview && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {preview.fileErrors.map((m) => (
              <Alert key={m} severity="error">
                {m}
              </Alert>
            ))}
            <Typography>
              {preview.total} rows: <strong>{preview.valid} ready</strong>, {preview.invalid} need fixing,{' '}
              {preview.duplicates} duplicates
              {preview.warnings > 0 ? `, ${preview.warnings} with notes` : ''}.
            </Typography>
            <TableContainer sx={{ maxHeight: 340 }}>
              <Table size="small" stickyHeader aria-label="Import preview">
                <TableHead>
                  <TableRow>
                    <TableCell>Line</TableCell>
                    {config.columns.map((c) => (
                      <TableCell key={c}>{c}</TableCell>
                    ))}
                    <TableCell>Result</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.line}>
                      <TableCell>{row.line}</TableCell>
                      {config.columns.map((c) => (
                        <TableCell key={c}>{row.values[c]}</TableCell>
                      ))}
                      <TableCell>
                        {statusChip(row.status)}
                        {[...row.errors, ...row.warnings].map((m) => (
                          <Typography
                            key={m}
                            variant="caption"
                            component="div"
                            color={row.errors.includes(m) ? 'error' : 'text.secondary'}
                          >
                            {m}
                          </Typography>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {step === 2 && (
              <RadioGroup
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
                aria-label="If some rows have problems"
              >
                <FormControlLabel
                  value="valid-only"
                  control={<Radio />}
                  label={`Skip rows that need fixing and ${config.doneVerb} the ${preview.valid} ready rows`}
                  disabled={allValid}
                />
                <FormControlLabel
                  value="all-or-nothing"
                  control={<Radio />}
                  label={`${config.doneVerb[0]?.toUpperCase()}${config.doneVerb.slice(1)} nothing unless every row is ready`}
                />
              </RadioGroup>
            )}
          </Box>
        )}

        {step === 3 && result && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Alert severity={result.committed && result.created > 0 ? 'success' : 'warning'} role="status">
              {result.committed
                ? `${result.created} ${config.doneVerb}${result.skipped ? `, ${result.skipped} skipped` : ''}.`
                : 'Nothing was changed because some rows need fixing.'}
            </Alert>
            {config.renderResultActions?.(result)}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 0 && <Button onClick={() => config.onClose(false)}>Cancel</Button>}
        {step === 1 && (
          <>
            <Button
              onClick={() => {
                setStep(0);
                setPreview(null);
              }}
            >
              Choose another file
            </Button>
            <Button variant="contained" disabled={blocked} onClick={() => setStep(2)}>
              Continue
            </Button>
          </>
        )}
        {step === 2 && (
          <>
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button variant="contained" disabled={busy} onClick={commit}>
              {busy ? 'Working…' : 'Confirm import'}
            </Button>
          </>
        )}
        {step === 3 && (
          <Button variant="contained" onClick={() => config.onClose(Boolean(result?.committed))}>
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
