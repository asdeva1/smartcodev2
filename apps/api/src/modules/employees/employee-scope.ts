import type { Scope } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import type { Prisma } from '../../generated/prisma/client';

const NOBODY: Prisma.EmployeeWhereInput = { id: { in: [] } };

/**
 * Which employees a principal may see for a permission scope (docs/03 §2). Built only from the authenticated
 * principal — never from query parameters. Vendor users stay vendor-scoped whatever the scope: the vendor
 * condition is always intersected, so another vendor's employees are invisible (404, not 403).
 */
export function employeeScopeWhere(principal: Principal, scope: Scope): Prisma.EmployeeWhereInput {
  const org: Prisma.EmployeeWhereInput = { organizationId: principal.organizationId };
  const vendor: Prisma.EmployeeWhereInput = principal.vendorId ? { vendorId: principal.vendorId } : {};
  switch (scope) {
    case 'ORG':
      return { AND: [org, vendor] };
    case 'VENDOR':
      return principal.vendorId ? { AND: [org, vendor] } : NOBODY;
    case 'TEAM':
      return {
        AND: [
          org,
          vendor,
          {
            OR: [
              { id: principal.employeeId },
              { teamMemberships: { some: { endedAt: null, team: { teamLeadId: principal.employeeId } } } },
            ],
          },
        ],
      };
    case 'PROJECT':
      return {
        AND: [
          org,
          vendor,
          {
            OR: [
              { id: principal.employeeId },
              {
                projectAssignments: {
                  some: {
                    endedAt: null,
                    project: {
                      assignments: {
                        some: { employeeId: principal.employeeId, projectRole: 'GROUP_COACH', endedAt: null },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      };
    case 'SELF':
      return { AND: [org, { id: principal.employeeId }] };
  }
}
