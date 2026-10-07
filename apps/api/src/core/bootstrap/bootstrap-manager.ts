import { emailSchema, employeeCodeSchema, personNameSchema } from '@smartcode/shared';
import type { AuditLogService } from '../audit/audit-log.service';
import type { AuthTokenService } from '../auth/auth-token.service';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';

export interface BootstrapInput {
  email: string;
  fullName: string;
  employeeCode: string;
}

export type BootstrapOutcome =
  | { status: 'created'; employeeId: string; emailed: boolean; link?: never }
  | { status: 'resent'; employeeId: string; emailed: boolean }
  | { status: 'already-active'; employeeId: string };

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapDeps {
  prisma: PrismaService;
  tokens: AuthTokenService;
  audit: AuditLogService;
  mail: MailService;
}

/**
 * Creates the FIRST Manager through the secure activation workflow — there is no password anywhere:
 *   PENDING_ACTIVATION Manager → single-use activation token (hashed) → email → the Manager chooses a password.
 *
 * Safe to run repeatedly: an active Manager means "nothing to do"; a pending Manager for the same email gets a fresh
 * link (the old one is revoked); a pending Manager for a *different* email is refused rather than duplicated.
 */
export async function bootstrapManager(
  deps: BootstrapDeps,
  rawInput: BootstrapInput,
  options: { onLink?: (url: string) => void; buildLink?: (token: string) => string } = {},
): Promise<BootstrapOutcome> {
  const input = {
    email: emailSchema.parse(rawInput.email),
    fullName: personNameSchema.parse(rawInput.fullName),
    employeeCode: employeeCodeSchema.parse(rawInput.employeeCode),
  };
  const { prisma } = deps;

  const organizations = await prisma.client.organization.findMany({ select: { id: true }, take: 2 });
  if (organizations.length !== 1) {
    throw new BootstrapError(
      organizations.length === 0
        ? 'No organization exists yet. Run the system seed first (pnpm db:seed).'
        : 'More than one organization exists; bootstrap supports exactly one.',
    );
  }
  const organizationId = (organizations[0] as { id: string }).id;

  const active = await prisma.client.employee.findFirst({
    where: { organizationId, role: 'MANAGER', status: 'ACTIVE' },
    select: { id: true },
  });
  if (active) return { status: 'already-active', employeeId: active.id };

  const pending = await prisma.client.employee.findMany({
    where: { organizationId, role: 'MANAGER', status: 'PENDING_ACTIVATION' },
    select: { id: true, email: true, fullName: true, employeeCode: true },
  });
  const sameEmail = pending.find((p) => p.email === input.email);
  if (pending.length > 0 && !sameEmail) {
    throw new BootstrapError(
      'A Manager is already waiting to activate under a different email address. Resend that Manager’s activation link instead of creating a second one.',
    );
  }

  const outcome = await prisma.client.$transaction(async (tx) => {
    let employee = sameEmail ?? null;
    let created = false;
    if (!employee) {
      // Email and Employee ID must be free — nobody is silently converted into a Manager.
      const clash = await tx.employee.findFirst({
        where: {
          OR: [
            { email: input.email },
            { organizationId, employeeCode: { equals: input.employeeCode, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (clash) throw new BootstrapError('An employee with this email or Employee ID already exists.');
      employee = await tx.employee.create({
        data: {
          organizationId,
          employeeCode: input.employeeCode,
          fullName: input.fullName,
          email: input.email,
          role: 'MANAGER',
        },
        select: { id: true, email: true, fullName: true, employeeCode: true },
      });
      created = true;
    }
    const issued = await deps.tokens.issue(tx, employee.id, 'ACTIVATION', null);
    await deps.audit.record(
      {
        organizationId,
        actorId: null,
        actorRole: null,
        action: 'BOOTSTRAP.MANAGER_CREATED',
        entityType: 'Employee',
        entityId: employee.id,
        after: { created, role: 'MANAGER' },
      },
      tx,
    );
    return { employee, token: issued.token, created };
  });

  if (options.onLink && options.buildLink) options.onLink(options.buildLink(outcome.token));
  const emailed = await deps.mail.trySend(
    () => deps.mail.sendActivation({ ...outcome.employee, role: 'MANAGER' }, outcome.token),
    'activation',
  );
  return outcome.created
    ? { status: 'created', employeeId: outcome.employee.id, emailed }
    : { status: 'resent', employeeId: outcome.employee.id, emailed };
}
