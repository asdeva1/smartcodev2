import { Injectable } from '@nestjs/common';
import {
  type CsvPreview,
  type CsvPreviewRow,
  type CsvResult,
  type CsvRowStatus,
  type Role,
  CsvError,
  EMPLOYEE_CSV_COLUMNS,
  LOGIN_NAME_CSV_COLUMNS,
  ROLES,
  VENDOR_STAFF_ROLES,
  emailSchema,
  employeeCodeSchema,
  isLoginNameEligibleRole,
  loginNameSchema,
  normaliseHeader,
  parseCsv,
  personNameSchema,
  scopeFor,
  startsWithFormulaTrigger,
} from '@smartcode/shared';
import { Prisma as PrismaNs } from '../../generated/prisma/client';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LoginNamesService } from './login-names.service';

const ROLE_ALIASES: Record<string, Role> = {
  manager: 'MANAGER',
  hr: 'HR',
  groupcoach: 'GROUP_COACH',
  groupcoachsme: 'GROUP_COACH',
  sme: 'GROUP_COACH',
  teamlead: 'TEAM_LEAD',
  auditor: 'AUDITOR',
  coder: 'CODER',
  vendoradmin: 'VENDOR_ADMIN',
};

export function parseRole(text: string): Role | null {
  const direct = ROLES.find((r) => r === text.trim().toUpperCase());
  return direct ?? ROLE_ALIASES[normaliseHeader(text)] ?? null;
}

interface Draft {
  line: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

function finish(drafts: Draft[], fileErrors: string[]): CsvPreview {
  const rows: CsvPreviewRow[] = drafts.map((d) => {
    const status: CsvRowStatus = d.errors.length ? 'INVALID' : d.duplicate ? 'DUPLICATE' : 'VALID';
    return { line: d.line, status, values: d.values, errors: d.errors, warnings: d.warnings };
  });
  const count = (s: CsvRowStatus) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    valid: count('VALID'),
    invalid: count('INVALID'),
    duplicates: count('DUPLICATE'),
    warnings: rows.filter((r) => r.warnings.length).length,
    rows,
    fileErrors,
  };
}

/** Marks every occurrence of a repeated key (not just the second) so nothing ambiguous is committed. */
function markRepeats(
  drafts: Draft[],
  keyOf: (d: Draft) => string | null,
  message: (lines: number[]) => string,
) {
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const key = keyOf(d);
    if (key) groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const lines = group.map((d) => d.line);
    for (const d of group) {
      d.duplicate = true;
      d.errors.push(message(lines.filter((l) => l !== d.line)));
    }
  }
}

function readCsv(
  csv: string,
  required: readonly string[],
  forbidden: string[],
): { parsed: ReturnType<typeof parseCsv> | null; fileErrors: string[] } {
  try {
    const parsed = parseCsv(csv);
    const present = new Set(parsed.headers.map(normaliseHeader));
    const fileErrors: string[] = [];
    for (const column of required) {
      if (!present.has(normaliseHeader(column))) fileErrors.push(`The file needs a "${column}" column`);
    }
    for (const bad of forbidden) {
      if (present.has(normaliseHeader(bad)))
        fileErrors.push(`Remove the "${bad}" column — it is not part of this import`);
    }
    const allowed = new Set(required.map(normaliseHeader));
    for (const header of parsed.headers) {
      if (
        !allowed.has(normaliseHeader(header)) &&
        !forbidden.some((f) => normaliseHeader(f) === normaliseHeader(header))
      ) {
        fileErrors.push(`Unknown column "${header}" — allowed columns: ${required.join(', ')}`);
      }
    }
    return { parsed, fileErrors };
  } catch (error) {
    if (error instanceof CsvError) return { parsed: null, fileErrors: [error.message] };
    throw error;
  }
}

/** Bulk employee creation: Employee Name, Employee ID, Email, Role → Pending employees. No passwords, no Login Names, no Team. */
@Injectable()
export class EmployeeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  private scope(principal: Principal) {
    const scope = scopeFor(principal.role, 'employee.create');
    if (!scope)
      throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    return scope;
  }

  async preview(principal: Principal, csv: string): Promise<CsvPreview> {
    return (await this.validate(principal, csv)).preview;
  }

  private async validate(principal: Principal, csv: string) {
    const scope = this.scope(principal);
    const { parsed, fileErrors } = readCsv(csv, EMPLOYEE_CSV_COLUMNS, ['Password', 'Login Name', 'Team']);
    if (!parsed || fileErrors.length)
      return { preview: finish([], fileErrors), valid: [] as ValidEmployeeRow[] };

    const drafts: Draft[] = parsed.rows.map((row) => ({
      line: row.line,
      values: {
        'Employee Name': row.cells['employeename'] ?? '',
        'Employee ID': row.cells['employeeid'] ?? '',
        Email: row.cells['email'] ?? '',
        Role: row.cells['role'] ?? '',
      },
      errors: [],
      warnings: [],
      duplicate: false,
    }));
    const parsedValues = new Map<
      Draft,
      { fullName: string; employeeCode: string; email: string; role: Role }
    >();

    for (const d of drafts) {
      const name = personNameSchema.safeParse(d.values['Employee Name']);
      const code = employeeCodeSchema.safeParse(d.values['Employee ID']);
      const email = emailSchema.safeParse(d.values['Email']);
      const role = parseRole(d.values['Role'] ?? '');
      if (!name.success)
        d.errors.push(d.values['Employee Name'] ? 'Employee Name is not valid' : 'Employee Name is required');
      else if (startsWithFormulaTrigger(name.data))
        d.errors.push('Employee Name cannot start with = + - or @');
      if (!code.success) d.errors.push(code.error.issues[0]?.message ?? 'Employee ID is not valid');
      if (!email.success)
        d.errors.push(
          d.values['Email']
            ? 'Enter a valid email address'
            : 'Email is required — placeholder emails are not allowed',
        );
      if (!role) d.errors.push(`Role "${d.values['Role']}" is not recognised (use ${ROLES.join(', ')})`);
      else if (role === 'VENDOR_ADMIN')
        d.errors.push('Vendor Admin accounts are created from the vendor, not by import');
      else if (scope === 'VENDOR' && !VENDOR_STAFF_ROLES.includes(role))
        d.errors.push('You can only import Team Leads, Auditors and Coders');
      if (name.success && code.success && email.success && role) {
        parsedValues.set(d, { fullName: name.data, employeeCode: code.data, email: email.data, role });
      }
    }

    markRepeats(
      drafts,
      (d) => parsedValues.get(d)?.employeeCode.toLowerCase() ?? null,
      (l) => `Employee ID is repeated on line ${l.join(', ')}`,
    );
    markRepeats(
      drafts,
      (d) => parsedValues.get(d)?.email ?? null,
      (l) => `Email is repeated on line ${l.join(', ')}`,
    );

    // Existing records (Employee ID is per organization, email is global).
    const codes = [...new Set([...parsedValues.values()].map((v) => v.employeeCode.toLowerCase()))];
    const emails = [...new Set([...parsedValues.values()].map((v) => v.email))];
    if (codes.length) {
      const existing = await this.prisma.client.$queryRaw<{ code: string; email: string }[]>(PrismaNs.sql`
        SELECT lower(employee_code) AS code, email FROM employees
        WHERE (organization_id = ${principal.organizationId}::uuid AND lower(employee_code) = ANY(${codes}::text[]))
           OR email = ANY(${emails}::text[])`);
      const takenCodes = new Set(existing.map((e) => e.code));
      const takenEmails = new Set(existing.map((e) => e.email));
      for (const d of drafts) {
        const v = parsedValues.get(d);
        if (!v) continue;
        if (takenCodes.has(v.employeeCode.toLowerCase())) {
          d.duplicate = true;
          d.errors.push('An employee with this Employee ID already exists');
        }
        if (takenEmails.has(v.email)) {
          d.duplicate = true;
          d.errors.push('An employee with this email already exists');
        }
      }
    }
    const preview = finish(drafts, []);
    const valid: ValidEmployeeRow[] = preview.rows
      .map((r, i) => ({ r, v: parsedValues.get(drafts[i] as Draft) }))
      .filter((x) => x.r.status === 'VALID' && x.v)
      .map((x) => ({ line: x.r.line, ...(x.v as NonNullable<typeof x.v>) }));
    return { preview, valid };
  }

  async commit(
    principal: Principal,
    csv: string,
    mode: 'valid-only' | 'all-or-nothing',
    meta: RequestMeta,
  ): Promise<CsvResult> {
    const scope = this.scope(principal);
    const { preview, valid } = await this.validate(principal, csv);
    const blocked =
      preview.fileErrors.length > 0 ||
      (mode === 'all-or-nothing' && preview.valid !== preview.total) ||
      valid.length === 0;
    if (blocked) return { committed: false, created: 0, skipped: preview.total, createdIds: [], preview };

    const vendorId = scope === 'VENDOR' ? principal.vendorId : null;
    const createdIds = await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'employee import' },
      async (tx) => {
        const ids: string[] = [];
        for (const row of valid) {
          const created = await tx.employee.create({
            data: {
              organizationId: principal.organizationId,
              employeeCode: row.employeeCode,
              fullName: row.fullName,
              email: row.email,
              role: row.role,
              vendorId,
              createdById: principal.employeeId,
            },
            select: { id: true },
          });
          ids.push(created.id);
          await this.audit.record(
            {
              organizationId: principal.organizationId,
              actorId: principal.employeeId,
              actorRole: principal.role,
              action: 'EMPLOYEE.CREATED',
              entityType: 'Employee',
              entityId: created.id,
              after: { employeeCode: row.employeeCode, role: row.role, vendorId, source: 'csv' },
              ipAddress: meta.ip,
              requestId: meta.requestId,
            },
            tx,
          );
        }
        await this.audit.record(
          {
            organizationId: principal.organizationId,
            actorId: principal.employeeId,
            actorRole: principal.role,
            action: 'EMPLOYEE.IMPORTED',
            entityType: 'EmployeeImport',
            after: { created: ids.length, skipped: preview.total - ids.length, mode },
            ipAddress: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        await this.activity.record(
          {
            organizationId: principal.organizationId,
            actorId: principal.employeeId,
            action: 'EMPLOYEE.IMPORTED',
            entityType: 'EmployeeImport',
            metadata: { created: ids.length },
          },
          tx,
        );
        return ids;
      },
      { timeoutMs: 60_000 },
    );
    return {
      committed: true,
      created: createdIds.length,
      skipped: preview.total - createdIds.length,
      createdIds,
      preview,
    };
  }
}

interface ValidEmployeeRow {
  line: number;
  fullName: string;
  employeeCode: string;
  email: string;
  role: Role;
}

/** Bulk Login Name assignment: Employee Email, Login Name (Manager only). */
@Injectable()
export class LoginNameImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loginNames: LoginNamesService,
  ) {}

  async preview(principal: Principal, csv: string): Promise<CsvPreview> {
    return (await this.validate(principal, csv)).preview;
  }

  private async validate(principal: Principal, csv: string) {
    const { parsed, fileErrors } = readCsv(csv, LOGIN_NAME_CSV_COLUMNS, ['Password']);
    if (!parsed || fileErrors.length) return { preview: finish([], fileErrors), apply: [] as ApplyRow[] };

    const drafts: Draft[] = parsed.rows.map((row) => ({
      line: row.line,
      values: {
        'Login Name': row.cells['loginname'] ?? '',
        Email: row.cells['email'] ?? '',
      },
      errors: [],
      warnings: [],
      duplicate: false,
    }));
    const parsedValues = new Map<Draft, { email: string; loginName: string }>();
    for (const d of drafts) {
      const email = emailSchema.safeParse(d.values.Email);
      const loginName = loginNameSchema.safeParse(d.values['Login Name']);
      if (!email.success) d.errors.push(d.values.Email ? 'Enter a valid email address' : 'Email is required');
      if (!loginName.success) d.errors.push(loginName.error.issues[0]?.message ?? 'Login Name is not valid');
      if (email.success && loginName.success)
        parsedValues.set(d, { email: email.data, loginName: loginName.data });
    }
    markRepeats(
      drafts,
      (d) => parsedValues.get(d)?.email ?? null,
      (l) => `This employee appears again on line ${l.join(', ')}`,
    );
    markRepeats(
      drafts,
      (d) => parsedValues.get(d)?.loginName.toLowerCase() ?? null,
      (l) => `This Login Name is repeated on line ${l.join(', ')}`,
    );

    const emails = [...new Set([...parsedValues.values()].map((v) => v.email))];
    const names = [...new Set([...parsedValues.values()].map((v) => v.loginName))];
    const [employees, existingNames] = await Promise.all([
      this.prisma.client.employee.findMany({
        where: { organizationId: principal.organizationId, email: { in: emails } },
        include: { loginNameAssignments: { where: { endedAt: null }, include: { loginName: true } } },
      }),
      this.prisma.client.loginName.findMany({
        where: {
          organizationId: principal.organizationId,
          OR: names.map((value) => ({ value: { equals: value, mode: 'insensitive' as const } })),
        },
        include: {
          assignments: {
            where: { endedAt: null },
            include: { employee: { select: { id: true, employeeCode: true } } },
          },
        },
      }),
    ]);
    const byEmail = new Map(employees.map((e) => [e.email, e]));
    const byName = new Map(existingNames.map((n) => [n.value.toLowerCase(), n]));
    const withAllocations = new Set(
      (
        await this.prisma.client.chartAllocation.findMany({
          where: { employeeId: { in: employees.map((e) => e.id) }, status: 'ACTIVE' },
          select: { employeeId: true },
          distinct: ['employeeId'],
        })
      ).map((a) => a.employeeId),
    );

    const apply = new Map<Draft, ApplyRow>();
    for (const d of drafts) {
      const v = parsedValues.get(d);
      if (!v) continue;
      const employee = byEmail.get(v.email);
      if (!employee) {
        d.errors.push('No employee has this email address');
        continue;
      }
      if (employee.status === 'PENDING_ACTIVATION')
        d.errors.push('This employee has not activated their account yet');
      else if (employee.status !== 'ACTIVE') d.errors.push('This employee is inactive');
      else if (!isLoginNameEligibleRole(employee.role as Role))
        d.errors.push(`The ${employee.role} role does not use a Login Name`);
      const holdsName = employee.loginNameAssignments[0]?.loginName.value ?? null;
      const existing = byName.get(v.loginName.toLowerCase());
      const holder = existing?.assignments[0];
      if (existing && existing.status !== 'ACTIVE') d.errors.push('This Login Name is retired');
      if (holder && holder.employeeId !== employee.id) {
        d.errors.push(`This Login Name is already assigned to ${holder.employee.employeeCode}`);
      }
      if (holdsName && holdsName.toLowerCase() === v.loginName.toLowerCase()) {
        d.warnings.push('No change — the employee already has this Login Name');
      } else if (holdsName) {
        if (withAllocations.has(employee.id))
          d.errors.push(
            'This employee still holds allocated charts — reallocate them before changing the Login Name',
          );
        else d.warnings.push(`Replaces the current Login Name "${holdsName}"`);
      }
      if (!d.errors.length) {
        apply.set(d, {
          line: d.line,
          employeeId: employee.id,
          loginName: v.loginName,
          unchanged: d.warnings.some((w) => w.startsWith('No change')),
        });
      }
    }
    const preview = finish(drafts, []);
    const applyRows = preview.rows
      .map((r, i) => (r.status === 'VALID' ? apply.get(drafts[i] as Draft) : undefined))
      .filter((x): x is ApplyRow => Boolean(x));
    return { preview, apply: applyRows };
  }

  async commit(
    principal: Principal,
    csv: string,
    mode: 'valid-only' | 'all-or-nothing',
    meta: RequestMeta,
  ): Promise<CsvResult> {
    const { preview, apply } = await this.validate(principal, csv);
    const changing = apply.filter((a) => !a.unchanged);
    const blocked =
      preview.fileErrors.length > 0 ||
      (mode === 'all-or-nothing' && preview.valid !== preview.total) ||
      apply.length === 0;
    if (blocked) return { committed: false, created: 0, skipped: preview.total, createdIds: [], preview };

    let assigned = 0;
    if (mode === 'all-or-nothing') {
      assigned = await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'login name import' },
        async (tx) => {
          let n = 0;
          for (const row of changing) {
            await this.loginNames.assign(principal, row.employeeId, row.loginName, meta, tx);
            n += 1;
          }
          return n;
        },
        { timeoutMs: 60_000 },
      );
    } else {
      for (const row of changing) {
        try {
          await this.loginNames.assign(principal, row.employeeId, row.loginName, meta);
          assigned += 1;
        } catch (error) {
          // Changed since the preview (re-validated at commit): leave this row out and keep going.
          if (!(error instanceof ProblemException)) throw error;
        }
      }
    }
    return { committed: true, created: assigned, skipped: preview.total - assigned, createdIds: [], preview };
  }
}

interface ApplyRow {
  line: number;
  employeeId: string;
  loginName: string;
  unchanged: boolean;
}
