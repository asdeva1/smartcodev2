import { Injectable } from '@nestjs/common';
import {
  type Page,
  type VendorCreate,
  type VendorListQuery,
  type VendorRecord,
  type VendorUpdate,
  scopeFor,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { EmployeesService } from '../employees/employees.service';
import { isUniqueViolation, logEntityChange } from '../organization/entity-log';

const VENDOR_INCLUDE = {
  employees: {
    where: { role: 'VENDOR_ADMIN' },
    select: { id: true, fullName: true, email: true, status: true },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { employees: true, teams: true } },
} satisfies Prisma.VendorInclude;

type VendorWithRelations = Prisma.VendorGetPayload<{ include: typeof VENDOR_INCLUDE }>;

function toRecord(v: VendorWithRelations): VendorRecord {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    status: v.status,
    employeeCount: v._count.employees,
    teamCount: v._count.teams,
    admins: v.employees,
    createdAt: v.createdAt.toISOString(),
  };
}

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Vendor not found');

/**
 * Vendor management. A Manager creates the vendor together with its Vendor Admin account (activation email);
 * a Vendor Admin may only read their own vendor. Vendor isolation: another vendor is "not found", never "forbidden".
 */
@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  private scopeWhere(principal: Principal): Prisma.VendorWhereInput {
    const scope = scopeFor(principal.role, 'vendor.read');
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    if (scope === 'ORG' && !principal.vendorId) return { organizationId: principal.organizationId };
    return principal.vendorId
      ? { organizationId: principal.organizationId, id: principal.vendorId }
      : { id: { in: [] } };
  }

  async list(principal: Principal, query: VendorListQuery): Promise<Page<VendorRecord>> {
    const filters: Prisma.VendorWhereInput[] = [this.scopeWhere(principal)];
    if (query.status) filters.push({ status: query.status });
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      filters.push({ OR: [{ name: contains }, { code: contains }] });
    }
    const where: Prisma.VendorWhereInput = { AND: filters };
    const [total, rows] = await this.prisma.client.$transaction([
      this.prisma.client.vendor.count({ where }),
      this.prisma.client.vendor.findMany({
        where,
        include: VENDOR_INCLUDE,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toRecord), page: query.page, pageSize: query.pageSize, total };
  }

  async get(principal: Principal, id: string): Promise<VendorRecord> {
    return toRecord(await this.load(principal, id));
  }

  private async load(principal: Principal, id: string): Promise<VendorWithRelations> {
    const found = await this.prisma.client.vendor.findFirst({
      where: { AND: [{ id }, this.scopeWhere(principal)] },
      include: VENDOR_INCLUDE,
    });
    if (!found) throw notFound();
    return found;
  }

  // ───────── create (Manager) ─────────

  async create(principal: Principal, input: VendorCreate, meta: RequestMeta): Promise<VendorRecord> {
    const organizationId = principal.organizationId;
    await this.assertVendorFree(organizationId, input.code, input.name);
    await this.employees.assertIdentityFree(input.admin.employeeCode, input.admin.email, organizationId);

    let vendorId: string;
    try {
      const vendor = await this.prisma.client.vendor.create({
        data: { organizationId, code: input.code, name: input.name },
        select: { id: true },
      });
      vendorId = vendor.id;
    } catch (error) {
      if (isUniqueViolation(error))
        throw this.conflict('name', 'A vendor with this name or code already exists');
      throw error;
    }

    try {
      await this.employees.create(
        principal,
        {
          employeeCode: input.admin.employeeCode,
          fullName: input.admin.fullName,
          email: input.admin.email,
          role: 'VENDOR_ADMIN',
          vendorId,
          sendActivation: input.sendActivation,
        },
        meta,
      );
    } catch (error) {
      // The vendor has no data yet, so it is safe to remove it again: a vendor is only ever created with its admin.
      await this.prisma.client.vendor.delete({ where: { id: vendorId } }).catch(() => undefined);
      throw error;
    }

    await this.prisma.transaction({ actorId: principal.employeeId, reason: 'vendor created' }, (tx) =>
      logEntityChange(
        { audit: this.audit, activity: this.activity },
        tx,
        principal,
        meta,
        'VENDOR.CREATED',
        { type: 'Vendor', id: vendorId },
        {
          after: { code: input.code, name: input.name },
        },
      ),
    );
    return this.get(principal, vendorId);
  }

  // ───────── update / status (Manager) ─────────

  async update(
    principal: Principal,
    id: string,
    input: VendorUpdate,
    meta: RequestMeta,
  ): Promise<VendorRecord> {
    const current = await this.load(principal, id);
    if (input.name !== undefined && input.name !== current.name) {
      await this.assertVendorFree(principal.organizationId, null, input.name, id);
    }
    try {
      await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'vendor updated' },
        async (tx) => {
          await tx.vendor.update({
            where: { id },
            data: { ...(input.name !== undefined ? { name: input.name } : {}) },
          });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'VENDOR.UPDATED',
            { type: 'Vendor', id },
            {
              before: { name: current.name },
              after: { name: input.name ?? current.name },
            },
          );
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw this.conflict('name', 'A vendor with this name already exists');
      throw error;
    }
    return this.get(principal, id);
  }

  async deactivate(principal: Principal, id: string, meta: RequestMeta): Promise<VendorRecord> {
    const current = await this.load(principal, id);
    if (current.status === 'INACTIVE') return toRecord(current);
    const blocking = await this.prisma.client.employee.count({
      where: { vendorId: id, status: { not: 'INACTIVE' } },
    });
    if (blocking > 0) {
      throw new ProblemException(
        409,
        'CONFLICT',
        `Deactivate the vendor's ${blocking} active or pending employee${blocking === 1 ? '' : 's'} first`,
      );
    }
    await this.setStatus(principal, id, 'INACTIVE', 'VENDOR.DEACTIVATED', meta);
    return this.get(principal, id);
  }

  async reactivate(principal: Principal, id: string, meta: RequestMeta): Promise<VendorRecord> {
    const current = await this.load(principal, id);
    if (current.status === 'ACTIVE') return toRecord(current);
    await this.setStatus(principal, id, 'ACTIVE', 'VENDOR.REACTIVATED', meta);
    return this.get(principal, id);
  }

  private setStatus(
    principal: Principal,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    action: 'VENDOR.DEACTIVATED' | 'VENDOR.REACTIVATED',
    meta: RequestMeta,
  ) {
    return this.prisma.transaction({ actorId: principal.employeeId, reason: 'vendor status' }, async (tx) => {
      await tx.vendor.update({ where: { id }, data: { status } });
      await logEntityChange(
        { audit: this.audit, activity: this.activity },
        tx,
        principal,
        meta,
        action,
        { type: 'Vendor', id },
        { after: { status } },
      );
    });
  }

  // ───────── helpers ─────────

  private async assertVendorFree(
    organizationId: string,
    code: string | null,
    name: string,
    ignoreId?: string,
  ): Promise<void> {
    const ignore = ignoreId ? { id: { not: ignoreId } } : {};
    const [byCode, byName] = await Promise.all([
      code
        ? this.prisma.client.vendor.findFirst({
            where: { organizationId, code: { equals: code, mode: 'insensitive' }, ...ignore },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.client.vendor.findFirst({
        where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...ignore },
        select: { id: true },
      }),
    ]);
    if (byCode) throw this.conflict('code', 'This vendor code is already in use');
    if (byName) throw this.conflict('name', 'A vendor with this name already exists');
  }

  private conflict(field: string, message: string) {
    return new ProblemException(409, 'CONFLICT', message, [{ field, message }]);
  }
}
