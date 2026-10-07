'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { checkPasswordPolicy } from '@smartcode/shared';
import NextLink from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

export type LinkKind = 'ACTIVATION' | 'PASSWORD_RESET';

const COPY = {
  ACTIVATION: {
    endpoint: '/auth/activation',
    submit: 'Activate account',
    working: 'Activating…',
    done: 'Your account is active. Sign in with your work email and the password you just chose.',
    dead: 'This activation link has expired or was already used. Ask your Manager to send a new one.',
  },
  PASSWORD_RESET: {
    endpoint: '/auth/password/reset',
    submit: 'Set new password',
    working: 'Saving…',
    done: 'Your password has been changed. Sign in with the new password.',
    dead: 'This reset link has expired or was already used. Request a new one.',
  },
} as const;

/** Shared by /account/activate and /account/reset-password: check the link, then let the person choose a password. */
export function SetPasswordForm({ kind, token }: { kind: LinkKind; token: string | null }) {
  const copy = COPY[kind];
  const [link, setLink] = useState<'checking' | 'valid' | 'dead'>(token ? 'checking' : 'dead');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<{ valid: boolean; fullName?: string }>('/auth/tokens/check', {
      method: 'POST',
      body: JSON.stringify({ type: kind, token }),
    })
      .then((r) => {
        if (cancelled) return;
        setLink(r.valid ? 'valid' : 'dead');
        setName(r.fullName ?? '');
      })
      .catch(() => !cancelled && setLink('dead'));
    return () => {
      cancelled = true;
    };
  }, [kind, token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const policy = checkPasswordPolicy(password, { fullName: name });
    if (policy) return setError(policy);
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await apiFetch(copy.endpoint, { method: 'POST', body: JSON.stringify({ token, password }) });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'TOKEN_INVALID') setLink('dead');
      else
        setError(
          e instanceof ApiError
            ? (e.problem.errors?.[0]?.message ?? e.problem.detail ?? e.message)
            : 'Something went wrong. Try again.',
        );
    } finally {
      setBusy(false);
    }
  }

  if (link === 'checking') return <CircularProgress aria-label="Checking your link" />;
  if (link === 'dead') {
    return (
      <Alert severity="error" role="alert">
        {copy.dead}
      </Alert>
    );
  }
  if (done) {
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Alert severity="success" role="status">
          {copy.done}
        </Alert>
        <Button component={NextLink} href="/login" variant="contained" size="large">
          Go to sign in
        </Button>
      </Box>
    );
  }
  return (
    <Box
      component="form"
      noValidate
      onSubmit={onSubmit}
      sx={{ display: 'grid', gap: 2.5 }}
      aria-label="Password setup"
    >
      {name && (
        <Alert severity="info" role="status">
          Setting the password for {name}.
        </Alert>
      )}
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        helperText="At least 12 characters. A short phrase of unrelated words works well."
        autoFocus
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <Button type="submit" variant="contained" size="large" disabled={busy}>
        {busy ? copy.working : copy.submit}
      </Button>
    </Box>
  );
}
