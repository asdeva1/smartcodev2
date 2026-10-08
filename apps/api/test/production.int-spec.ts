import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Coder workspace: open a chart, enter ICDs and DOS, submit (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coderA: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let projectId: string;
  const chartIds: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    coderA = await createActiveEmployee(app, manager, {
      employeeCode: 'PR-A',
      fullName: 'Coder A',
      email: 'pa@example.test',
      role: 'CODER',
    });
    coderB = await createActiveEmployee(app, manager, {
      employeeCode: 'PR-B',
      fullName: 'Coder B',
      email: 'pb@example.test',
      role: 'CODER',
    });
    const project = await as(app, manager)
      .post('/projects', { clientName: 'Acme', name: 'Prod', allocationType: 'MANUAL' })
      .expect(201);
    projectId = project.body.id;
    const csv = [
      'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks',
      'pa@vlms.com,pa@example.test,C-1,12,1-25,',
      'pa@vlms.com,pa@example.test,C-2,30,26-50,',
      'pb@vlms.com,pb@example.test,C-3,8,1-25,',
    ].join('\n');
    await as(app, manager)
      .post(`/projects/${projectId}/allocation/commit`, { csv, mode: 'all-or-nothing' })
      .expect(200);
    const list = await as(app, manager).get(`/projects/${projectId}/charts`).expect(200);
    for (const c of list.body.items) chartIds[c.chartId] = c.id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const status = async (ref: string) =>
    (await db.sql<{ status: string }>(`SELECT status FROM charts WHERE chart_ref = $1`, [ref]))[0]?.status;

  it('opening a chart shows its fixed details and moves it to In production', async () => {
    const res = await as(app, coderA.session).post(`/production/charts/${chartIds['C-1']}/open`).expect(200);
    expect(res.body).toMatchObject({
      chartId: 'C-1',
      pages: 12,
      pageBucket: '1-25',
      status: 'IN_PRODUCTION',
      loginName: 'pa@vlms.com',
    });
    expect(await status('C-1')).toBe('IN_PRODUCTION');
    // Opening again changes nothing.
    await as(app, coderA.session).post(`/production/charts/${chartIds['C-1']}/open`).expect(200);
    const live = await as(app, manager).get(`/projects/${projectId}/live`).expect(200);
    expect(live.body.inProduction).toBe(1);
  });

  it('another coder, or the Manager, cannot open or submit someone else’s chart', async () => {
    await as(app, coderB.session).post(`/production/charts/${chartIds['C-1']}/open`).expect(404);
    await as(app, coderB.session)
      .post(`/production/charts/${chartIds['C-1']}/submit`, { icds: 1, dos: 1 })
      .expect(404);
    await as(app, manager).post(`/production/charts/${chartIds['C-1']}/open`).expect(403);
    await as(app, manager)
      .post(`/production/charts/${chartIds['C-1']}/submit`, { icds: 1, dos: 1 })
      .expect(403);
  });

  it('refuses missing, negative and non-numeric ICDs / DOS', async () => {
    for (const body of [
      {},
      { icds: -1, dos: 2 },
      { icds: 'x', dos: 2 },
      { icds: 1.5, dos: 2 },
      { icds: 3 },
    ]) {
      await as(app, coderA.session).post(`/production/charts/${chartIds['C-1']}/submit`, body).expect(422);
    }
    expect(await status('C-1')).toBe('IN_PRODUCTION');
  });

  it('submitting records the production, sends the chart to audit and reduces both allocations', async () => {
    const before = await as(app, coderA.session).get('/allocation/mine').expect(200);
    expect(before.body.total).toBe(2);
    const res = await as(app, coderA.session)
      .post(`/production/charts/${chartIds['C-1']}/submit`, { icds: 5, dos: 2 })
      .expect(200);
    expect(res.body).toEqual({ chartId: 'C-1', status: 'PENDING_AUDIT', icds: 5, dos: 2, pages: 12 });

    const [entry] = await db.sql<{
      page_count: number;
      icds: number;
      dos: number;
      status: string;
      version: number;
    }>(`SELECT page_count, icds, dos, status, version FROM production_entries WHERE chart_id = $1`, [
      chartIds['C-1'],
    ]);
    expect(entry).toEqual({ page_count: 12, icds: 5, dos: 2, status: 'SUBMITTED', version: 1 });
    expect(await status('C-1')).toBe('PENDING_AUDIT');
    // Events inside one transaction share a timestamp, so assert the set of transitions, not their order.
    const events = await db.sql<{ to_status: string; actor_id: string | null }>(
      `SELECT to_status, actor_id FROM chart_status_events WHERE chart_id = $1`,
      [chartIds['C-1']],
    );
    expect(events.map((e) => e.to_status).sort()).toEqual(
      ['ALLOCATED', 'CODED', 'IN_PRODUCTION', 'PENDING_ALLOCATION', 'PENDING_AUDIT'].sort(),
    );
    expect(events.find((e) => e.to_status === 'PENDING_AUDIT')?.actor_id).toBe(coderA.id);

    // Coder allotment goes down.
    const after = await as(app, coderA.session).get('/allocation/mine').expect(200);
    expect(after.body.charts.map((c: { chartId: string }) => c.chartId)).toEqual(['C-2']);
    // Manager allocation goes down: member counts, project status counts and live tracking.
    const detail = await as(app, manager).get(`/projects/${projectId}`).expect(200);
    const a = detail.body.members.find((m: { fullName: string }) => m.fullName === 'Coder A');
    expect(a.openCharts).toBe(1);
    expect(detail.body.chartsByStatus).toMatchObject({ ALLOCATED: 2, PENDING_AUDIT: 1 });
    const live = await as(app, manager).get(`/projects/${projectId}/live`).expect(200);
    expect(live.body).toMatchObject({ doneToday: 1, inProduction: 0, allocated: 2 });
    const report = await as(app, manager)
      .get(`/projects/${projectId}/reports/production?range=today`)
      .expect(200);
    expect(report.body.totals).toEqual({ charts: 1, pages: 12, icds: 5, dos: 2 });
    const logs = await db.sql(`SELECT 1 FROM audit_logs WHERE action = 'PRODUCTION.SUBMITTED'`);
    expect(logs).toHaveLength(1);
  });

  it('a submitted chart cannot be submitted or reopened for editing again', async () => {
    await as(app, coderA.session)
      .post(`/production/charts/${chartIds['C-1']}/submit`, { icds: 9, dos: 9 })
      .expect(409);
    const reopen = await as(app, coderA.session)
      .post(`/production/charts/${chartIds['C-1']}/open`)
      .expect(200);
    expect(reopen.body.status).toBe('PENDING_AUDIT');
  });

  it('a chart can be submitted straight from Allocated (open and submit in one step)', async () => {
    await as(app, coderB.session)
      .post(`/production/charts/${chartIds['C-3']}/submit`, { icds: 0, dos: 0 })
      .expect(200);
    expect(await status('C-3')).toBe('PENDING_AUDIT');
    const mine = await as(app, coderB.session).get('/allocation/mine').expect(200);
    expect(mine.body.total).toBe(0);
  });

  it('after a client pull-back, only charts still with the coder are cleared; submitted work stays', async () => {
    const res = await as(app, manager)
      .post(`/projects/${projectId}/client-pullback`, { reason: 'Client recall' })
      .expect(200);
    expect(res.body.pulledBack).toBe(1);
    expect(await status('C-2')).toBe('PENDING_ALLOCATION');
    expect(await status('C-1')).toBe('PENDING_AUDIT');
  });
});
