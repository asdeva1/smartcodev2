import { CHART_TRANSITIONS } from '@smartcode/shared';
import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

describeDb('Chart repository & allocation (PostgreSQL)', () => {
  let db: TestDb;
  let fx: Fixtures;

  const insertChart = (orgId: string, projectId: string, ref: string) =>
    db.sql(
      `INSERT INTO charts (id, organization_id, project_id, chart_ref, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
      [orgId, projectId, ref],
    );
  const insertAllocation = (
    chartId: string,
    loginNameId: string,
    employeeId: string,
    byId: string,
    source = 'MANUAL',
  ) =>
    db.sql(
      `INSERT INTO chart_allocations (id, chart_id, login_name_id, employee_id, allocated_by_id, source, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::allocation_source, now())`,
      [chartId, loginNameId, employeeId, byId, source],
    );

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
  });
  afterAll(async () => db?.close());

  describe('Chart ID uniqueness', () => {
    it('5. rejects a duplicate Chart ID inside the same project', async () => {
      const orgId = await fx.org();
      const project = await fx.project();
      await fx.chart(project.id, 'CHART-0001');
      await expectPgError(insertChart(orgId, project.id, 'CHART-0001'), {
        code: PG.unique,
        constraint: 'charts_project_id_chart_ref_key',
      });
    });

    it('6. allows the same Chart ID in two different projects', async () => {
      const orgId = await fx.org();
      const projectA = await fx.project();
      const projectB = await fx.project();
      await fx.chart(projectA.id, 'SHARED-REF');
      await insertChart(orgId, projectB.id, 'SHARED-REF');
      const rows = await db.sql(
        `SELECT 1 FROM charts WHERE chart_ref = 'SHARED-REF' AND organization_id = $1`,
        [orgId],
      );
      expect(rows).toHaveLength(2);
    });

    it('keeps the Chart ID canonical, immutable and never deletable; new charts start PENDING_ALLOCATION', async () => {
      const orgId = await fx.org();
      const project = await fx.project();
      await expectPgError(insertChart(orgId, project.id, ' padded '), {
        code: PG.check,
        constraint: 'charts_ref_canonical_chk',
      });
      const chart = await fx.chart(project.id);
      expect(chart.status).toBe('PENDING_ALLOCATION');
      await expectPgError(db.sql(`UPDATE charts SET chart_ref = 'RENAMED' WHERE id = $1`, [chart.id]), {
        code: PG.conflict,
      });
      await expectPgError(db.sql(`DELETE FROM charts WHERE id = $1`, [chart.id]), { code: PG.conflict });
      await expectPgError(
        db.sql(
          `INSERT INTO charts (id, organization_id, project_id, chart_ref, status, updated_at) VALUES (gen_random_uuid(), $1, $2, 'BORN-CODED', 'CODED', now())`,
          [orgId, project.id],
        ),
        { code: PG.conflict },
      );
    });

    it('rejects a chart whose project belongs to another organization (tenant boundary)', async () => {
      const orgA = await fx.org();
      const projectA = await fx.project();
      await fx.org(); // organization B
      await expectPgError(insertChart(fx.organizationId, projectA.id, 'CROSS-TENANT'), {
        code: PG.foreignKey,
      });
      expect(orgA).not.toBe(fx.organizationId);
    });
  });

  describe('Allocation', () => {
    it('7. rejects a second ACTIVE allocation for the same chart', async () => {
      const w = await fx.workspace();
      await insertAllocation(w.chart.id, w.loginName.id, w.coder.id, w.manager.id);
      const otherCoder = await fx.employee({ role: 'CODER' });
      const otherLogin = await fx.loginName();
      await fx.assignLoginName(otherLogin.id, otherCoder.id, w.manager.id);
      await fx.assignProject(w.project.id, otherCoder.id, 'CODER', w.manager.id);
      await expectPgError(insertAllocation(w.chart.id, otherLogin.id, otherCoder.id, w.manager.id), {
        code: PG.unique,
        constraint: 'chart_allocations_one_active_per_chart_key',
      });
    });

    it('8. retains historical allocations when a chart is reallocated (all three sources)', async () => {
      const w = await fx.workspace();
      const first = await fx.allocate(w.chart.id, w.loginName.id, w.coder.id, w.manager.id, 'CSV');
      await fx.setChartStatus(w.chart.id, 'ALLOCATED');

      const coder2 = await fx.employee({ role: 'CODER' });
      const login2 = await fx.loginName();
      await fx.assignLoginName(login2.id, coder2.id, w.manager.id);
      await fx.assignProject(w.project.id, coder2.id, 'CODER', w.manager.id);

      // Reallocation recipe: end the active allocation, insert the new one, all in one transaction.
      await db.tx(async (q) => {
        await q(
          `UPDATE chart_allocations SET status = 'ENDED', ended_at = now(), end_reason = 'REALLOCATED', ended_by_id = $2, updated_at = now() WHERE id = $1`,
          [first.id, w.manager.id],
        );
        await q(
          `INSERT INTO chart_allocations (id, chart_id, login_name_id, employee_id, allocated_by_id, source, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'AUTOMATIC', now())`,
          [w.chart.id, login2.id, coder2.id, w.manager.id],
        );
      });

      const history = await db.sql<{ source: string; status: string; end_reason: string | null }>(
        `SELECT source, status, end_reason FROM chart_allocations WHERE chart_id = $1 ORDER BY allocated_at, id`,
        [w.chart.id],
      );
      expect(history).toEqual([
        { source: 'CSV', status: 'ENDED', end_reason: 'REALLOCATED' },
        { source: 'AUTOMATIC', status: 'ACTIVE', end_reason: null },
      ]);

      // History is immutable and never deleted.
      await expectPgError(
        db.sql(`UPDATE chart_allocations SET login_name_id = $2 WHERE id = $1`, [first.id, login2.id]),
        { code: PG.conflict },
      );
      await expectPgError(
        db.sql(
          `UPDATE chart_allocations SET status = 'ACTIVE', ended_at = NULL, end_reason = NULL WHERE id = $1`,
          [first.id],
        ),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM chart_allocations WHERE id = $1`, [first.id]), {
        code: PG.conflict,
      });
      // PostgreSQL itself refuses to truncate a table other tables reference.
      await expectPgError(db.sql(`TRUNCATE chart_allocations`), { code: '0A000' });
    });

    it('lets only a Manager allocate (Team Lead / Auditor cannot)', async () => {
      const w = await fx.workspace();
      const lead = await fx.employee({ role: 'TEAM_LEAD' });
      await expectPgError(insertAllocation(w.chart.id, w.loginName.id, w.coder.id, lead.id), {
        code: PG.forbidden,
        message: /Manager/,
      });
      await expectPgError(insertAllocation(w.chart.id, w.loginName.id, w.coder.id, w.auditor.id), {
        code: PG.forbidden,
      });
    });

    it('applies the eligibility rules: ACTIVE, role CODER, own active Login Name, assigned to the project', async () => {
      const w = await fx.workspace();
      // Login name that belongs to somebody else.
      const stranger = await fx.employee({ role: 'CODER' });
      await expectPgError(insertAllocation(w.chart.id, w.loginName.id, stranger.id, w.manager.id), {
        code: PG.invalid,
        message: /login name/,
      });
      // Auditor is not a coder, even with a login name.
      const auditorLogin = await fx.loginName();
      await fx.assignLoginName(auditorLogin.id, w.auditor.id, w.manager.id);
      await expectPgError(insertAllocation(w.chart.id, auditorLogin.id, w.auditor.id, w.manager.id), {
        code: PG.invalid,
        message: /CODER/,
      });
      // Coder with a login name but not assigned to the project.
      const unassigned = await fx.employee({ role: 'CODER' });
      const login = await fx.loginName();
      await fx.assignLoginName(login.id, unassigned.id, w.manager.id);
      await expectPgError(insertAllocation(w.chart.id, login.id, unassigned.id, w.manager.id), {
        code: PG.invalid,
        message: /not assigned/,
      });
      // Employee no longer ACTIVE (a login name can only be assigned to an ACTIVE employee, so lock them afterwards).
      const pending = await fx.employee({ role: 'CODER' });
      const login2 = await fx.loginName();
      await fx.assignLoginName(login2.id, pending.id, w.manager.id);
      await fx.assignProject(w.project.id, pending.id, 'CODER', w.manager.id);
      await db.sql(`UPDATE employees SET status = 'LOCKED' WHERE id = $1`, [pending.id]);
      await expectPgError(insertAllocation(w.chart.id, login2.id, pending.id, w.manager.id), {
        code: PG.invalid,
        message: /ACTIVE/,
      });
    });

    it('does not allocate a chart that is no longer allocatable', async () => {
      const s = await fx.submitted();
      const coder2 = await fx.employee({ role: 'CODER' });
      const login2 = await fx.loginName();
      await fx.assignLoginName(login2.id, coder2.id, s.manager.id);
      await fx.assignProject(s.project.id, coder2.id, 'CODER', s.manager.id);
      await db.sql(
        `UPDATE chart_allocations SET status = 'ENDED', ended_at = now(), end_reason = 'DEALLOCATED' WHERE id = $1`,
        [s.allocation.id],
      );
      await expectPgError(insertAllocation(s.chart.id, login2.id, coder2.id, s.manager.id), {
        code: PG.conflict,
        message: /PENDING_AUDIT/,
      });
    });
  });

  describe('Chart lifecycle', () => {
    it('allows exactly the transitions of the shared workflow', async () => {
      const rows = await db.sql<{ from_status: string; to_status: string }>(
        `SELECT from_status, to_status FROM chart_status_transitions`,
      );
      const database = rows.map((r) => `${r.from_status}>${r.to_status}`).sort();
      const shared = [
        ...new Set(CHART_TRANSITIONS.filter((t) => t.from !== t.to).map((t) => `${t.from}>${t.to}`)),
      ].sort();
      expect(database).toEqual(shared);
    });

    it('rejects an illegal transition and a status that is not backed by facts', async () => {
      const w = await fx.workspace();
      await expectPgError(db.sql(`UPDATE charts SET status = 'COMPLETED' WHERE id = $1`, [w.chart.id]), {
        code: PG.conflict,
        message: /cannot change/,
      });
      await expectPgError(db.sql(`UPDATE charts SET status = 'ALLOCATED' WHERE id = $1`, [w.chart.id]), {
        code: PG.invalid,
        message: /active allocation/,
      });
      await insertAllocation(w.chart.id, w.loginName.id, w.coder.id, w.manager.id);
      await fx.setChartStatus(w.chart.id, 'ALLOCATED');
      await expectPgError(
        db.sql(`UPDATE charts SET status = 'PENDING_ALLOCATION' WHERE id = $1`, [w.chart.id]),
        { code: PG.invalid, message: /end the active allocation/ },
      );
      await fx.setChartStatus(w.chart.id, 'IN_PRODUCTION');
      await expectPgError(db.sql(`UPDATE charts SET status = 'CODED' WHERE id = $1`, [w.chart.id]), {
        code: PG.invalid,
        message: /submitted production/,
      });
    });

    it('writes an append-only timeline with the acting employee', async () => {
      const w = await fx.workspace();
      await insertAllocation(w.chart.id, w.loginName.id, w.coder.id, w.manager.id);
      await db.tx(async (q) => {
        await q(
          `SELECT set_config('app.actor_id', $1, true), set_config('app.reason', 'Manual allocation', true)`,
          [w.manager.id],
        );
        await q(`UPDATE charts SET status = 'ALLOCATED', updated_at = now() WHERE id = $1`, [w.chart.id]);
      });
      const events = await db.sql<{
        from_status: string | null;
        to_status: string;
        actor_id: string | null;
        reason: string | null;
      }>(
        `SELECT from_status, to_status, actor_id, reason FROM chart_status_events WHERE chart_id = $1 ORDER BY created_at, id`,
        [w.chart.id],
      );
      expect(events).toEqual([
        { from_status: null, to_status: 'PENDING_ALLOCATION', actor_id: null, reason: null },
        {
          from_status: 'PENDING_ALLOCATION',
          to_status: 'ALLOCATED',
          actor_id: w.manager.id,
          reason: 'Manual allocation',
        },
      ]);
      await expectPgError(
        db.sql(`UPDATE chart_status_events SET reason = 'edited' WHERE chart_id = $1`, [w.chart.id]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM chart_status_events WHERE chart_id = $1`, [w.chart.id]), {
        code: PG.conflict,
      });
    });
  });
});
