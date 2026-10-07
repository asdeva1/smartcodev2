'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AccountPage } from '@/features/auth/AccountPage';
import { SetPasswordForm } from '@/features/auth/SetPasswordForm';

function Activate() {
  const token = useSearchParams().get('token');
  return (
    <AccountPage
      title="Activate your account"
      intro="Choose a password to finish setting up your SmartCode account."
    >
      <SetPasswordForm kind="ACTIVATION" token={token} />
    </AccountPage>
  );
}

export default function ActivatePage() {
  return (
    <Suspense>
      <Activate />
    </Suspense>
  );
}
