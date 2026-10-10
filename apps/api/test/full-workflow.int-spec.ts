import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(180_000);

/**
 * The mandatory end-to-end workflow (docs/13-testing-strategy.md §2), on the real application and real PostgreSQL:
 * create people → activate → sign in → vendor → client → project → import charts → login name → allocate →
 * coder production → audit → review required → Manager rejects → rework → re-audit → completion,
 * with the negative checks (wrong role, other vendor, second allocation) inside the same run.
 */
describeDb('Mandatory end-to-end workflow (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let vendorA: string;
  let vendorB: string;
  let adminA: Session;
  let adminB: Session;
  let lead: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let coder: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let projectId: string;
  const charts: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const status = async (ref: string) =>
    (await db.sql<{ status: string }>(`SELECT status FROM charts WHERE chart_ref = $1`, [ref]))[0]?.status;

  it('1. creates two vendors and activates staff who can sign in', async () => {
    const mkVendor = async (code: string, name: string) =>
      (
        await as(app, manager)
          .post('/vendors', {
            code,
            name,
            admin: {
              employeeCode: `${code}-ADM`,
              fullName: `${name} Admin`,
              email: `${code.toLowerCase()}adm@example.test`,
            },
            sendActivation: true,
          })
          .expect(201)
      ).body.id as string;
    vendorA = await mkVendor('E2EA', 'Vendor Alpha');
    vendorB = await mkVendor('E2EB', 'Vendor Beta');
    const mk = (code: string, email: string, role: string, vendorId?: string) =>
      createActiveEmployee(app, manager, {
        employeeCode: code,
        fullName: `E2E ${code}`,
        email,
        role,
        ...(vendorId ? { vendorId } : {}),
      });
    adminA = (await mk('E2E-VA', 'e2eva@example.test', 'VENDOR_ADMIN', vendorA)).session;
    adminB = (await mk('E2E-VB', 'e2evb@example.test', 'VENDOR_ADMIN', vendorB)).session;
    lead = await mk('E2E-TL', 'e2etl@example.test', 'TEAM_LEAD', vendorA);
    auditor = await mk('E2E-AU', 'e2eau@example.test', 'AUDITOR', vendorA);
    coder = await mk('E2E-CO', 'e2eco@example.test', 'CODER', vendorA);
    coderB = await mk('E2E-CB', 'e2ecb@example.test', 'CODER', vendorB);
    const me = await as(app, coder.session).get('/auth/me').expect(200);
    expect(me.body.employee).toMatchObject({ role: 'CODER', status: 'ACTIVE' });
  });

  it('2. creates the project, staffs it and imports the chart file', async () => {
    const project = await as(app, manager)
      .post('/projects', {
        clientName: 'Acme Health',
        name: 'E2E Project',
        allocationType: 'MANUAL',
        vendorId: vendorA,
        leadId: lead.id,
      })
      .expect(201);
    projectId = project.body.id;
    await as(app, manager)
      .post(`/projects/${projectId}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
    await as(app, manager)
      .post(`/projects/${projectId}/members`, { employeeId: coder.id, projectRole: 'CODER' })
      .expect(200);

    // The chart file: two charts allotted straight away, one waiting in the repository.
    const csv = [
      'ChartID,PageCount,PageBucket,Emp Email,Client Login,Status,comments',
      'TEST-CHART-0001,12,1-25 Pages,e2eco@example.test,e2eco@vlms.com,,',
      'TEST-CHART-0002,30,26-50 Pages,e2eco@example.test,e2eco@vlms.com,,',
      'TEST-CHART-0003,8,1-25 Pages,,,,',
    ].join('\n');
    const preview = await as(app, manager)
      .post(`/projects/${projectId}/charts/import/preview`, { csv })
      .expect(200);
    expect(preview.body.fileErrors).toEqual([]);
    await as(app, manager)
      .post(`/projects/${projectId}/charts/import/commit`, { csv, mode: 'all-or-nothing' })
      .expect(200);
    const list = await as(app, manager).get(`/projects/${projectId}/charts`).expect(200);
    expect(list.body.total).toBe(3);
    for (const c of list.body.items) charts[c.chartId] = c.id;
    expect(await status('TEST-CHART-0001')).toBe('ALLOCATED');
    expect(await status('TEST-CHART-0003')).toBe('PENDING_ALLOCATION');

    // Manual "Assign chart" for the waiting one.
    await as(app, manager)
      .post(`/projects/${projectId}/charts/assign`, {
        chartId: 'TEST-CHART-0003',
        loginName: 'e2eco@vlms.com',
        email: 'e2eco@example.test',
      })
      .expect(200);
    expect(await status('TEST-CHART-0003')).toBe('ALLOCATED');
    const mine = await as(app, coder.session).get('/allocation/mine').expect(200);
    expect(mine.body.total).toBe(3);
  });

  it('3. the coder produces; the auditor passes one and sends one to review', async () => {
    await as(app, coder.session)
      .post(`/production/charts/${charts['TEST-CHART-0001']}/submit`, { icds: 4, dos: 1 })
      .expect(200);
    await as(app, coder.session)
      .post(`/production/charts/${charts['TEST-CHART-0002']}/submit`, { icds: 6, dos: 2 })
      .expect(200);
    expect(await status('TEST-CHART-0002')).toBe('PENDING_AUDIT');
    await as(app, auditor.session)
      .post(`/audits/charts/${charts['TEST-CHART-0001']}/submit`, {
        auditErrors: 0,
        errorExceptions: 0,
        result: 'PASS',
      })
      .expect(200);
    expect(await status('TEST-CHART-0001')).toBe('COMPLETED');
    await as(app, auditor.session)
      .post(`/audits/charts/${charts['TEST-CHART-0002']}/submit`, {
        auditErrors: 4,
        errorExceptions: 1,
        result: 'REVIEW_REQUIRED',
      })
      .expect(200);
    expect(await status('TEST-CHART-0002')).toBe('REVIEW_REQUIRED');
  });

  it('4. negative: a Team Lead cannot resolve the review; the second allocation of a chart is refused', async () => {
    const reviews = await as(app, manager).get('/audits/reviews').expect(200);
    const auditId = reviews.body.items[0].auditId as string;
    await as(app, lead.session).post(`/audits/${auditId}/resolve`, { decision: 'APPROVED' }).expect(403);
    await as(app, auditor.session).post(`/audits/${auditId}/resolve`, { decision: 'APPROVED' }).expect(403);

    // The same chart cannot be given to another coder while it is allocated.
    await as(app, manager)
      .post(`/projects/${projectId}/charts/assign`, {
        chartId: 'TEST-CHART-0003',
        loginName: 'e2ecb@vlms.com',
        email: 'e2ecb@example.test',
      })
      .expect((res) => {
        // Refused either as an HTTP error or as a rejected row in the result.
        const refused =
          res.status >= 400 ||
          JSON.stringify(res.body).includes('"valid":0') ||
          res.body.committed === 0 ||
          res.body.applied === 0;
        expect({ status: res.status, body: res.body, refused }).toMatchObject({ refused: true });
      });
    const holders = await db.sql(
      `SELECT 1 FROM chart_allocations a JOIN charts c ON c.id = a.chart_id WHERE c.chart_ref = 'TEST-CHART-0003' AND a.status = 'ACTIVE'`,
    );
    expect(holders).toHaveLength(1);
  });

  it('5. the Manager rejects; the coder reworks; the re-audit passes and the chart is completed', async () => {
    const reviews = await as(app, manager).get('/audits/reviews').expect(200);
    const auditId = reviews.body.items[0].auditId as string;
    const res = await as(app, manager)
      .post(`/audits/${auditId}/resolve`, { decision: 'REJECTED', reason: 'Recode the diagnoses' })
      .expect(200);
    expect(res.body.chartStatus).toBe('REWORK');
    const rework = await as(app, coder.session).get('/rework/mine').expect(200);
    await as(app, coder.session)
      .post(`/rework/${rework.body.items[0].id}/submit`, { icds: 8, dos: 2 })
      .expect(200);
    expect(await status('TEST-CHART-0002')).toBe('RE_AUDIT');
    await as(app, auditor.session)
      .post(`/audits/charts/${charts['TEST-CHART-0002']}/submit`, {
        auditErrors: 0,
        errorExceptions: 0,
        result: 'PASS',
      })
      .expect(200);
    expect(await status('TEST-CHART-0002')).toBe('COMPLETED');
  });

  it('6. every screen agrees: timeline, repository, dashboards, reports, activity, audit log', async () => {
    const timeline = await as(app, manager).get(`/charts/${charts['TEST-CHART-0002']}/timeline`).expect(200);
    const path = timeline.body.events.map((e: { toStatus: string }) => e.toStatus);
    expect(path).toEqual(
      expect.arrayContaining([
        'ALLOCATED',
        'PENDING_AUDIT',
        'REVIEW_REQUIRED',
        'REWORK',
        'RE_AUDIT',
        'COMPLETED',
      ]),
    );

    const repo = await as(app, manager).get(`/charts?projectId=${projectId}`).expect(200);
    expect(repo.body.statusCounts).toMatchObject({ COMPLETED: 2, ALLOCATED: 1 });

    const dash = await as(app, manager).get('/dashboards/manager').expect(200);
    expect(dash.body.charts.completed).toBe(2);
    const vendorDash = await as(app, adminA).get('/dashboards/vendor').expect(200);
    expect(vendorDash.body.charts.completed).toBe(2);
    expect(vendorDash.body.coders[0]).toMatchObject({ fullName: 'E2E E2E-CO', chartsMonth: 2 });
    const teamDash = await as(app, lead.session).get('/dashboards/team-lead').expect(200);
    expect(teamDash.body.teams).toEqual([]);

    const csv = await as(app, manager)
      .get(`/projects/${projectId}/reports/quality/export?range=today&format=csv`)
      .expect(200);
    expect(csv.text).toContain('E2E E2E-CO');
    const pdf = await as(app, adminA)
      .get(`/projects/${projectId}/reports/production/export?range=today&format=pdf`)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const activity = await as(app, manager).get('/activity?pageSize=100').expect(200);
    expect(activity.body.total).toBeGreaterThan(5);
    const audit = await as(app, manager).get('/audit-logs?action=AUDIT.RESOLVED').expect(200);
    expect(audit.body.total).toBe(1);
  });

  it('7. negative: Vendor Beta sees nothing of Vendor Alpha anywhere', async () => {
    const aliens = [
      `/employees/${coder.id}`,
      `/projects/${projectId}`,
      `/projects/${projectId}/charts`,
      `/projects/${projectId}/reports/production`,
      `/projects/${projectId}/reports/production/export?format=csv`,
      `/charts/${charts['TEST-CHART-0001']}/timeline`,
    ];
    for (const url of aliens) {
      const res = await as(app, adminB).get(url);
      expect([403, 404]).toContain(res.status);
    }
    const repo = await as(app, adminB).get('/charts').expect(200);
    expect(repo.body.total).toBe(0);
    const emps = await as(app, adminB).get('/employees?pageSize=100').expect(200);
    expect(JSON.stringify(emps.body)).not.toContain('e2eco@example.test');
    const dash = await as(app, adminB).get('/dashboards/vendor').expect(200);
    expect(dash.body.charts.total).toBe(0);
    expect(dash.body.coders.map((c: { fullName: string }) => c.fullName)).toEqual(['E2E E2E-CB']);
    const logs = await as(app, adminB).get('/activity').expect(200);
    expect(JSON.stringify(logs.body)).not.toContain('E2E-CO');
    await as(app, coderB.session).get(`/charts/${charts['TEST-CHART-0001']}/timeline`).expect(404);
  });

  it('8. closing the project goes through approval and is audited', async () => {
    const asked = await as(app, lead.session)
      .post('/approvals', { type: 'PROJECT_CLOSURE', entityId: projectId, comments: 'All charts done' })
      .expect(201);
    await as(app, manager).post(`/approvals/${asked.body.id}/decision`, { decision: 'APPROVED' }).expect(200);
    const [p] = await db.sql<{ status: string }>(`SELECT status FROM projects WHERE id = $1`, [projectId]);
    expect(p?.status).toBe('CLOSED');
  });
});
