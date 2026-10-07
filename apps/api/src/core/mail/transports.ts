import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MailMessage, MailTransport } from './mail.types';

/** In-process outbox for tests. Holds full messages (including links) — development/test only. */
export class MemoryMailTransport implements MailTransport {
  readonly name = 'memory' as const;
  readonly outbox: (MailMessage & { from: string; sentAt: Date })[] = [];

  send(message: MailMessage, from: string): Promise<void> {
    this.outbox.push({ ...message, from, sentAt: new Date() });
    return Promise.resolve();
  }

  clear(): void {
    this.outbox.length = 0;
  }

  /** The most recent message to an address, or undefined. */
  lastTo(address: string) {
    return [...this.outbox].reverse().find((m) => m.to === address.toLowerCase());
  }
}

/** Writes each message to a JSON file so a developer (or the E2E test) can open the link. Development/test only. */
export class FileMailTransport implements MailTransport {
  readonly name = 'file' as const;
  constructor(private readonly directory: string) {}

  async send(message: MailMessage, from: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
    await writeFile(
      join(this.directory, name),
      JSON.stringify({ from, sentAt: new Date().toISOString(), ...message }, null, 2),
      { mode: 0o600 },
    );
  }
}

export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp' as const;
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async send(message: MailMessage, from: string): Promise<void> {
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({ host: this.host, port: this.port, secure: false, ignoreTLS: true });
    await transporter.sendMail({
      from,
      to: message.toName ? { name: message.toName, address: message.to } : message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}

export class SesMailTransport implements MailTransport {
  readonly name = 'ses' as const;
  constructor(private readonly region: string) {}

  async send(message: MailMessage, from: string): Promise<void> {
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    const client = new SESv2Client({ region: this.region });
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }
}
