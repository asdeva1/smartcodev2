import { totalErrors } from '@smartcode/shared';
import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

describeDb('Production versions, audit, Manager resolution, rework and re-audit (PostgreSQL)', () => {
  let db: TestDb;
  let fx: Fixtures;

  const insertAudit = (
    chartId: string,
    productionId: string,
    auditorId: string,
    ae: number,
    ee: number,
    extra = '',
  ) =>
    db.sql(
      `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, updated_at ${extra ? ', total_errors' : ''})
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now() ${extra ? ', ' + extra : ''})`,
      [chartId, productionId, auditorId, ae, ee],
    );
  const insertResolution = (auditId: string, decision: string, byId: string, reason: string | null = null) =>
    db.sql(
      `INSERT INTO audit_resolutions (id, audit_id, decision, reason, resolved_by_id) VALUES (gen_random_uuid(), $1, $2::resolution_decision, $3, $4)`,
      [auditId, decision, reason, byId],
    );

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
  });
  afterAll(async () => db?.close());

  describe('Production versions', () => {
    it('9. keeps the full production version history (a correction is a NEW version)', async () => {
      const r = await fx.reworked();
      const versions = await db.sql<{
        version: number;
        status: string;
        is_current: boolean;
        page_count: number;
        icds: number;
        rework_id: string | null;
      }>(
        `SELECT version, status, is_current, page_count, icds, rework_id FROM production_entries WHERE chart_id = $1 ORDER BY version`,
        [r.chart.id],
      );
      expect(versions).toEqual([
        { version: 1, status: 'SUPERSEDED', is_current: false, page_count: 12, icds: 5, rework_id: null },
        {
          version: 2,
          status: 'SUBMITTED',
          is_current: true,
          page_count: 12,
          icds: 6,
          rework_id: r.rework.id,
        },
      ]);
    });

    it('assigns the version number in the database and never lets the client choose it', async () => {
      const a = await fx.allocated();
      await fx.setChartStatus(a.chart.id, 'IN_PRODUCTION');
      const [row] = await db.sql<{ version: number }>(
        `INSERT INTO production_entries (id, chart_id, version, coder_id, login_name_id, allocation_id, page_count, icds, dos, updated_at)
         VALUES (gen_random_uuid(), $1, 99, $2, $3, $4, 1, 1, 1, now()) RETURNING version`,
        [a.chart.id, a.coder.id, a.loginName.id, a.allocation.id],
      );
      expect(row?.version).toBe(1);
    });

    it('has Page Count, ICDs and DOS — and no JCD anywhere in the schema', async () => {
      const columns = await db.sql<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
      );
      const production = columns
        .filter((c) => c.table_name === 'production_entries')
        .map((c) => c.column_name);
      expect(production).toEqual(
        expect.arrayContaining(['page_count', 'icds', 'dos', 'coded_at', 'version', 'status']),
      );
      expect(columns.filter((c) => /jcd/i.test(c.column_name))).toEqual([]);
    });

    it('freezes a submitted version, rejects negative counts and allows one current version only', async () => {
      const s = await fx.submitted();
      await expectPgError(
        db.sql(`UPDATE production_entries SET icds = 99 WHERE id = $1`, [s.production.id]),
        { code: PG.conflict, message: /immutable/ },
      );
      await expectPgError(db.sql(`DELETE FROM production_entries WHERE id = $1`, [s.production.id]), {
        code: PG.conflict,
      });
      await expectPgError(
        db.sql(`UPDATE production_entries SET status = 'DRAFT', submitted_at = NULL WHERE id = $1`, [
          s.production.id,
        ]),
        { code: PG.conflict },
      );

      const w = await fx.allocated();
      await expectPgError(
        db.sql(
          `INSERT INTO production_entries (id, chart_id, coder_id, login_name_id, allocation_id, page_count, icds, dos, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, -1, 0, 0, now())`,
          [w.chart.id, w.coder.id, w.loginName.id, w.allocation.id],
        ),
        { code: PG.check, constraint: 'production_entries_counts_chk' },
      );
    });

    it('requires production to match the allocation (chart, coder, login name)', async () => {
      const a = await fx.allocated();
      const other = await fx.employee({ role: 'CODER' });
      await expectPgError(
        db.sql(
          `INSERT INTO production_entries (id, chart_id, coder_id, login_name_id, allocation_id, page_count, icds, dos, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 1, 1, now())`,
          [a.chart.id, other.id, a.loginName.id, a.allocation.id],
        ),
        { code: PG.invalid, message: /match the allocation/ },
      );
    });

    it('requires a version after the first to come from a rework', async () => {
      const s = await fx.submitted();
      await db.sql(`UPDATE production_entries SET status = 'SUPERSEDED', is_current = false WHERE id = $1`, [
        s.production.id,
      ]);
      await expectPgError(
        db.sql(
          `INSERT INTO production_entries (id, chart_id, coder_id, login_name_id, allocation_id, page_count, icds, dos, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 1, 1, now())`,
          [s.chart.id, s.coder.id, s.loginName.id, s.allocation.id],
        ),
        { code: PG.invalid, message: /rework/ },
      );
    });
  });

  describe('Audit', () => {
    it('13. calculates Total Errors = Audit Errors + Error Exceptions in the database', async () => {
      const s = await fx.submitted();
      // The client "claims" a wrong total — the server-side value wins.
      await insertAudit(s.chart.id, s.production.id, s.auditor.id, 3, 4, '999');
      const [audit] = await db.sql<{ audit_errors: number; error_exceptions: number; total_errors: number }>(
        `SELECT audit_errors, error_exceptions, total_errors FROM audits WHERE chart_id = $1`,
        [s.chart.id],
      );
      expect(audit).toEqual({ audit_errors: 3, error_exceptions: 4, total_errors: 7 });
      expect(audit?.total_errors).toBe(totalErrors(3, 4));
    });

    it('recomputes the total when an in-progress audit is edited and keeps it consistent (CHECK)', async () => {
      const s = await fx.submitted();
      const audit = await fx.auditInProgress(s);
      await db.sql(
        `UPDATE audits SET audit_errors = 10, error_exceptions = 2, total_errors = 0 WHERE id = $1`,
        [audit.id],
      );
      const [row] = await db.sql<{ total_errors: number }>(`SELECT total_errors FROM audits WHERE id = $1`, [
        audit.id,
      ]);
      expect(row?.total_errors).toBe(12);
      await expectPgError(db.sql(`UPDATE audits SET audit_errors = -1 WHERE id = $1`, [audit.id]), {
        code: PG.check,
      });
    });

    it('10. retains audit history — audits are immutable once submitted and never deleted', async () => {
      const r = await fx.reviewRequired();
      await expectPgError(db.sql(`UPDATE audits SET audit_errors = 0 WHERE id = $1`, [r.audit.id]), {
        code: PG.conflict,
        message: /immutable/,
      });
      await expectPgError(db.sql(`UPDATE audits SET remarks = 'rewritten' WHERE id = $1`, [r.audit.id]), {
        code: PG.conflict,
      });
      await expectPgError(
        db.sql(`UPDATE audits SET auditor_id = $2 WHERE id = $1`, [r.audit.id, r.manager.id]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM audits WHERE id = $1`, [r.audit.id]), { code: PG.conflict });
      await expectPgError(db.sql(`TRUNCATE audits`), { code: '0A000' });
    });

    it('audits each production version once, only by a different ACTIVE auditor, only while the chart waits for audit', async () => {
      const s = await fx.submitted();
      // The coder cannot audit their own work (even if they were an auditor, the role check blocks first).
      await expectPgError(insertAudit(s.chart.id, s.production.id, s.coder.id, 0, 0), {
        code: PG.invalid,
        message: /AUDITOR/,
      });
      await insertAudit(s.chart.id, s.production.id, s.auditor.id, 0, 0);
      const second = await fx.employee({ role: 'AUDITOR' });
      // A second audit of the same version is refused (the chart is no longer waiting for audit; the unique
      // index on production_entry_id is the last line of defence behind that rule).
      await expectPgError(insertAudit(s.chart.id, s.production.id, second.id, 0, 0), {
        code: PG.conflict,
        message: /not waiting for re-audit/,
      });
    });

    it('checks status ↔ result relationships', async () => {
      const s = await fx.submitted();
      await expectPgError(
        db.sql(
          `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, status, result, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 'PASSED', 'REVIEW_REQUIRED', now())`,
          [s.chart.id, s.production.id, s.auditor.id],
        ),
        { code: PG.check, constraint: 'audits_status_result_chk' },
      );
    });
  });

  describe('Manager resolution (D-01)', () => {
    it('lets an ACTIVE Manager approve and reject, once, with the audit status following atomically', async () => {
      const r = await fx.reviewRequired();
      await insertResolution(r.audit.id, 'REJECTED', r.manager.id, 'Synthetic reason');
      const [audit] = await db.sql<{ status: string }>(`SELECT status FROM audits WHERE id = $1`, [
        r.audit.id,
      ]);
      expect(audit?.status).toBe('REJECTED');
      await expectPgError(insertResolution(r.audit.id, 'APPROVED', r.manager.id), {
        code: PG.conflict,
        message: /already been resolved/,
      });
    });

    it('rejects resolution by a Team Lead, Group Coach, Auditor, Coder, Vendor Admin and HR (Manager only)', async () => {
      const r = await fx.reviewRequired();
      const vendor = await fx.vendor();
      for (const role of ['TEAM_LEAD', 'GROUP_COACH', 'AUDITOR', 'CODER', 'HR'] as const) {
        const actor = await fx.employee({ role });
        await expectPgError(insertResolution(r.audit.id, 'APPROVED', actor.id), {
          code: PG.forbidden,
          message: /Manager/,
        });
      }
      const vendorAdmin = await fx.employee({ role: 'VENDOR_ADMIN', vendorId: vendor.id });
      await expectPgError(insertResolution(r.audit.id, 'REJECTED', vendorAdmin.id, 'x'), {
        code: PG.forbidden,
      });
      const inactive = await fx.employee({ role: 'MANAGER', active: false });
      await expectPgError(insertResolution(r.audit.id, 'APPROVED', inactive.id), { code: PG.forbidden });
      const [audit] = await db.sql<{ status: string }>(`SELECT status FROM audits WHERE id = $1`, [
        r.audit.id,
      ]);
      expect(audit?.status).toBe('REVIEW_REQUIRED');
    });

    it('cannot bypass the resolution by updating the audit status directly', async () => {
      const r = await fx.reviewRequired();
      await expectPgError(db.sql(`UPDATE audits SET status = 'APPROVED' WHERE id = $1`, [r.audit.id]), {
        code: PG.forbidden,
        message: /Manager resolution/,
      });
      await expectPgError(db.sql(`UPDATE audits SET status = 'REJECTED' WHERE id = $1`, [r.audit.id]), {
        code: PG.forbidden,
      });
    });

    it('requires a reason to reject, only REVIEW_REQUIRED audits, and keeps resolutions append-only', async () => {
      const r = await fx.reviewRequired();
      await expectPgError(insertResolution(r.audit.id, 'REJECTED', r.manager.id, '   '), {
        code: PG.check,
        constraint: 'audit_resolutions_reason_chk',
      });
      const passed = await fx.submitted();
      const pass = await db.sql<{ id: string }>(
        `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, status, result, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 'PASSED', 'PASS', now()) RETURNING id`,
        [passed.chart.id, passed.production.id, passed.auditor.id],
      );
      await expectPgError(insertResolution(pass[0]!.id, 'APPROVED', passed.manager.id), {
        code: PG.conflict,
        message: /REVIEW_REQUIRED/,
      });

      await insertResolution(r.audit.id, 'APPROVED', r.manager.id);
      await expectPgError(
        db.sql(`UPDATE audit_resolutions SET decision = 'REJECTED', reason = 'x' WHERE audit_id = $1`, [
          r.audit.id,
        ]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM audit_resolutions WHERE audit_id = $1`, [r.audit.id]), {
        code: PG.conflict,
      });
    });
  });

  describe('Rework', () => {
    it('11. references the audit that caused it, the chart and the reworked version', async () => {
      const r = await fx.rejected();
      const [row] = await db.sql<{ audit_id: string; production_entry_id: string; chart_id: string }>(
        `SELECT audit_id, production_entry_id, chart_id FROM reworks WHERE id = $1`,
        [r.rework.id],
      );
      expect(row).toEqual({
        audit_id: r.audit.id,
        production_entry_id: r.production.id,
        chart_id: r.chart.id,
      });

      // A rework for an audit that was not rejected, or for a mismatching version, is refused.
      const other = await fx.reviewRequired();
      await expectPgError(
        db.sql(
          `INSERT INTO reworks (id, chart_id, audit_id, production_entry_id, assigned_coder_id, reason, created_by_id, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'because', $5, now())`,
          [other.chart.id, other.audit.id, other.production.id, other.coder.id, other.manager.id],
        ),
        { code: PG.conflict, message: /rejected/ },
      );
      await expectPgError(
        db.sql(
          `INSERT INTO reworks (id, chart_id, audit_id, production_entry_id, assigned_coder_id, reason, created_by_id, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'because', $5, now())`,
          [r.chart.id, r.audit.id, r.production.id, r.coder.id, r.manager.id],
        ),
        { code: PG.unique },
      );
    });

    it('is created only by a Manager, for an ACTIVE coder, with one open rework per chart', async () => {
      const r = await fx.reviewRequired();
      await insertResolution(r.audit.id, 'REJECTED', r.manager.id, 'Synthetic');
      const lead = await fx.employee({ role: 'TEAM_LEAD' });
      const sql = `INSERT INTO reworks (id, chart_id, audit_id, production_entry_id, assigned_coder_id, reason, created_by_id, updated_at)
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, 'because', $5, now())`;
      await expectPgError(db.sql(sql, [r.chart.id, r.audit.id, r.production.id, r.coder.id, lead.id]), {
        code: PG.forbidden,
      });
      await expectPgError(
        db.sql(sql, [r.chart.id, r.audit.id, r.production.id, r.auditor.id, r.manager.id]),
        { code: PG.invalid },
      );
      await db.sql(sql, [r.chart.id, r.audit.id, r.production.id, r.coder.id, r.manager.id]);
    });

    it('is completed only by a NEW production version, never by overwriting the old one', async () => {
      const r = await fx.rejected();
      await expectPgError(
        db.sql(`UPDATE reworks SET status = 'SUBMITTED', completed_at = now() WHERE id = $1`, [r.rework.id]),
        {
          code: PG.invalid,
          message: /corrected production version/,
        },
      );
      await expectPgError(
        // A guaranteed-different id (never a no-op update); the immutability trigger fires before the FK check.
        db.sql(`UPDATE reworks SET production_entry_id = gen_random_uuid() WHERE id = $1`, [r.rework.id]),
        { code: PG.conflict },
      );
      await expectPgError(db.sql(`DELETE FROM reworks WHERE id = $1`, [r.rework.id]), { code: PG.conflict });
    });
  });

  describe('Re-audit', () => {
    it('12. creates a NEW audit record (same model, sequence 2) linked to the previous audit', async () => {
      const r = await fx.reworked();
      await db.sql(
        `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, status, result, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 0, 0, 'PASSED', 'PASS', now())`,
        [r.chart.id, r.production2.id, r.auditor.id],
      );
      const audits = await db.sql<{
        sequence: number;
        is_re_audit: boolean;
        previous_audit_id: string | null;
        status: string;
        production_entry_id: string;
      }>(
        `SELECT sequence, is_re_audit, previous_audit_id, status, production_entry_id FROM audits WHERE chart_id = $1 ORDER BY sequence`,
        [r.chart.id],
      );
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({
        sequence: 1,
        is_re_audit: false,
        previous_audit_id: null,
        status: 'REJECTED',
        production_entry_id: r.production.id,
      });
      expect(audits[1]).toMatchObject({
        sequence: 2,
        is_re_audit: true,
        previous_audit_id: r.audit.id,
        status: 'PASSED',
        production_entry_id: r.production2.id,
      });
    });

    it('records the full history: production → audit → Manager resolution → rework → new version → re-audit → COMPLETED', async () => {
      const r = await fx.reworked();
      const reAudit = await db.sql<{ id: string }>(
        `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, status, result, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, 0, 'PASSED', 'PASS', now()) RETURNING id`,
        [r.chart.id, r.production2.id, r.auditor.id],
      );
      await fx.setChartStatus(r.chart.id, 'AUDITED');
      await fx.setChartStatus(r.chart.id, 'COMPLETED');
      await db.sql(`UPDATE reworks SET status = 'CLOSED' WHERE id = $1`, [r.rework.id]);

      const timeline = await db.sql<{ to_status: string }>(
        `SELECT to_status FROM chart_status_events WHERE chart_id = $1 ORDER BY created_at, id`,
        [r.chart.id],
      );
      expect(timeline.map((e) => e.to_status)).toEqual([
        'PENDING_ALLOCATION',
        'ALLOCATED',
        'IN_PRODUCTION',
        'CODED',
        'PENDING_AUDIT',
        'REVIEW_REQUIRED',
        'REWORK',
        'RE_AUDIT',
        'AUDITED',
        'COMPLETED',
      ]);
      const [resolution] = await db.sql<{ decision: string; resolved_by_id: string }>(
        `SELECT decision, resolved_by_id FROM audit_resolutions WHERE audit_id = $1`,
        [r.audit.id],
      );
      expect(resolution).toEqual({ decision: 'REJECTED', resolved_by_id: r.manager.id });
      expect(reAudit[0]?.id).toBeDefined();
    });

    it('refuses a re-audit that does not follow a rejected audit and its rework, or a stale production version', async () => {
      const r = await fx.reworked();
      // Auditing the OLD (superseded) version again is not allowed.
      await expectPgError(insertAudit(r.chart.id, r.production.id, r.auditor.id, 0, 0), {
        code: PG.invalid,
        message: /current submitted/,
      });
    });

    it('keeps chart status in step with the audit outcome (valid status relationships)', async () => {
      const s = await fx.submitted();
      // PENDING_AUDIT → AUDITED without any audit is refused.
      await expectPgError(db.sql(`UPDATE charts SET status = 'AUDITED' WHERE id = $1`, [s.chart.id]), {
        code: PG.invalid,
        message: /PASSED audit/,
      });
      await expectPgError(
        db.sql(`UPDATE charts SET status = 'REVIEW_REQUIRED' WHERE id = $1`, [s.chart.id]),
        { code: PG.invalid },
      );
      const r = await fx.reviewRequired();
      await expectPgError(db.sql(`UPDATE charts SET status = 'COMPLETED' WHERE id = $1`, [r.chart.id]), {
        code: PG.invalid,
        message: /APPROVAL/,
      });
      await insertResolution(r.audit.id, 'APPROVED', r.manager.id);
      await fx.setChartStatus(r.chart.id, 'COMPLETED');
    });
  });
});
