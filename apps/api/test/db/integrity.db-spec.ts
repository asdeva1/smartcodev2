import {
  ACTIVE_STATUSES,
  ALLOCATION_SOURCES,
  ALLOCATION_STATUSES,
  ALLOCATION_TYPES,
  APPROVAL_STATUSES,
  ASSIGNMENT_END_REASONS,
  AUDIT_RESULTS,
  AUDIT_STATUSES,
  AUTH_TOKEN_TYPES,
  CHART_STATUSES,
  EMPLOYEE_STATUSES,
  LOGIN_NAME_END_REASONS,
  ORGANIZATION_STATUSES,
  PRODUCTION_STATUSES,
  PROJECT_ROLES,
  PROJECT_STATUSES,
  RESOLUTION_DECISIONS,
  REWORK_STATUSES,
  ROLES,
} from '@smartcode/shared';
import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

describeDb('Vendor isolation, teams, foreign keys, logs and shared-enum parity (PostgreSQL)', () => {
  let db: TestDb;
  let fx: Fixtures;
  let orgId: string;
  let manager: Awaited<ReturnType<Fixtures['manager']>>;

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
  });
  // Every test gets its own organization + Manager so tests cannot influence each other.
  beforeEach(async () => {
    orgId = await fx.org();
    manager = await fx.manager();
  });
  afterAll(async () => db?.close());

  describe('Vendor tenant boundaries', () => {
    it('15. keeps every vendor employee tied to their vendor, with an index for vendor-scoped queries', async () => {
      const vendorA = await fx.vendor('Vendor A');
      const vendorB = await fx.vendor('Vendor B');
      const a = await fx.employee({ role: 'CODER', vendorId: vendorA.id });
      const b = await fx.employee({ role: 'CODER', vendorId: vendorB.id });
      await fx.employee({ role: 'CODER' }); // in-house

      const scopedToA = await db.prisma.employee.findMany({
        where: { organizationId: orgId, vendorId: vendorA.id },
      });
      expect(scopedToA.map((e) => e.id)).toEqual([a.id]);
      expect(scopedToA.some((e) => e.id === b.id)).toBe(false);

      // A vendor employee cannot be moved to another vendor, and vendor staff must reference a real vendor.
      await expectPgError(db.sql(`UPDATE employees SET vendor_id = $2 WHERE id = $1`, [a.id, vendorB.id]), {
        code: PG.conflict,
      });
      await expectPgError(
        db.sql(
          `INSERT INTO employees (id, organization_id, employee_code, full_name, email, role, vendor_id, updated_at)
           VALUES (gen_random_uuid(), $1, 'GHOST-VENDOR', 'X', 'ghost@example.test', 'CODER', gen_random_uuid(), now())`,
          [orgId],
        ),
        { code: PG.foreignKey },
      );
      const indexes = await db.sql<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'employees'`,
      );
      expect(indexes.map((i) => i.indexname)).toContain('employees_vendor_id_status_idx');
    });

    it('does not let vendor staff work on another vendor’s or an in-house project', async () => {
      const vendorA = await fx.vendor();
      const vendorB = await fx.vendor();
      const projectA = await fx.project({ vendorId: vendorA.id });
      const projectB = await fx.project({ vendorId: vendorB.id });
      const inHouse = await fx.project();
      const coderA = await fx.employee({ role: 'CODER', vendorId: vendorA.id });
      await fx.assignProject(projectA.id, coderA.id, 'CODER', manager.id);
      await expectPgError(
        db.sql(
          `INSERT INTO project_assignments (id, project_id, employee_id, project_role, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, 'CODER', $3)`,
          [projectB.id, coderA.id, manager.id],
        ),
        { code: PG.invalid, message: /own vendor/ },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO project_assignments (id, project_id, employee_id, project_role, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, 'CODER', $3)`,
          [inHouse.id, coderA.id, manager.id],
        ),
        { code: PG.invalid },
      );
    });

    it('does not allocate a vendor’s charts to another vendor’s coder, and audits stay inside the vendor', async () => {
      const vendorA = await fx.vendor();
      const vendorB = await fx.vendor();
      const projectA = await fx.project({ vendorId: vendorA.id });
      const chart = await fx.chart(projectA.id);
      const coderB = await fx.employee({ role: 'CODER', vendorId: vendorB.id });
      const loginB = await fx.loginName();
      await fx.assignLoginName(loginB.id, coderB.id, manager.id);
      await expectPgError(
        db.sql(
          `INSERT INTO chart_allocations (id, chart_id, login_name_id, employee_id, allocated_by_id, source, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'MANUAL', now())`,
          [chart.id, loginB.id, coderB.id, manager.id],
        ),
        { code: PG.invalid, message: /another vendor/ },
      );
      // The vendor's own coder works (vendor coders need no per-person project assignment).
      const coderA = await fx.employee({ role: 'CODER', vendorId: vendorA.id });
      const loginA = await fx.loginName();
      await fx.assignLoginName(loginA.id, coderA.id, manager.id);
      await fx.allocate(chart.id, loginA.id, coderA.id, manager.id);
    });

    it('limits a team and its lead to one vendor scope, and Team Name is not globally unique', async () => {
      const vendorA = await fx.vendor();
      const vendorB = await fx.vendor();
      const teamA = await db.prisma.team.create({
        data: { organizationId: orgId, vendorId: vendorA.id, name: 'Alpha' },
      });
      const teamB = await db.prisma.team.create({
        data: { organizationId: orgId, vendorId: vendorB.id, name: 'Alpha' },
      });
      const inHouse = await db.prisma.team.create({ data: { organizationId: orgId, name: 'Alpha' } });
      expect(new Set([teamA.id, teamB.id, inHouse.id]).size).toBe(3);

      await expectPgError(
        db.sql(
          `INSERT INTO teams (id, organization_id, vendor_id, name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'alpha', now())`,
          [orgId, vendorA.id],
        ),
        {
          code: PG.unique,
          constraint: 'teams_vendor_name_ci_key',
        },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO teams (id, organization_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'ALPHA', now())`,
          [orgId],
        ),
        {
          code: PG.unique,
          constraint: 'teams_inhouse_name_ci_key',
        },
      );

      const leadB = await fx.employee({ role: 'TEAM_LEAD', vendorId: vendorB.id });
      await expectPgError(db.sql(`UPDATE teams SET team_lead_id = $2 WHERE id = $1`, [teamA.id, leadB.id]), {
        code: PG.invalid,
        message: /same vendor scope/,
      });
      await db.sql(`UPDATE teams SET team_lead_id = $2 WHERE id = $1`, [teamB.id, leadB.id]);
      const coderA = await fx.employee({ role: 'CODER', vendorId: vendorA.id });
      await expectPgError(
        db.sql(`INSERT INTO team_memberships (id, team_id, employee_id) VALUES (gen_random_uuid(), $1, $2)`, [
          teamB.id,
          coderA.id,
        ]),
        { code: PG.invalid },
      );
      await db.prisma.teamMembership.create({ data: { teamId: teamA.id, employeeId: coderA.id } });
      await expectPgError(
        db.sql(`INSERT INTO team_memberships (id, team_id, employee_id) VALUES (gen_random_uuid(), $1, $2)`, [
          teamA.id,
          coderA.id,
        ]),
        {
          code: PG.unique,
          constraint: 'team_memberships_one_current_key',
        },
      );
    });
  });

  describe('Foreign keys', () => {
    it('14. rejects invalid foreign-key relationships', async () => {
      const w = await fx.workspace();
      const ghost = '0192f000-0000-7000-8000-00000000dead';
      await expectPgError(
        db.sql(
          `INSERT INTO charts (id, organization_id, project_id, chart_ref, updated_at) VALUES (gen_random_uuid(), $1, $2, 'ORPHAN', now())`,
          [orgId, ghost],
        ),
        { code: PG.foreignKey },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO projects (id, organization_id, client_id, name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'No client', now())`,
          [orgId, ghost],
        ),
        { code: PG.foreignKey },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO chart_allocations (id, chart_id, login_name_id, employee_id, allocated_by_id, source, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'MANUAL', now())`,
          [ghost, w.loginName.id, w.coder.id, w.manager.id],
        ),
        { code: PG.foreignKey },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO notifications (id, organization_id, recipient_id, type, subject) VALUES (gen_random_uuid(), $1, $2, 'TEST.NOTE', 'x')`,
          [orgId, ghost],
        ),
        { code: PG.foreignKey },
      );
      // A parent that still has children can never be removed.
      await expectPgError(db.sql(`DELETE FROM organizations WHERE id = $1`, [orgId]), {
        code: PG.foreignKey,
      });
      await expectPgError(db.sql(`DELETE FROM projects WHERE id = $1`, [w.project.id]), {
        code: PG.conflict,
      });
    });

    it('keeps a project’s client/vendor fixed once charts exist and ties a project to a client of its organization', async () => {
      const w = await fx.workspace();
      const other = await fx.client();
      await expectPgError(
        db.sql(`UPDATE projects SET client_id = $2 WHERE id = $1`, [w.project.id, other.id]),
        { code: PG.conflict },
      );
      const project = await fx.project({ name: 'Duplicate guard' });
      await expectPgError(
        db.sql(
          `INSERT INTO projects (id, organization_id, client_id, name, updated_at) VALUES (gen_random_uuid(), $1, $2, 'DUPLICATE GUARD', now())`,
          [orgId, project.clientId],
        ),
        { code: PG.unique, constraint: 'projects_client_name_ci_key' },
      );
    });

    it('creates a project assignment only for an existing employee with a matching role', async () => {
      const project = await fx.project();
      const coder = await fx.employee({ role: 'CODER' });
      await expectPgError(
        db.sql(
          `INSERT INTO project_assignments (id, project_id, employee_id, project_role, assigned_by_id) VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'CODER', $2)`,
          [project.id, manager.id],
        ),
        { code: PG.foreignKey },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO project_assignments (id, project_id, employee_id, project_role, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, 'AUDITOR', $3)`,
          [project.id, coder.id, manager.id],
        ),
        { code: PG.invalid, message: /does not match/ },
      );
      await fx.assignProject(project.id, coder.id, 'CODER', manager.id);
      await expectPgError(
        db.sql(
          `INSERT INTO project_assignments (id, project_id, employee_id, project_role, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, 'CODER', $3)`,
          [project.id, coder.id, manager.id],
        ),
        { code: PG.unique, constraint: 'project_assignments_one_active_key' },
      );
    });
  });

  describe('Notifications, approvals, activity and audit logs', () => {
    it('stores notifications that can only be marked read once', async () => {
      const n = await db.prisma.notification.create({
        data: {
          organizationId: orgId,
          recipientId: manager.id,
          type: 'AUDIT.REVIEW_REQUIRED',
          subject: 'Audit needs review',
          entityType: 'AUDIT',
          entityId: manager.id,
        },
      });
      expect(n.readAt).toBeNull();
      await db.prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
      await expectPgError(db.sql(`UPDATE notifications SET read_at = now() WHERE id = $1`, [n.id]), {
        code: PG.conflict,
      });
      await expectPgError(db.sql(`UPDATE notifications SET subject = 'edited' WHERE id = $1`, [n.id]), {
        code: PG.conflict,
      });
      await expectPgError(
        db.sql(
          `INSERT INTO notifications (id, organization_id, recipient_id, type, subject) VALUES (gen_random_uuid(), $1, $2, 'bad type', 'x')`,
          [orgId, manager.id],
        ),
        { code: PG.check },
      );
    });

    it('supports the universal approval engine: one pending request per subject, resolved once, never by the requester', async () => {
      const requester = await fx.employee({ role: 'TEAM_LEAD' });
      const entityId = manager.id;
      const request = await db.prisma.approvalRequest.create({
        data: {
          organizationId: orgId,
          type: 'EMPLOYEE.DEACTIVATION',
          entityType: 'EMPLOYEE',
          entityId,
          requesterId: requester.id,
          comments: 'Synthetic request',
        },
      });
      await db.prisma.approvalStep.create({
        data: { requestId: request.id, stepOrder: 1, approverRole: 'MANAGER' },
      });
      await expectPgError(
        db.sql(
          `INSERT INTO approval_requests (id, organization_id, type, entity_type, entity_id, requester_id, updated_at) VALUES (gen_random_uuid(), $1, 'EMPLOYEE.DEACTIVATION', 'EMPLOYEE', $2, $3, now())`,
          [orgId, entityId, requester.id],
        ),
        { code: PG.unique, constraint: 'approval_requests_one_pending_key' },
      );
      await expectPgError(
        db.sql(
          `UPDATE approval_requests SET status = 'APPROVED', decision = 'APPROVED', resolved_at = now(), resolved_by_id = $2 WHERE id = $1`,
          [request.id, requester.id],
        ),
        { code: PG.forbidden, message: /requester/ },
      );
      await db.sql(
        `UPDATE approval_requests SET status = 'APPROVED', decision = 'APPROVED', resolved_at = now(), resolved_by_id = $2 WHERE id = $1`,
        [request.id, manager.id],
      );
      await expectPgError(
        db.sql(`UPDATE approval_requests SET status = 'REJECTED', decision = 'REJECTED' WHERE id = $1`, [
          request.id,
        ]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM approval_requests WHERE id = $1`, [request.id]), {
        code: PG.conflict,
      });
      await expectPgError(
        db.sql(`UPDATE approval_requests SET status = 'APPROVED' WHERE id = $1`, [request.id]),
        { code: PG.conflict },
      );
    });

    it('keeps the activity log and audit log append-only and free of secrets / PHI', async () => {
      await db.prisma.activityLog.create({
        data: {
          organizationId: orgId,
          actorId: manager.id,
          action: 'CHART.ALLOCATED',
          entityType: 'CHART',
          entityId: manager.id,
          metadata: { count: 120, method: 'CSV' },
        },
      });
      const log = await db.prisma.auditLog.create({
        data: {
          organizationId: orgId,
          actorId: manager.id,
          actorRole: 'MANAGER',
          action: 'LOGIN_NAME.ASSIGNED',
          entityType: 'EMPLOYEE',
          entityId: manager.id,
          afterData: { loginName: 'SC.TEST' },
          requestId: 'req-1',
        },
      });
      await expectPgError(db.sql(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [log.id]), {
        code: PG.conflict,
        message: /append-only/,
      });
      await expectPgError(db.sql(`DELETE FROM audit_logs WHERE id = $1`, [log.id]), { code: PG.conflict });
      await expectPgError(db.sql(`TRUNCATE audit_logs`), { code: PG.conflict, message: /truncated/ });
      await expectPgError(db.sql(`TRUNCATE activity_logs`), { code: PG.conflict });

      for (const bad of [
        { password: 'x' },
        { nested: { accessToken: 'x' } },
        { items: [{ Patient_Name: 'x' }] },
        { ssn: '000' },
        { authorization: 'Bearer x' },
      ]) {
        await expectPgError(
          db.sql(
            `INSERT INTO activity_logs (id, organization_id, action, entity_type, metadata) VALUES (gen_random_uuid(), $1, 'TEST.SAFE', 'TEST', $2::jsonb)`,
            [orgId, JSON.stringify(bad)],
          ),
          { code: PG.check, constraint: 'activity_logs_metadata_safe_chk' },
        );
        await expectPgError(
          db.sql(
            `INSERT INTO audit_logs (id, organization_id, action, entity_type, after_data) VALUES (gen_random_uuid(), $1, 'TEST.SAFE', 'TEST', $2::jsonb)`,
            [orgId, JSON.stringify(bad)],
          ),
          { code: PG.check, constraint: 'audit_logs_payload_safe_chk' },
        );
      }
      await expectPgError(
        db.sql(
          `INSERT INTO audit_logs (id, organization_id, action, entity_type, outcome) VALUES (gen_random_uuid(), $1, 'TEST.SAFE', 'TEST', 'MAYBE')`,
          [orgId],
        ),
        { code: PG.check },
      );
    });
  });

  describe('Schema / shared definitions parity', () => {
    const enumValues = async (name: string) =>
      (
        await db.sql<{ enumlabel: string }>(
          `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = $1 AND n.nspname = current_schema() ORDER BY e.enumsortorder`,
          [name],
        )
      ).map((r) => r.enumlabel);

    it.each([
      ['role', ROLES],
      ['employee_status', EMPLOYEE_STATUSES],
      ['organization_status', ORGANIZATION_STATUSES],
      ['active_status', ACTIVE_STATUSES],
      ['project_status', PROJECT_STATUSES],
      ['allocation_type', ALLOCATION_TYPES],
      ['project_role', PROJECT_ROLES],
      ['auth_token_type', AUTH_TOKEN_TYPES],
      ['login_name_end_reason', LOGIN_NAME_END_REASONS],
      ['chart_status', CHART_STATUSES],
      ['allocation_source', ALLOCATION_SOURCES],
      ['allocation_status', ALLOCATION_STATUSES],
      ['assignment_end_reason', ASSIGNMENT_END_REASONS],
      ['production_status', PRODUCTION_STATUSES],
      ['audit_result', AUDIT_RESULTS],
      ['audit_status', AUDIT_STATUSES],
      ['resolution_decision', RESOLUTION_DECISIONS],
      ['rework_status', REWORK_STATUSES],
      ['approval_status', APPROVAL_STATUSES],
    ] as const)('PostgreSQL enum %s equals the shared definition', async (name, shared) => {
      expect(await enumValues(name)).toEqual([...shared]);
    });
  });
});
