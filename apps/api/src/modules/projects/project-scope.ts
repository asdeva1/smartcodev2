import { scopeFor } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Which projects a person may see. Manager: all. Vendor Admin: their vendor's. Everyone else: only the projects
 * they are currently staffed on. A project outside the scope is "not found", never "forbidden".
 */
export function projectScopeWhere(principal: Principal): Prisma.ProjectWhereInput {
  const scope = scopeFor(principal.role, 'project.read');
  if (!scope)
    throw new ProblemException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  const org = { organizationId: principal.organizationId };
  if (scope === 'ORG') return org;
  if (scope === 'VENDOR') {
    return principal.vendorId ? { ...org, vendorId: principal.vendorId } : { id: { in: [] } };
  }
  return { ...org, assignments: { some: { employeeId: principal.employeeId, endedAt: null } } };
}
