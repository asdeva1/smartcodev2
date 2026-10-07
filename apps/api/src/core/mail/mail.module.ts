import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { MailService } from './mail.service';
import type { MailTransport } from './mail.types';
import { FileMailTransport, MemoryMailTransport, SesMailTransport, SmtpMailTransport } from './transports';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export function createTransport(config: AppConfig): MailTransport {
  switch (config.get('MAIL_TRANSPORT')) {
    case 'ses':
      return new SesMailTransport(config.get('AWS_REGION') ?? 'us-east-1');
    case 'smtp':
      return new SmtpMailTransport(config.get('SMTP_HOST') ?? 'localhost', config.get('SMTP_PORT'));
    case 'memory':
      return new MemoryMailTransport();
    default:
      return new FileMailTransport(config.get('MAIL_FILE_DIR') ?? '.mail-outbox');
  }
}

@Global()
@Module({
  providers: [
    { provide: MAIL_TRANSPORT, inject: [AppConfig], useFactory: createTransport },
    {
      provide: MailService,
      inject: [AppConfig, MAIL_TRANSPORT],
      useFactory: (config: AppConfig, transport: MailTransport) => new MailService(config, transport),
    },
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
