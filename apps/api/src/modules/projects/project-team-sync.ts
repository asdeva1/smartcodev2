import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';

/** Roles that become project staff through a team. Auditors are always placed on a project by hand. */
const TEAM_STAFF_ROLES = ['CODER', 'GROUP_COACH'] as const;
type DerivedRole = 'TEAM_LEAD' | (typeof TEAM_STAFF_ROLES)[number];

export interface SyncResult {
  added: number;
  ended: number;
}

/**
 * Brings a project's team-derived staff in line with its team: the team's Team Lead (as Project Lead), and every
 * current Coder and Group Coach member. Rows added by hand are never touched, except that a new team lead replaces
 * the previous Project Lead. A person who still holds charts on the project cannot be taken off it (409) — the
 * Manager pulls those charts back first.
 */
export async function syncProjectTeamStaff(
  tx: Tx,
  projectId: string,
  assignedById: string,
): Promise<SyncResult> {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, teamId: true },
  });
  const wanted = new Map<string, DerivedRole>();
  if (project.teamId) {
    const team = await tx.team.findUnique({
      where: { id: project.teamId },
      select: {
        status: true,
        teamLead: { select: { id: true, status: true, role: true } },
        memberships: {
          where: {
            endedAt: null,
            employee: { status: { not: 'INACTIVE' }, role: { in: [...TEAM_STAFF_ROLES] } },
          },
          select: { employee: { select: { id: true, role: true } } },
        },
      },
    });
    if (team?.teamLead && team.teamLead.status !== 'INACTIVE' && team.teamLead.role === 'TEAM_LEAD') {
      wanted.set(team.teamLead.id, 'TEAM_LEAD');
    }
    for (const m of team?.memberships ?? []) wanted.set(m.employee.id, m.employee.role as DerivedRole);
  }

  const current = await tx.projectAssignment.findMany({
    where: { projectId, endedAt: null },
    select: { id: true, employeeId: true, projectRole: true, viaTeamId: true },
  });
  const derived = current.filter((a) => a.viaTeamId !== null);
  const key = (employeeId: string, role: string) => `${employeeId}:${role}`;
  const have = new Set(current.map((a) => key(a.employeeId, a.projectRole)));

  const toEnd = derived.filter(
    (a) => a.viaTeamId !== project.teamId || wanted.get(a.employeeId) !== a.projectRole,
  );
  // A new Project Lead from the team replaces whoever held the lead slot before (by hand or from an earlier team).
  const newLead = [...wanted].find(([, role]) => role === 'TEAM_LEAD')?.[0];
  if (newLead) {
    for (const a of current) {
      if (a.projectRole === 'TEAM_LEAD' && a.employeeId !== newLead && !toEnd.includes(a)) toEnd.push(a);
    }
  }

  for (const a of toEnd.filter((x) => x.projectRole !== 'TEAM_LEAD')) {
    const open = await tx.chartAllocation.count({
      where: { employeeId: a.employeeId, status: 'ACTIVE', chart: { projectId } },
    });
    if (open > 0) {
      throw new ProblemException(
        409,
        'CONFLICT',
        `A team member still holds ${open} chart${open === 1 ? '' : 's'} on a project of this team. Pull them back first.`,
      );
    }
  }

  const endedKeys = new Set(toEnd.map((a) => key(a.employeeId, a.projectRole)));
  if (toEnd.length) {
    await tx.projectAssignment.updateMany({
      where: { id: { in: toEnd.map((a) => a.id) } },
      data: { endedAt: new Date() },
    });
  }
  let added = 0;
  if (project.teamId) {
    for (const [employeeId, role] of wanted) {
      const k = key(employeeId, role);
      if (have.has(k) && !endedKeys.has(k)) continue; // already on the project (by hand or from the team)
      await tx.projectAssignment.create({
        data: { projectId, employeeId, projectRole: role, assignedById, viaTeamId: project.teamId },
      });
      added += 1;
    }
  }
  return { added, ended: toEnd.length };
}

/** Re-syncs every project that is worked by the team (after a membership or Team Lead change). */
export async function syncTeamProjects(tx: Tx, teamId: string, fallbackAssignerId: string): Promise<void> {
  const projects = await tx.project.findMany({
    where: { teamId },
    select: { id: true, teamAssignedById: true },
  });
  for (const p of projects) {
    await syncProjectTeamStaff(tx, p.id, p.teamAssignedById ?? fallbackAssignerId);
  }
}
