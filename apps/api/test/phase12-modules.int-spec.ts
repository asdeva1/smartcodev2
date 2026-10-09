import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { anonymous, as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Visitor Management, Internal Audit and the HR boundary (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let hr: Session;
  let lead: Session;
  let coder: Session;
  let hostId: string;
  const auditIds: string[] = [];

  beforeAll(async () => {
    db = await createTestDb();
    const fx = new Fixtures(db);
    await fx.org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const managerId = (await db.sql<{ id: string }>(`SELECT id FROM employees WHERE role = 'MANAGER'`))[0]!
      .id;
    const mk = (code: string, role: string) =>
      createActiveEmployee(app, manager, {
        employeeCode: code,
        fullName: `P12 ${code}`,
        email: `${code.toLowerCase()}@example.test`,
        role,
      });
    hr = (await mk('P12-HR', 'HR')).session;
    lead = (await mk('P12-TL', 'TEAM_LEAD')).session;
    const c = await mk('P12-CO', 'CODER');
    coder = c.session;
    hostId = c.id;

    // Three finished audits (two agree-able, one stricter) on synthetic charts.
    const auditor = await fx.employee({ role: 'AUDITOR' });
    const loginName = await fx.loginName();
    await fx.assignLoginName(loginName.id, c.id, managerId);
    const project = await fx.project();
    await fx.assignProject(project.id, c.id, 'CODER', managerId);
    for (const errors of [2, 0, 1]) {
      const chart = await fx.chart(project.id);
      const allocation = await fx.allocate(chart.id, loginName.id, c.id, managerId);
      await fx.setChartStatus(chart.id, 'ALLOCATED');
      await fx.setChartStatus(chart.id, 'IN_PRODUCTION');
      const entry = await db.prisma.productionEntry.create({
        data: {
          chartId: chart.id,
          coderId: c.id,
          loginNameId: loginName.id,
          allocationId: allocation.id,
          pageCount: 10,
          icds: 5,
          dos: 2,
        },
      });
      const now = new Date();
      await db.prisma.productionEntry.update({
        where: { id: entry.id },
        data: { status: 'SUBMITTED', submittedAt: now, codedAt: now },
      });
      await fx.setChartStatus(chart.id, 'CODED');
      await fx.setChartStatus(chart.id, 'PENDING_AUDIT');
      const audit = await db.prisma.audit.create({
        data: {
          chartId: chart.id,
          productionEntryId: entry.id,
          auditorId: auditor.id,
          auditErrors: errors,
          errorExceptions: 0,
          result: 'PASS',
          status: 'PASSED',
        },
      });
      auditIds.push(audit.id);
    }
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const visit = (extra: object = {}) => ({
    fullName: 'Asha Verma',
    company: 'Acme Health',
    phone: '+91 98765 43210',
    email: 'asha@acme.test',
    hostId,
    purpose: 'Contract review',
    ...extra,
  });

  it('HR registers a visit, checks the visitor in (badge + host notified) and out', async () => {
    const created = await as(app, hr).post('/visits', visit()).expect(201);
    expect(created.body).toMatchObject({ status: 'EXPECTED', badgeNumber: null });
    const id = created.body.id as string;
    await as(app, hr).get(`/visits/${id}/badge`).expect(409);

    const inn = await as(app, hr).post(`/visits/${id}/check-in`).expect(200);
    expect(inn.body.status).toBe('CHECKED_IN');
    expect(inn.body.badgeNumber).toMatch(/^V-\d{8}-001$/);
    await as(app, hr).post(`/visits/${id}/check-in`).expect(409);
    const badge = await as(app, hr).get(`/visits/${id}/badge`).expect(200);
    expect(badge.body).toMatchObject({ visitorName: 'Asha Verma', hostName: 'P12 P12-CO' });

    const bell = await as(app, coder).get('/notifications').expect(200);
    expect(JSON.stringify(bell.body)).toContain('Asha Verma has arrived');

    const list = await as(app, hr).get('/visits').expect(200);
    expect(list.body.insideNow).toBe(1);
    await as(app, hr).post(`/visits/${id}/cancel`, {}).expect(409);
    const out = await as(app, hr).post(`/visits/${id}/check-out`).expect(200);
    expect(out.body.status).toBe('CHECKED_OUT');
    await as(app, hr).post(`/visits/${id}/check-out`).expect(409);
  });

  it('a walk-in is checked in at once, badge numbers count up, and a returning visitor is not duplicated', async () => {
    const walkIn = await as(app, manager)
      .post('/visits', visit({ checkIn: true }))
      .expect(201);
    expect(walkIn.body.badgeNumber).toMatch(/-002$/);
    const second = await as(app, manager)
      .post('/visits', visit({ purpose: 'Follow-up', checkIn: true }))
      .expect(201);
    expect(second.body.badgeNumber).toMatch(/-003$/);
    const visitors = await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM visitors`);
    expect(visitors[0]?.n).toBe('1');
    const found = await as(app, hr).get('/visitors?q=asha').expect(200);
    expect(found.body).toHaveLength(1);
    const cancelled = await as(app, hr)
      .post('/visits', visit({ fullName: 'Ravi Kumar', email: 'ravi@x.test' }))
      .expect(201);
    await as(app, hr).post(`/visits/${cancelled.body.id}/cancel`, { reason: 'Postponed' }).expect(200);
    const filtered = await as(app, hr).get('/visits?status=CANCELLED').expect(200);
    expect(filtered.body.total).toBe(1);
  });

  it('validates the visit and limits visitor management to HR and the Manager', async () => {
    await as(app, hr)
      .post('/visits', visit({ hostId: '00000000-0000-4000-8000-000000000000' }))
      .expect(422);
    await as(app, hr)
      .post('/visits', visit({ purpose: 'x' }))
      .expect(422);
    await as(app, hr)
      .post('/visits', visit({ email: 'not-an-email' }))
      .expect(422);
    await as(app, lead).get('/visits').expect(403);
    await as(app, coder).post('/visits', visit()).expect(403);
    await anonymous(app).get('/visits').expect(401);
  });

  it('Internal Audit: the Manager samples audits, reviews them, and sees agreement per auditor', async () => {
    const sample = await as(app, manager).get('/internal-audit/sample?size=10').expect(200);
    expect(sample.body).toHaveLength(3);
    expect(sample.body[0]).toHaveProperty('auditorErrors');

    // errors 2 → agree; errors 0 → disagree (found 3); errors 1 → disagree (found 0)
    const found = [2, 3, 0];
    const outcomes: string[] = [];
    for (const [i, auditId] of auditIds.entries()) {
      const rev = await as(app, manager)
        .post('/internal-audit/reviews', { auditId, independentErrors: found[i], notes: 'Checked' })
        .expect(201);
      outcomes.push(rev.body.outcome);
    }
    expect(outcomes).toEqual(['AGREE', 'DISAGREE', 'DISAGREE']);
    await as(app, manager)
      .post('/internal-audit/reviews', { auditId: auditIds[0], independentErrors: 2 })
      .expect(409);
    await as(app, manager)
      .post('/internal-audit/reviews', { auditId: auditIds[0], independentErrors: -1 })
      .expect(422);
    expect((await as(app, manager).get('/internal-audit/sample').expect(200)).body).toHaveLength(0);

    const summary = await as(app, manager).get('/internal-audit/summary').expect(200);
    expect(summary.body).toMatchObject({ reviewed: 3, agreed: 1, agreementPct: 33.3 });
    expect(summary.body.auditors[0]).toMatchObject({ reviewed: 3, averageGap: 0.7 });
    const list = await as(app, manager).get('/internal-audit/reviews?outcome=DISAGREE').expect(200);
    expect(list.body.total).toBe(2);

    for (const who of [hr, lead, coder]) {
      await as(app, who).get('/internal-audit/sample').expect(403);
      await as(app, who)
        .post('/internal-audit/reviews', { auditId: auditIds[0], independentErrors: 1 })
        .expect(403);
    }
  });

  it('the HR integration boundary reports that no HRMS is connected, to HR and the Manager only', async () => {
    const res = await as(app, hr).get('/hr-integration/status').expect(200);
    expect(res.body).toMatchObject({ configured: false, adapter: 'none', identity: 'EMPLOYEE_ID' });
    expect(res.body.points.length).toBeGreaterThan(0);
    await as(app, manager).get('/hr-integration/status').expect(200);
    await as(app, lead).get('/hr-integration/status').expect(403);
  });
});
