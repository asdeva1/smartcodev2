/**
 * pnpm bootstrap:manager — creates the first Manager as PENDING_ACTIVATION and emails an activation link.
 *
 *   BOOTSTRAP_MANAGER_EMAIL=… BOOTSTRAP_MANAGER_NAME=… BOOTSTRAP_MANAGER_EMPLOYEE_ID=… pnpm bootstrap:manager
 *
 * No password exists anywhere: the Manager sets their own through the emailed link. Safe to re-run.
 * `--print-link` prints the link to the terminal for LOCAL DEVELOPMENT ONLY; it is refused in staging/production.
 */
import { AppConfig } from '../src/core/config/app-config.service';
import { parseEnv } from '../src/core/config/env.schema';
import { AuditLogService } from '../src/core/audit/audit-log.service';
import { AuthTokenService } from '../src/core/auth/auth-token.service';
import { BootstrapError, bootstrapManager } from '../src/core/bootstrap/bootstrap-manager';
import { MailService } from '../src/core/mail/mail.service';
import { createTransport } from '../src/core/mail/mail.module';
import { PrismaService } from '../src/core/prisma/prisma.service';

async function main(): Promise<number> {
  const config = new AppConfig(parseEnv(process.env));
  const printLink = process.argv.includes('--print-link');
  if (printLink && config.isDeployed) {
    console.error('--print-link is refused when APP_ENV is staging or production.');
    return 1;
  }
  const email = process.env.BOOTSTRAP_MANAGER_EMAIL;
  const fullName = process.env.BOOTSTRAP_MANAGER_NAME;
  const employeeCode = process.env.BOOTSTRAP_MANAGER_EMPLOYEE_ID;
  if (!email || !fullName || !employeeCode) {
    console.error('Set BOOTSTRAP_MANAGER_EMAIL, BOOTSTRAP_MANAGER_NAME and BOOTSTRAP_MANAGER_EMPLOYEE_ID.');
    return 1;
  }
  if (!config.get('DATABASE_URL')) {
    console.error('DATABASE_URL is not set.');
    return 1;
  }

  const prisma = new PrismaService(config);
  try {
    const deps = {
      prisma,
      tokens: new AuthTokenService(prisma, config),
      audit: new AuditLogService(prisma),
      mail: new MailService(config, createTransport(config)),
    };
    const outcome = await bootstrapManager(
      deps,
      { email, fullName, employeeCode },
      printLink
        ? {
            buildLink: (token) => config.webUrl('/account/activate', { token }),
            onLink: (url) => console.log(`Activation link (local development only): ${url}`),
          }
        : {},
    );
    switch (outcome.status) {
      case 'already-active':
        console.log('An active Manager already exists — nothing to do.');
        break;
      case 'created':
      case 'resent':
        console.log(
          `${outcome.status === 'created' ? 'Pending Manager created' : 'Activation link re-issued'}; ` +
            (outcome.emailed
              ? 'activation email sent.'
              : 'the activation email could NOT be sent — check the mail configuration and run again.'),
        );
        return outcome.emailed ? 0 : 2;
    }
    return 0;
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
