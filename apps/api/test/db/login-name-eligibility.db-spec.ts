import { LOGIN_NAME_ELIGIBLE_ROLES, ROLES, type Role } from '@smartcode/shared';
import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

/** Phase 3 — Login Name eligibility, role changes and last-Manager protection (all enforced by PostgreSQL). */
describeDb('Login Name eligibility & role changes (PostgreSQL)', () => {
  let db: TestDb;
  let fx: Fixtures;
  let manager: Awaited<ReturnType<Fixtures['manager']>>;
  let vendorId: string;

  const rolesBy = (eligible: boolean) =>
    ROLES.filter((r) => LOGIN_NAME_ELIGIBLE_ROLES.includes(r) === eligible);

  const employeeFor = (role: Role) =>
    fx.employee({
      role,
      vendorId: role === 'VENDOR_ADMIN' ? vendorId : null,
    });

  /** Raw SQL, so the PostgreSQL error code is visible (Prisma wraps custom SQLSTATEs). */
  const assignSql = (loginNameId: string, employeeId: string, assignedById: string) =>
    db.sql(
      `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
      [loginNameId, employeeId, assignedById],
    );

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
    await fx.org();
    manager = await fx.manager();
    await fx.manager(); // a second active Manager so the first can be changed in tests
    vendorId = (await fx.vendor('PhaseThreeVendor')).id;
  });
  afterAll(async () => db?.close());

  it('eligible roles can receive a Login Name', async () => {
    for (const role of rolesBy(true)) {
      const employee = await employeeFor(role);
      const ln = await fx.loginName();
      await expect(fx.assignLoginName(ln.id, employee.id, manager.id)).resolves.toBeDefined();
    }
  });

  it('MANAGER, HR and VENDOR_ADMIN can never receive a Login Name', async () => {
    expect(rolesBy(false).sort()).toEqual(['HR', 'MANAGER', 'VENDOR_ADMIN']);
    for (const role of rolesBy(false)) {
      const employee = await employeeFor(role);
      const ln = await fx.loginName();
      await expectPgError(assignSql(ln.id, employee.id, manager.id), {
        code: PG.invalid,
        message: /not eligible for a SmartClues login name/,
      });
    }
  });

  it('only an ACTIVE employee can receive a Login Name (pending and locked are refused)', async () => {
    const pending = await fx.employee({ role: 'CODER', active: false });
    await expectPgError(assignSql((await fx.loginName()).id, pending.id, manager.id), {
      code: PG.invalid,
      message: /ACTIVE employee/,
    });
    const locked = await fx.employee({ role: 'AUDITOR' });
    await db.sql(`UPDATE employees SET status = 'LOCKED' WHERE id = $1`, [locked.id]);
    await expectPgError(assignSql((await fx.loginName()).id, locked.id, manager.id), {
      code: PG.invalid,
      message: /ACTIVE employee/,
    });
  });

  it('only a Manager can assign (not HR, Vendor Admin, Team Lead, Auditor or Coder)', async () => {
    const target = await fx.employee({ role: 'CODER' });
    for (const role of ROLES.filter((r) => r !== 'MANAGER')) {
      const actor = await employeeFor(role);
      await expectPgError(assignSql((await fx.loginName()).id, target.id, actor.id), {
        code: PG.forbidden,
      });
    }
  });

  describe('role change', () => {
    it('ends the open Login Name with ROLE_CHANGED when the new role is ineligible, keeping the history', async () => {
      const coder = await fx.employee({ role: 'CODER' });
      const ln = await fx.loginName();
      await fx.assignLoginName(ln.id, coder.id, manager.id);
      await db.sql(`UPDATE employees SET role = 'HR' WHERE id = $1`, [coder.id]);
      const rows = await db.sql<{ end_reason: string | null; ended_at: Date | null }>(
        `SELECT end_reason, ended_at FROM login_name_assignments WHERE employee_id = $1`,
        [coder.id],
      );
      expect(rows).toHaveLength(1); // history retained, not deleted
      expect(rows[0]?.end_reason).toBe('ROLE_CHANGED');
      expect(rows[0]?.ended_at).not.toBeNull();
      // And the name is free to be assigned to someone else.
      const other = await fx.employee({ role: 'CODER' });
      await expect(fx.assignLoginName(ln.id, other.id, manager.id)).resolves.toBeDefined();
    });

    it('keeps the Login Name when the new role is still eligible, and ends project staffing recorded for the old role', async () => {
      const w = await fx.workspace();
      await db.sql(`UPDATE employees SET role = 'AUDITOR' WHERE id = $1`, [w.coder.id]);
      const [open] = await db.sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM login_name_assignments WHERE employee_id = $1 AND ended_at IS NULL`,
        [w.coder.id],
      );
      expect(open?.n).toBe('1');
      const [staffing] = await db.sql<{ ended_at: Date | null }>(
        `SELECT ended_at FROM project_assignments WHERE employee_id = $1`,
        [w.coder.id],
      );
      expect(staffing?.ended_at).not.toBeNull();
    });

    it('is refused while the employee still holds allocated charts', async () => {
      const a = await fx.allocated();
      await expectPgError(db.sql(`UPDATE employees SET role = 'AUDITOR' WHERE id = $1`, [a.coder.id]), {
        code: PG.conflict,
        message: /allocated charts/,
      });
    });

    it('is refused while the employee leads an active team', async () => {
      const lead = await fx.employee({ role: 'TEAM_LEAD' });
      await db.prisma.team.create({
        data: { organizationId: fx.organizationId, name: 'Lead Test Team', teamLeadId: lead.id },
      });
      await expectPgError(db.sql(`UPDATE employees SET role = 'CODER' WHERE id = $1`, [lead.id]), {
        code: PG.conflict,
        message: /leads an active team/,
      });
    });
  });

  describe('last active Manager', () => {
    it('cannot be deactivated or demoted, but can be once another Manager is active', async () => {
      const solo = await createTestDb();
      try {
        const f = new Fixtures(solo);
        await f.org();
        const only = await f.manager();
        await expectPgError(
          solo.sql(`UPDATE employees SET status = 'INACTIVE', deactivated_at = now() WHERE id = $1`, [
            only.id,
          ]),
          { code: PG.conflict, message: /last active Manager/ },
        );
        await expectPgError(solo.sql(`UPDATE employees SET role = 'HR' WHERE id = $1`, [only.id]), {
          code: PG.conflict,
          message: /last active Manager/,
        });
        const second = await f.manager();
        await solo.sql(`UPDATE employees SET status = 'INACTIVE', deactivated_at = now() WHERE id = $1`, [
          only.id,
        ]);
        await expectPgError(
          solo.sql(`UPDATE employees SET status = 'INACTIVE', deactivated_at = now() WHERE id = $1`, [
            second.id,
          ]),
          { code: PG.conflict, message: /last active Manager/ },
        );
      } finally {
        await solo.close();
      }
    });
  });
});
