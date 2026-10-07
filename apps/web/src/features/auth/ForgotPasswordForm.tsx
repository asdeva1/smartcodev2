'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { forgotPasswordRequestSchema } from '@smartcode/shared';
import NextLink from 'next/link';
import { type FormEvent, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = forgotPasswordRequestSchema.safeParse({
      email: new FormData(event.currentTarget).get('email'),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/auth/password/forgot', { method: 'POST', body: JSON.stringify(parsed.data) });
      setSent(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.problem.code === 'RATE_LIMITED'
          ? 'Too many requests. Wait a few minutes and try again.'
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Alert severity="success" role="status">
          If that email belongs to an active account, a reset link is on its way. It expires in 30 minutes.
        </Alert>
        <Button component={NextLink} href="/login" variant="outlined">
          Back to sign in
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
      aria-label="Reset password"
    >
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      <TextField label="Work email" name="email" type="email" autoComplete="username" autoFocus />
      <Button type="submit" variant="contained" size="large" disabled={busy}>
        {busy ? 'Sending…' : 'Email me a reset link'}
      </Button>
      <Button component={NextLink} href="/login" variant="text">
        Back to sign in
      </Button>
    </Box>
  );
}
