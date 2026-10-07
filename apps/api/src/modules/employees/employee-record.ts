import type { EmployeeRecord, Role } from '@smartcode/shared';
import { isLoginNameEligibleRole } from '@smartcode/shared';
import type { Prisma } from '../../generated/prisma/client';

export const EMPLOYEE_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  teamMemberships: {
    where: { endedAt: null },
    take: 1,
    include: {
      team: { select: { id: true, name: true, teamLead: { select: { id: true, fullName: true } } } },
    },
  },
  projectAssignments: {
    where: { endedAt: null },
    include: { project: { select: { id: true, name: true } } },
  },
  loginNameAssignments: {
    where: { endedAt: null },
    take: 1,
    include: { loginName: { select: { value: true } } },
  },
} satisfies Prisma.EmployeeInclude;

export type EmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

/**
 * The directory view of an employee. Contains no credential, token or hash by construction — those tables are
 * never joined here.
 */
export function toEmployeeRecord(e: EmployeeWithRelations): EmployeeRecord {
  const team = e.teamMemberships[0]?.team ?? null;
  const projects = new Map(e.projectAssignments.map((a) => [a.project.id, a.project]));
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    email: e.email,
    role: e.role as Role,
    status: e.status,
    vendor: e.vendor,
    team: team ? { id: team.id, name: team.name } : null,
    teamLead: team?.teamLead ?? null,
    projects: [...projects.values()],
    loginName: e.loginNameAssignments[0]?.loginName.value ?? null,
    loginNameEligible: isLoginNameEligibleRole(e.role as Role),
    createdAt: e.createdAt.toISOString(),
    activatedAt: e.activatedAt?.toISOString() ?? null,
  };
}
