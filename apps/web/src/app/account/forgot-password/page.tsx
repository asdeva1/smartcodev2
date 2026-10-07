import type { Metadata } from 'next';
import { AccountPage } from '@/features/auth/AccountPage';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AccountPage
      title="Forgot your password?"
      intro="Enter your work email and we will send a link to choose a new one. Accounts that have not been activated yet need their activation link instead."
    >
      <ForgotPasswordForm />
    </AccountPage>
  );
}
