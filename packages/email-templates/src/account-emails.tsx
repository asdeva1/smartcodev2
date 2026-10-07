import { BrandedEmailLayout } from './layout.js';
import { EmailAction, EmailHeading, EmailNote, EmailParagraph } from './parts.js';

interface Base {
  brandAssetBaseUrl: string;
  recipientName: string;
}

export interface ActivationEmailProps extends Base {
  /** Absolute link built from configuration (never hard-coded) — carries the single-use token. */
  activationUrl: string;
  /** e.g. "72 hours". */
  validFor: string;
  roleLabel: string;
  invitedByName?: string;
}

/** First sign-in for a Manager (bootstrap or created by another Manager). */
export function ManagerActivationEmail(props: ActivationEmailProps) {
  return (
    <BrandedEmailLayout
      brandAssetBaseUrl={props.brandAssetBaseUrl}
      preview="Activate your SmartCode Manager account"
    >
      <EmailHeading>Activate your Manager account</EmailHeading>
      <EmailParagraph>Hello {props.recipientName},</EmailParagraph>
      <EmailParagraph>
        {props.invitedByName ? `${props.invitedByName} has` : 'You have been'} set up a Manager account for
        you in SmartCode. Managers control employees, Login Names, allocation and audit review, so choose a
        long, unique password that you use nowhere else.
      </EmailParagraph>
      <EmailAction label="Activate account and set password" url={props.activationUrl} />
      <EmailNote>
        This link works once and expires in {props.validFor}. No one at SmartClues will ever ask you for your
        password. If you were not expecting this message, ignore it — the account stays inactive.
      </EmailNote>
    </BrandedEmailLayout>
  );
}

/** First sign-in for every other role. */
export function EmployeeActivationEmail(props: ActivationEmailProps) {
  return (
    <BrandedEmailLayout brandAssetBaseUrl={props.brandAssetBaseUrl} preview="Activate your SmartCode account">
      <EmailHeading>Welcome to SmartCode</EmailHeading>
      <EmailParagraph>Hello {props.recipientName},</EmailParagraph>
      <EmailParagraph>
        {props.invitedByName ? `${props.invitedByName} has` : 'Your Manager has'} registered you as{' '}
        {props.roleLabel}. Open the link below to create your own password and activate your account. You will
        sign in with this email address and that password.
      </EmailParagraph>
      <EmailAction label="Activate account and set password" url={props.activationUrl} />
      <EmailNote>
        This link works once and expires in {props.validFor}. Your Manager can send a new one if it expires.
        Nobody else sets or sees your password.
      </EmailNote>
    </BrandedEmailLayout>
  );
}

export interface PasswordResetEmailProps extends Base {
  resetUrl: string;
  validFor: string;
  /** "self" when the employee asked for it; "manager" when an administrator started it. */
  requestedBy: 'self' | 'manager';
}

export function PasswordResetEmail(props: PasswordResetEmailProps) {
  return (
    <BrandedEmailLayout brandAssetBaseUrl={props.brandAssetBaseUrl} preview="Reset your SmartCode password">
      <EmailHeading>Reset your password</EmailHeading>
      <EmailParagraph>Hello {props.recipientName},</EmailParagraph>
      <EmailParagraph>
        {props.requestedBy === 'self'
          ? 'We received a request to reset the password for your SmartCode account.'
          : 'An administrator started a password reset for your SmartCode account.'}{' '}
        Choose a new password with the link below. Signing in elsewhere will end once you finish.
      </EmailParagraph>
      <EmailAction label="Choose a new password" url={props.resetUrl} />
      <EmailNote>
        This link works once and expires in {props.validFor}. If you did not ask for this, ignore the message
        — your current password keeps working.
      </EmailNote>
    </BrandedEmailLayout>
  );
}

export interface SecurityNotificationEmailProps extends Base {
  /** What happened, e.g. "Your password was changed". */
  headline: string;
  detail: string;
  /** ISO-like display time in the recipient's context (formatted by the caller). */
  occurredAt: string;
}

export function SecurityNotificationEmail(props: SecurityNotificationEmailProps) {
  return (
    <BrandedEmailLayout brandAssetBaseUrl={props.brandAssetBaseUrl} preview={props.headline}>
      <EmailHeading>{props.headline}</EmailHeading>
      <EmailParagraph>Hello {props.recipientName},</EmailParagraph>
      <EmailParagraph>{props.detail}</EmailParagraph>
      <EmailNote>
        Time: {props.occurredAt}. If this was not you, contact your Manager straight away so the account can
        be secured.
      </EmailNote>
    </BrandedEmailLayout>
  );
}

export interface AccountStatusEmailProps extends Base {
  status: 'DEACTIVATED' | 'REACTIVATED' | 'ROLE_CHANGED';
  /** New role label for ROLE_CHANGED. */
  roleLabel?: string;
}

const STATUS_COPY = {
  DEACTIVATED: {
    headline: 'Your SmartCode account was deactivated',
    detail:
      'You can no longer sign in. Your work history is kept. Contact your Manager if you think this is a mistake.',
  },
  REACTIVATED: {
    headline: 'Your SmartCode account was reactivated',
    detail: 'Check your inbox for a separate activation email to create a new password and sign in again.',
  },
  ROLE_CHANGED: {
    headline: 'Your SmartCode role changed',
    detail: 'Your access now follows your new role the next time you sign in.',
  },
} as const;

export function AccountStatusEmail(props: AccountStatusEmailProps) {
  const copy = STATUS_COPY[props.status];
  return (
    <BrandedEmailLayout brandAssetBaseUrl={props.brandAssetBaseUrl} preview={copy.headline}>
      <EmailHeading>{copy.headline}</EmailHeading>
      <EmailParagraph>Hello {props.recipientName},</EmailParagraph>
      <EmailParagraph>
        {copy.detail}
        {props.status === 'ROLE_CHANGED' && props.roleLabel ? ` New role: ${props.roleLabel}.` : ''}
      </EmailParagraph>
    </BrandedEmailLayout>
  );
}
