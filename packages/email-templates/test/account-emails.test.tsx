import { describe, expect, it } from 'vitest';
import {
  AccountStatusEmail,
  EmployeeActivationEmail,
  ManagerActivationEmail,
  PasswordResetEmail,
  SecurityNotificationEmail,
  renderEmail,
} from '../src/index.js';

const base = { brandAssetBaseUrl: 'https://app.example.test/brand', recipientName: 'Test Person' };
const link = 'https://app.example.test/account/activate?token=SYNTHETIC_TOKEN_VALUE_0123456789';

describe('account emails', () => {
  it('Manager and employee activation carry the logo, the configured link and expiry, and never a password', async () => {
    for (const element of [
      <ManagerActivationEmail
        key="m"
        {...base}
        activationUrl={link}
        validFor="72 hours"
        roleLabel="Manager"
      />,
      <EmployeeActivationEmail
        key="e"
        {...base}
        activationUrl={link}
        validFor="72 hours"
        roleLabel="Coder"
        invitedByName="Test Manager"
      />,
    ]) {
      const { html, text } = await renderEmail(element);
      expect(html).toContain('src="https://app.example.test/brand/web/smartcode-logo-horizontal@1x.png"');
      expect(html).toContain(link);
      expect(text).toContain('72 hours');
      expect(text.toLowerCase()).not.toContain('temporary password');
    }
    const manager = await renderEmail(
      <ManagerActivationEmail {...base} activationUrl={link} validFor="72 hours" roleLabel="Manager" />,
    );
    expect(manager.text).toContain('Manager account');
  });

  it('password reset explains who started it and that the link is single-use', async () => {
    const self = await renderEmail(
      <PasswordResetEmail {...base} resetUrl={link} validFor="30 minutes" requestedBy="self" />,
    );
    expect(self.text).toContain('We received a request');
    expect(self.text).toContain('works once');
    const manager = await renderEmail(
      <PasswordResetEmail {...base} resetUrl={link} validFor="30 minutes" requestedBy="manager" />,
    );
    expect(manager.text).toContain('An administrator started');
  });

  it('security and status notices contain no links to act on', async () => {
    const security = await renderEmail(
      <SecurityNotificationEmail
        {...base}
        headline="Your password was changed"
        detail="Your SmartCode password was changed."
        occurredAt="2026-10-07 10:00 UTC"
      />,
    );
    expect(security.html).not.toContain('<a');
    for (const status of ['DEACTIVATED', 'REACTIVATED', 'ROLE_CHANGED'] as const) {
      const { text } = await renderEmail(
        <AccountStatusEmail {...base} status={status} roleLabel="Auditor" />,
      );
      expect(text).toContain('Hello Test Person');
    }
  });
});
