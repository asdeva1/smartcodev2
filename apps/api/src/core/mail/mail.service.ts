import { Injectable, Logger } from '@nestjs/common';
import {
  renderAccountStatus,
  renderEmployeeActivation,
  renderManagerActivation,
  renderPasswordReset,
  renderSecurityNotification,
} from '@smartcode/email-templates';
import { ROLE_LABELS, type Role } from '@smartcode/shared';
import { AppConfig } from '../config/app-config.service';
import type { MailMessage, MailTransport } from './mail.types';

export interface Recipient {
  fullName: string;
  email: string;
}

/** "72h" → "72 hours", "30m" → "30 minutes". */
export function humanDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) {
    const d = minutes / (60 * 24);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Sends the branded account emails. Links are built from configuration (WEB_URL) — never hard-coded. Neither the
 * link nor the token is ever logged: only the category and the outcome.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly transport: MailTransport,
  ) {}

  get from(): string {
    return this.config.get('MAIL_FROM') ?? 'SmartCode <no-reply@smartcode.example.test>';
  }

  private get brand(): string {
    return this.config.brandAssetBaseUrl;
  }

  async sendActivation(
    to: Recipient & { role: Role },
    token: string,
    options: { invitedByName?: string } = {},
  ): Promise<void> {
    const props = {
      brandAssetBaseUrl: this.brand,
      recipientName: to.fullName,
      activationUrl: this.config.webUrl('/account/activate', { token }),
      validFor: humanDuration(this.config.ms('ACTIVATION_TOKEN_TTL')),
      roleLabel: ROLE_LABELS[to.role],
      ...(options.invitedByName ? { invitedByName: options.invitedByName } : {}),
    };
    const rendered =
      to.role === 'MANAGER' ? await renderManagerActivation(props) : await renderEmployeeActivation(props);
    await this.deliver({
      to: to.email,
      toName: to.fullName,
      subject:
        to.role === 'MANAGER' ? 'Activate your SmartCode Manager account' : 'Activate your SmartCode account',
      category: 'activation',
      ...rendered,
    });
  }

  async sendPasswordReset(to: Recipient, token: string, requestedBy: 'self' | 'manager'): Promise<void> {
    const rendered = await renderPasswordReset({
      brandAssetBaseUrl: this.brand,
      recipientName: to.fullName,
      resetUrl: this.config.webUrl('/account/reset-password', { token }),
      validFor: humanDuration(this.config.ms('RESET_TOKEN_TTL')),
      requestedBy,
    });
    await this.deliver({
      to: to.email,
      toName: to.fullName,
      subject: 'Reset your SmartCode password',
      category: 'password-reset',
      ...rendered,
    });
  }

  async sendSecurityNotice(to: Recipient, headline: string, detail: string): Promise<void> {
    const rendered = await renderSecurityNotification({
      brandAssetBaseUrl: this.brand,
      recipientName: to.fullName,
      headline,
      detail,
      occurredAt: new Date().toUTCString(),
    });
    await this.deliver({
      to: to.email,
      toName: to.fullName,
      subject: headline,
      category: 'security',
      ...rendered,
    });
  }

  async sendAccountStatus(
    to: Recipient,
    status: 'DEACTIVATED' | 'REACTIVATED' | 'ROLE_CHANGED',
    role?: Role,
  ): Promise<void> {
    const rendered = await renderAccountStatus({
      brandAssetBaseUrl: this.brand,
      recipientName: to.fullName,
      status,
      ...(role ? { roleLabel: ROLE_LABELS[role] } : {}),
    });
    const subjects = {
      DEACTIVATED: 'Your SmartCode account was deactivated',
      REACTIVATED: 'Your SmartCode account was reactivated',
      ROLE_CHANGED: 'Your SmartCode role changed',
    } as const;
    await this.deliver({
      to: to.email,
      toName: to.fullName,
      subject: subjects[status],
      category: 'account-status',
      ...rendered,
    });
  }

  /**
   * Delivery failures are logged (category only) and reported to the caller as `false`, so a business operation that
   * already committed (e.g. an employee was created) is not reported as failed — the Manager can resend.
   */
  async trySend(send: () => Promise<void>, category: string): Promise<boolean> {
    try {
      await send();
      return true;
    } catch (error) {
      this.logger.error(`Email delivery failed (${category}): ${(error as Error).name}`);
      return false;
    }
  }

  private async deliver(message: MailMessage): Promise<void> {
    await this.transport.send({ ...message, to: message.to.toLowerCase() }, this.from);
    this.logger.log(`Email sent (${message.category}) via ${this.transport.name}`);
  }
}
