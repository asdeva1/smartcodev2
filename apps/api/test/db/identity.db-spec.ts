import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

describeDb('Employee identity & SmartClues Login Names (PostgreSQL)', () => {
  let db: TestDb;
  let fx: Fixtures;
  let orgId: string;
  let manager: Awaited<ReturnType<Fixtures['manager']>>;

  const insertEmployee = (code: string, email: string, role = 'CODER', vendorId: string | null = null) =>
    db.sql(
      `INSERT INTO employees (id, organization_id, employee_code, full_name, email, role, vendor_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'Synthetic Person', $3, $4::role, $5, now())`,
      [orgId, code, email, role, vendorId],
    );

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
    orgId = await fx.org();
    manager = await fx.manager();
  });
  afterAll(async () => db?.close());

  describe('Employee ID and email', () => {
    it('1. rejects a duplicate Employee ID (including a different letter case)', async () => {
      await fx.employee({ code: 'EMP-1001' });
      await expectPgError(insertEmployee('EMP-1001', 'other1@example.test'), {
        code: PG.unique,
        constraint: 'employees_organization_id_employee_code_key',
      });
      await expectPgError(insertEmployee('emp-1001', 'other2@example.test'), {
        code: PG.unique,
        constraint: 'employees_org_employee_code_ci_key',
      });
    });

    it('enforces a globally unique, lower-case email (the sign-in identity)', async () => {
      await fx.employee({ code: 'EMP-1002', email: 'unique.person@example.test' });
      await expectPgError(insertEmployee('EMP-1003', 'unique.person@example.test'), {
        code: PG.unique,
        constraint: 'employees_email_key',
      });
      await expectPgError(insertEmployee('EMP-1004', 'Mixed.Case@Example.test'), {
        code: PG.check,
        constraint: 'employees_email_canonical_chk',
      });
    });

    it('stores no password on the employee and starts every employee as PENDING_ACTIVATION', async () => {
      const columns = await db.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'employees'`,
      );
      expect(columns.map((c) => c.column_name).filter((c) => /pass|secret|hash/i.test(c))).toEqual([]);

      const pending = await fx.employee({ active: false });
      expect(pending.status).toBe('PENDING_ACTIVATION');
      expect(pending.activatedAt).toBeNull();
      await expectPgError(
        db.sql(
          `INSERT INTO employees (id, organization_id, employee_code, full_name, email, role, status, activated_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'EMP-ACTIVE-AT-BIRTH', 'X', 'born.active@example.test', 'CODER', 'ACTIVE', now(), now())`,
          [orgId],
        ),
        { code: PG.conflict, message: /PENDING_ACTIVATION/ },
      );
    });

    it('follows the employee lifecycle and keeps identity fields immutable', async () => {
      const e = await fx.employee({ active: false });
      await expectPgError(db.sql(`UPDATE employees SET status = 'LOCKED' WHERE id = $1`, [e.id]), {
        code: PG.conflict,
      });
      await expectPgError(db.sql(`UPDATE employees SET employee_code = 'CHANGED' WHERE id = $1`, [e.id]), {
        code: PG.conflict,
      });
      // ACTIVE requires an activation date (CHECK) …
      await expectPgError(db.sql(`UPDATE employees SET status = 'ACTIVE' WHERE id = $1`, [e.id]), {
        code: PG.check,
      });
      await db.sql(`UPDATE employees SET status = 'ACTIVE', activated_at = now() WHERE id = $1`, [e.id]);
      await expectPgError(
        db.sql(`UPDATE employees SET status = 'PENDING_ACTIVATION' WHERE id = $1`, [e.id]),
        { code: PG.conflict },
      );
    });

    it('never deletes an employee', async () => {
      const e = await fx.employee();
      await expectPgError(db.sql(`DELETE FROM employees WHERE id = $1`, [e.id]), {
        code: PG.conflict,
        message: /never deleted/,
      });
    });

    it('keeps vendor and organization-level roles apart', async () => {
      const vendor = await fx.vendor();
      await expectPgError(insertEmployee('EMP-1010', 'mgr.vendor@example.test', 'MANAGER', vendor.id), {
        code: PG.check,
        constraint: 'employees_role_vendor_chk',
      });
      await expectPgError(insertEmployee('EMP-1011', 'va.novendor@example.test', 'VENDOR_ADMIN'), {
        code: PG.check,
        constraint: 'employees_role_vendor_chk',
      });
      await insertEmployee('EMP-1012', 'va.ok@example.test', 'VENDOR_ADMIN', vendor.id);
    });
  });

  describe('Login Names', () => {
    it('2. rejects a duplicate Login Name (case-insensitive)', async () => {
      await fx.loginName('SC.JSMITH');
      await expectPgError(
        db.sql(
          `INSERT INTO login_names (id, organization_id, value, updated_at) VALUES (gen_random_uuid(), $1, 'sc.jsmith', now())`,
          [orgId],
        ),
        { code: PG.unique, constraint: 'login_names_org_value_ci_key' },
      );
    });

    it('3. one employee cannot hold two active Login Names', async () => {
      const coder = await fx.employee();
      const a = await fx.loginName();
      const b = await fx.loginName();
      await fx.assignLoginName(a.id, coder.id, manager.id);
      await expectPgError(
        db.sql(
          `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
          [b.id, coder.id, manager.id],
        ),
        { code: PG.unique, constraint: 'login_name_assignments_one_active_per_employee_key' },
      );
    });

    it('4. one Login Name cannot belong to two active employees', async () => {
      const first = await fx.employee();
      const second = await fx.employee();
      const ln = await fx.loginName();
      await fx.assignLoginName(ln.id, first.id, manager.id);
      await expectPgError(
        db.sql(
          `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
          [ln.id, second.id, manager.id],
        ),
        { code: PG.unique, constraint: 'login_name_assignments_one_active_per_login_name_key' },
      );
    });

    it('keeps assignment history when a Login Name is reassigned', async () => {
      const first = await fx.employee();
      const second = await fx.employee();
      const ln = await fx.loginName();
      const a1 = await fx.assignLoginName(ln.id, first.id, manager.id);
      await db.sql(
        `UPDATE login_name_assignments SET ended_at = now(), end_reason = 'REASSIGNED' WHERE id = $1`,
        [a1.id],
      );
      await fx.assignLoginName(ln.id, second.id, manager.id);
      const rows = await db.sql<{ employee_id: string; ended_at: Date | null }>(
        `SELECT employee_id, ended_at FROM login_name_assignments WHERE login_name_id = $1 ORDER BY assigned_at, id`,
        [ln.id],
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.ended_at === null)).toHaveLength(1);
      // Ended history cannot be rewritten or deleted.
      await expectPgError(
        db.sql(`UPDATE login_name_assignments SET ended_at = NULL, end_reason = NULL WHERE id = $1`, [a1.id]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM login_name_assignments WHERE id = $1`, [a1.id]), {
        code: PG.conflict,
      });
    });

    it('lets only a Manager assign a Login Name', async () => {
      const lead = await fx.employee({ role: 'TEAM_LEAD' });
      const coder = await fx.employee();
      const ln = await fx.loginName();
      await expectPgError(
        db.sql(
          `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
          [ln.id, coder.id, lead.id],
        ),
        { code: PG.forbidden, message: /Manager/ },
      );
    });

    it('does not assign to an inactive employee and releases the name when an employee is deactivated', async () => {
      const coder = await fx.employee();
      const ln = await fx.loginName();
      await fx.assignLoginName(ln.id, coder.id, manager.id);
      await db.sql(`UPDATE employees SET status = 'INACTIVE', deactivated_at = now() WHERE id = $1`, [
        coder.id,
      ]);
      const [row] = await db.sql<{ end_reason: string; ended_at: Date | null }>(
        `SELECT end_reason, ended_at FROM login_name_assignments WHERE employee_id = $1`,
        [coder.id],
      );
      expect(row?.end_reason).toBe('EMPLOYEE_INACTIVE');
      expect(row?.ended_at).not.toBeNull();

      const other = await fx.loginName();
      await expectPgError(
        db.sql(
          `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, $2, $3)`,
          [other.id, coder.id, manager.id],
        ),
        { code: PG.invalid, message: /not eligible/ },
      );
    });

    it('rejects an assignment to an employee or login name that does not exist', async () => {
      const ln = await fx.loginName();
      await expectPgError(
        db.sql(
          `INSERT INTO login_name_assignments (id, login_name_id, employee_id, assigned_by_id) VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2)`,
          [ln.id, manager.id],
        ),
        { code: PG.foreignKey },
      );
    });
  });
});
