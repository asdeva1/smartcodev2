'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { loginRequestSchema } from '@smartcode/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import NextLink from 'next/link';
import { ApiError, apiFetch } from '@/lib/api';
import { type Profile, homeFor } from './session';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

/** Turns API problems into messages that say what happened and what to do. */
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Sign-in failed. Try again.';
  switch (error.problem.code) {
    case 'ACCOUNT_NOT_ACTIVATED':
      return 'Your account is not activated yet. Use the activation link in your email, or ask your Manager to resend it.';
    case 'ACCOUNT_UNAVAILABLE':
      return 'This account is locked or inactive. Contact your Manager.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a few minutes before trying again.';
    case 'UNAUTHENTICATED':
      return 'Email or password is incorrect.';
    case 'NOT_FOUND':
      return 'Sign-in is not enabled on this server yet.';
    case 'SERVICE_UNAVAILABLE':
      return error.problem.detail ?? 'SmartCode could not reach the server.';
    default:
      return 'Sign-in failed. Try again.';
  }
}

export function LoginForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = loginRequestSchema.safeParse({ email: data.get('email'), password: data.get('password') });
    setFormError(null);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'email' || field === 'password') && !errors[field]) errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const profile = await apiFetch<Partial<Profile>>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      router.push(profile.employee ? homeFor(profile.employee.role) : '/');
    } catch (error) {
      setFormError(loginErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      component="form"
      noValidate
      onSubmit={onSubmit}
      sx={{ display: 'grid', gap: 2.5 }}
      aria-label="Sign in"
    >
      {formError && (
        <Alert severity="error" role="alert">
          {formError}
        </Alert>
      )}
      <TextField
        label="Work email"
        name="email"
        type="email"
        autoComplete="username"
        autoFocus
        error={Boolean(fieldErrors.email)}
        helperText={fieldErrors.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        error={Boolean(fieldErrors.password)}
        helperText={fieldErrors.password}
      />
      <Button type="submit" variant="contained" size="large" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <Button component={NextLink} href="/account/forgot-password" variant="text">
        Forgot your password?
      </Button>
    </Box>
  );
}
