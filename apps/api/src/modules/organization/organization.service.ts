import { Injectable } from '@nestjs/common';
import type { OrganizationRecord, OrganizationUpdate } from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { logEntityChange } from './entity-log';

type Terminology = OrganizationRecord['terminology'];

function readTerminology(settings: unknown): Terminology {
  if (typeof settings !== 'object' || settings === null) return {};
  const raw = (settings as { terminology?: unknown }).terminology;
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Terminology = {};
  for (const key of ['SPC', 'VENDOR', 'LOGIN_NAME', 'EMPLOYEE_ID', 'CHART_ID'] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) out[key] = value;
  }
  return out;
}

/** Organization profile and base settings (time zone, terminology labels). Manager only (`settings.manage`). */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  async get(principal: Principal): Promise<OrganizationRecord> {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: principal.organizationId },
      include: { _count: { select: { employees: true, vendors: true, teams: true } } },
    });
    if (!org) throw new ProblemException(404, 'NOT_FOUND', 'Organization not found');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      timeZone: org.timeZone,
      status: org.status,
      terminology: readTerminology(org.settings),
      counts: { employees: org._count.employees, vendors: org._count.vendors, teams: org._count.teams },
    };
  }

  async update(
    principal: Principal,
    input: OrganizationUpdate,
    meta: RequestMeta,
  ): Promise<OrganizationRecord> {
    const current = await this.prisma.client.organization.findUnique({
      where: { id: principal.organizationId },
    });
    if (!current) throw new ProblemException(404, 'NOT_FOUND', 'Organization not found');

    const settings: Prisma.InputJsonObject = {
      ...(typeof current.settings === 'object' &&
      current.settings !== null &&
      !Array.isArray(current.settings)
        ? (current.settings as Prisma.InputJsonObject)
        : {}),
      ...(input.terminology !== undefined ? { terminology: input.terminology } : {}),
    };

    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'organization updated' },
      async (tx) => {
        await tx.organization.update({
          where: { id: current.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
            ...(input.terminology !== undefined ? { settings } : {}),
          },
        });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'ORGANIZATION.UPDATED',
          { type: 'Organization', id: current.id },
          {
            before: { name: current.name, timeZone: current.timeZone },
            after: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
              ...(input.terminology !== undefined ? { terminologyKeys: Object.keys(input.terminology) } : {}),
            },
          },
        );
      },
    );
    return this.get(principal);
  }
}
