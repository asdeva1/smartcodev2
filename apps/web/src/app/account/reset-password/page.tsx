'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AccountPage } from '@/features/auth/AccountPage';
import { SetPasswordForm } from '@/features/auth/SetPasswordForm';

function Reset() {
  const token = useSearchParams().get('token');
  return (
    <AccountPage title="Choose a new password" intro="Signing in again will be required on every device.">
      <SetPasswordForm kind="PASSWORD_RESET" token={token} />
    </AccountPage>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
