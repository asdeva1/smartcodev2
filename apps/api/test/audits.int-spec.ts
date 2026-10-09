import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Audit, Manager review and rework (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coderA: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let outsider: { id: string; session: Session };
  let teamLead: { id: string; session: Session };
  let projectId: string;
  const chartIds: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (role: string, code: string, email: string, fullName: string) =>
      createActiveEmployee(app, manager, { employeeCode: code, fullName, email, role });
    coderA = await mk('CODER', 'AU-CA', 'ca@example.test', 'Coder A');
    coderB = await mk('CODER', 'AU-CB', 'cb@example.test', 'Coder B');
    auditor = await mk('AUDITOR', 'AU-AU', 'au@example.test', 'Audrey Auditor');
    outsider = await mk('AUDITOR', 'AU-OU', 'ou@example.test', 'Olly Outsider');
    teamLead = await mk('TEAM_LEAD', 'AU-TL', 'tl@example.test', 'Tina Lead');
    const project = await as(app, manager)
      .post('/projects', { clientName: 'Acme', name: 'Audit', allocationType: 'MANUAL' })
      .expect(201);
    projectId = project.body.id;
    await as(app, manager)
      .post(`/projects/${projectId}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
    const csv = [
      'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks',
      'ca@vlms.com,ca@example.test,C-1,12,1-25,',
      'ca@vlms.com,ca@example.test,C-2,30,26-50,',
      'ca@vlms.com,ca@example.test,C-3,8,1-25,',
      'ca@vlms.com,ca@example.test,C-4,5,1-25,',
    ].join('\n');
    await as(app, manager)
      .post(`/projects/${projectId}/allocation/commit`, { csv, mode: 'all-or-nothing' })
      .expect(200);
    const list = await as(app, manager).get(`/projects/${projectId}/charts`).expect(200);
    for (const c of list.body.items) chartIds[c.chartId] = c.id;
    for (const [ref, icds] of [
      ['C-1', 4],
      ['C-2', 6],
      ['C-3', 2],
    ] as const) {
      await as(app, coderA.session)
        .post(`/production/charts/${chartIds[ref]}/submit`, { icds, dos: 1 })
        .expect(200);
    }
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const status = async (ref: string) =>
    (await db.sql<{ status: string }>(`SELECT status FROM charts WHERE chart_ref = $1`, [ref]))[0]?.status;
  const submitAudit = (ref: string, body: object, who = auditor) =>
    as(app, who.session).post(`/audits/charts/${chartIds[ref]}/submit`, body);

  it('the audit queue shows submitted charts to a project auditor only', async () => {
    const q = await as(app, auditor.session).get('/audits/queue').expect(200);
    expect(q.body.items.map((i: { chartId: string }) => i.chartId).sort()).toEqual(['C-1', 'C-2', 'C-3']);
    expect(q.body.items[0]).toMatchObject({ coder: 'Coder A', loginName: 'ca@vlms.com', isReAudit: false });
    // Not on the project → sees nothing; cannot audit it either.
    const none = await as(app, outsider.session).get('/audits/queue').expect(200);
    expect(none.body.total).toBe(0);
    await submitAudit('C-1', { auditErrors: 0, errorExceptions: 0, result: 'PASS' }, outsider).expect(404);
    // The Manager, Team Lead and Coder do not audit.
    for (const who of [manager, teamLead.session, coderA.session]) {
      await as(app, who).get('/audits/queue').expect(403);
    }
  });

  it('rejects invalid audit input', async () => {
    for (const body of [
      {},
      { auditErrors: -1, errorExceptions: 0, result: 'PASS' },
      { auditErrors: 1, errorExceptions: 'x', result: 'PASS' },
      { auditErrors: 1, errorExceptions: 1, result: 'REJECT' },
      { auditErrors: 1, errorExceptions: 1, result: 'APPROVED' },
    ]) {
      await submitAudit('C-1', body).expect(422);
    }
    expect(await status('C-1')).toBe('PENDING_AUDIT');
  });

  it('PASS completes the chart and stores Audit Errors, Error Exceptions and the total', async () => {
    const res = await submitAudit('C-1', {
      auditErrors: 1,
      errorExceptions: 2,
      result: 'PASS',
      remarks: 'Clean',
    }).expect(200);
    expect(res.body).toMatchObject({
      chartId: 'C-1',
      result: 'PASS',
      chartStatus: 'COMPLETED',
      auditErrors: 1,
      errorExceptions: 2,
      totalErrors: 3,
    });
    expect(await status('C-1')).toBe('COMPLETED');
    const rows = await db.sql<{
      audit_errors: number;
      error_exceptions: number;
      total_errors: number;
      status: string;
    }>(
      `SELECT a.audit_errors, a.error_exceptions, a.total_errors, a.status FROM audits a JOIN charts c ON c.id = a.chart_id WHERE c.chart_ref = 'C-1'`,
    );
    expect(rows).toEqual([{ audit_errors: 1, error_exceptions: 2, total_errors: 3, status: 'PASSED' }]);
    // A finished chart cannot be audited again, and leaves the queue.
    await submitAudit('C-1', { auditErrors: 0, errorExceptions: 0, result: 'PASS' }).expect(409);
    const q = await as(app, auditor.session).get('/audits/queue').expect(200);
    expect(q.body.items.map((i: { chartId: string }) => i.chartId)).not.toContain('C-1');
  });

  it('REVIEW_REQUIRED goes to the Manager, and only the Manager can resolve it', async () => {
    await submitAudit('C-2', {
      auditErrors: 5,
      errorExceptions: 1,
      result: 'REVIEW_REQUIRED',
      remarks: 'Missed codes',
    }).expect(200);
    expect(await status('C-2')).toBe('REVIEW_REQUIRED');

    const reviews = await as(app, manager).get('/audits/reviews').expect(200);
    expect(reviews.body.items).toHaveLength(1);
    expect(reviews.body.items[0]).toMatchObject({
      chartId: 'C-2',
      auditor: 'Audrey Auditor',
      coder: 'Coder A',
      totalErrors: 6,
      remarks: 'Missed codes',
    });
    const auditId = reviews.body.items[0].auditId;

    for (const who of [auditor.session, teamLead.session, coderA.session]) {
      await as(app, who).get('/audits/reviews').expect(403);
      await as(app, who).post(`/audits/${auditId}/resolve`, { decision: 'APPROVED' }).expect(403);
    }
    expect(await status('C-2')).toBe('REVIEW_REQUIRED');
  });

  it('reject needs a reason, sends the chart to rework, and approvals/rejections are final', async () => {
    const reviews = await as(app, manager).get('/audits/reviews').expect(200);
    const auditId = reviews.body.items[0].auditId;
    await as(app, manager).post(`/audits/${auditId}/resolve`, { decision: 'REJECTED' }).expect(422);
    const res = await as(app, manager)
      .post(`/audits/${auditId}/resolve`, { decision: 'REJECTED', reason: 'Recode the diagnoses' })
      .expect(200);
    expect(res.body).toMatchObject({ chartId: 'C-2', decision: 'REJECTED', chartStatus: 'REWORK' });
    expect(await status('C-2')).toBe('REWORK');
    await as(app, manager).post(`/audits/${auditId}/resolve`, { decision: 'APPROVED' }).expect(409);
    expect((await as(app, manager).get('/audits/reviews').expect(200)).body.total).toBe(0);
  });

  it('the coder reworks the chart as a new version, and the chart is re-audited', async () => {
    const mine = await as(app, coderA.session).get('/rework/mine').expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0]).toMatchObject({
      chartId: 'C-2',
      reason: 'Recode the diagnoses',
      previousIcds: 6,
      previousDos: 1,
      pages: 30,
    });
    const reworkId = mine.body.items[0].id;

    // Someone else's rework is invisible; the Manager and auditor cannot do it.
    expect((await as(app, coderB.session).get('/rework/mine').expect(200)).body.total).toBe(0);
    await as(app, coderB.session).post(`/rework/${reworkId}/submit`, { icds: 1, dos: 1 }).expect(404);
    await as(app, manager).post(`/rework/${reworkId}/submit`, { icds: 1, dos: 1 }).expect(403);
    await as(app, coderA.session).post(`/rework/${reworkId}/submit`, { icds: -2, dos: 1 }).expect(422);

    const res = await as(app, coderA.session)
      .post(`/rework/${reworkId}/submit`, { icds: 9, dos: 3 })
      .expect(200);
    expect(res.body).toMatchObject({ chartId: 'C-2', status: 'RE_AUDIT', icds: 9, dos: 3 });
    expect(await status('C-2')).toBe('RE_AUDIT');
    expect((await as(app, coderA.session).get('/rework/mine').expect(200)).body.total).toBe(0);
    await as(app, coderA.session).post(`/rework/${reworkId}/submit`, { icds: 9, dos: 3 }).expect(409);

    const versions = await db.sql<{ version: number; status: string; is_current: boolean; icds: number }>(
      `SELECT p.version, p.status, p.is_current, p.icds FROM production_entries p JOIN charts c ON c.id = p.chart_id WHERE c.chart_ref = 'C-2' ORDER BY p.version`,
    );
    expect(versions).toEqual([
      { version: 1, status: 'SUPERSEDED', is_current: false, icds: 6 },
      { version: 2, status: 'SUBMITTED', is_current: true, icds: 9 },
    ]);

    const q = await as(app, auditor.session).get('/audits/queue').expect(200);
    const item = q.body.items.find((i: { chartId: string }) => i.chartId === 'C-2');
    expect(item).toMatchObject({ isReAudit: true, icds: 9, dos: 3, version: 2 });

    // Re-audit passes → completed; history is kept.
    const done = await submitAudit('C-2', { auditErrors: 0, errorExceptions: 0, result: 'PASS' }).expect(200);
    expect(done.body.chartStatus).toBe('COMPLETED');
    expect(await status('C-2')).toBe('COMPLETED');
    const audits = await db.sql<{ sequence: number; status: string; is_re_audit: boolean }>(
      `SELECT a.sequence, a.status, a.is_re_audit FROM audits a JOIN charts c ON c.id = a.chart_id WHERE c.chart_ref = 'C-2' ORDER BY a.sequence`,
    );
    expect(audits).toEqual([
      { sequence: 1, status: 'REJECTED', is_re_audit: false },
      { sequence: 2, status: 'PASSED', is_re_audit: true },
    ]);
    const rework = await db.sql<{ status: string }>(`SELECT status FROM reworks`);
    expect(rework).toEqual([{ status: 'CLOSED' }]);
  });

  it('the Manager can approve a reviewed chart, which completes it', async () => {
    await submitAudit('C-3', { auditErrors: 2, errorExceptions: 0, result: 'REVIEW_REQUIRED' }).expect(200);
    const reviews = await as(app, manager).get('/audits/reviews').expect(200);
    const res = await as(app, manager)
      .post(`/audits/${reviews.body.items[0].auditId}/resolve`, { decision: 'APPROVED' })
      .expect(200);
    expect(res.body).toMatchObject({ chartId: 'C-3', decision: 'APPROVED', chartStatus: 'COMPLETED' });
    expect(await status('C-3')).toBe('COMPLETED');
  });

  it('audits that were passed cannot be resolved, and unknown ids are not found', async () => {
    const [passed] = await db.sql<{ id: string }>(
      `SELECT a.id FROM audits a JOIN charts c ON c.id = a.chart_id WHERE c.chart_ref = 'C-1'`,
    );
    await as(app, manager).post(`/audits/${passed!.id}/resolve`, { decision: 'APPROVED' }).expect(409);
    await as(app, manager)
      .post('/audits/00000000-0000-4000-8000-000000000000/resolve', { decision: 'APPROVED' })
      .expect(404);
  });

  it('records who did what in the chart timeline', async () => {
    const events = await db.sql<{ to_status: string }>(
      `SELECT e.to_status FROM chart_status_events e JOIN charts c ON c.id = e.chart_id WHERE c.chart_ref = 'C-2'`,
    );
    expect(events.map((e) => e.to_status).sort()).toEqual(
      [
        'ALLOCATED',
        'AUDITED',
        'CODED',
        'COMPLETED',
        'IN_PRODUCTION',
        'PENDING_ALLOCATION',
        'PENDING_AUDIT',
        'RE_AUDIT',
        'REVIEW_REQUIRED',
        'REWORK',
      ].sort(),
    );
    const log = await db.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE action IN ('AUDIT.CREATED','AUDIT.RESOLVED','REWORK.CREATED','REWORK.SUBMITTED','REAUDIT.CREATED')`,
    );
    const actions = log.map((l) => l.action);
    for (const a of [
      'AUDIT.CREATED',
      'AUDIT.RESOLVED',
      'REWORK.CREATED',
      'REWORK.SUBMITTED',
      'REAUDIT.CREATED',
    ]) {
      expect(actions).toContain(a);
    }
  });
});
