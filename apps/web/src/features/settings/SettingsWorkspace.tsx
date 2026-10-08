'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  DEFAULT_TERMINOLOGY,
  type OrganizationRecord,
  type TermKey,
  organizationUpdateSchema,
} from '@smartcode/shared';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';

const TERMS: { key: TermKey; label: string }[] = [
  { key: 'VENDOR', label: 'Vendor' },
  { key: 'SPC', label: 'SPC' },
  { key: 'LOGIN_NAME', label: 'SmartClues Login Name' },
  { key: 'EMPLOYEE_ID', label: 'Employee ID' },
  { key: 'CHART_ID', label: 'Chart ID' },
];

function SettingsForm() {
  const { profile, signOut } = useSession();
  const [org, setOrg] = useState<OrganizationRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function load(record: OrganizationRecord) {
    setOrg(record);
    setName(record.name);
    setTimeZone(record.timeZone);
    setLabels({ ...record.terminology } as Record<string, string>);
  }

  useEffect(() => {
    apiFetch<OrganizationRecord>('/organization')
      .then(load)
      .catch((e: unknown) => setLoadError(problemText(e, 'Settings could not be loaded.')));
  }, []);

  async function save() {
    const terminology = Object.fromEntries(
      Object.entries(labels).filter(
        ([key, value]) => value.trim() && value.trim() !== DEFAULT_TERMINOLOGY[key as TermKey],
      ),
    );
    const parsed = organizationUpdateSchema.safeParse({ name, timeZone, terminology });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'form')] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSaveError(null);
    setBusy(true);
    try {
      load(
        await apiFetch<OrganizationRecord>('/organization', {
          method: 'PATCH',
          body: JSON.stringify(parsed.data),
        }),
      );
      setToast('Settings saved.');
    } catch (e) {
      setSaveError(problemText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      role={profile.employee.role}
      title="Settings"
      currentPath="/manager/settings"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3, maxWidth: 760 }}>
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {org && (
          <>
            <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2 }}>
              <Typography variant="h5" component="h2">
                Organization
              </Typography>
              <TextField
                size="small"
                label="Organization name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={Boolean(errors.name)}
                helperText={errors.name}
              />
              <TextField
                size="small"
                label="Time zone"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                error={Boolean(errors.timeZone)}
                helperText={errors.timeZone ?? 'Used for dates and reports, for example Asia/Kolkata'}
              />
              <Typography variant="body2" color="text.secondary">
                {org.counts.employees} employees · {org.counts.vendors} vendors · {org.counts.teams} teams
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2 }}>
              <Typography variant="h5" component="h2">
                Labels
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Change the words SmartCode shows for these terms. Leave a field empty to use the default.
              </Typography>
              {TERMS.map((t) => (
                <TextField
                  key={t.key}
                  size="small"
                  label={t.label}
                  placeholder={DEFAULT_TERMINOLOGY[t.key]}
                  value={labels[t.key] ?? ''}
                  onChange={(e) => setLabels((l) => ({ ...l, [t.key]: e.target.value }))}
                />
              ))}
            </Paper>

            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Box>
              <Button variant="contained" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save settings'}
              </Button>
            </Box>
          </>
        )}
      </Box>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

export function SettingsWorkspace() {
  return (
    <RequireSession permission="settings.manage">
      <SettingsForm />
    </RequireSession>
  );
}
