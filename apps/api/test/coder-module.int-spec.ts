import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Coder module: hold, remarks, dashboard and notifications (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coder: { id: string; session: Session };
  let other: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let projectId: string;
  const chartIds: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (role: string, code: string, email: string, fullName: string) =>
      createActiveEmployee(app, manager, { employeeCode: code, fullName, email, role });
    coder = await mk('CODER', 'CM-C', 'cm@example.test', 'Coder M');
    other = await mk('CODER', 'CM-O', 'co@example.test', 'Coder O');
    auditor = await mk('AUDITOR', 'CM-A', 'ca@example.test', 'Audrey Auditor');
    const project = await as(app, manager)
      .post('/projects', { clientName: 'Acme', name: 'Coder module', allocationType: 'MANUAL' })
      .expect(201);
    projectId = project.body.id;
    await as(app, manager)
      .post(`/projects/${projectId}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
    const csv = [
      'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks',
      'cm@vlms.com,cm@example.test,H-1,12,1-25,',
      'cm@vlms.com,cm@example.test,H-2,30,26-50,',
      'cm@vlms.com,cm@example.test,H-3,8,1-25,',
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

  const post = (ref: string, action: string, body?: object, who = coder) =>
    as(app, who.session).post(`/production/charts/${chartIds[ref]}/${action}`, body);
  const heldAt = async (ref: string) =>
    (await db.sql<{ held_at: Date | null }>(`SELECT held_at FROM charts WHERE chart_ref = $1`, [ref]))[0]
      ?.held_at;

  it('opening shows no hold; the first open starts the work clock', async () => {
    const res = await post('H-1', 'open').expect(200);
    expect(res.body).toMatchObject({ chartId: 'H-1', pages: 12, heldAt: null, holdReason: null });
    const [row] = await db.sql<{ work_started_at: Date | null }>(
      `SELECT work_started_at FROM charts WHERE chart_ref = 'H-1'`,
    );
    expect(row?.work_started_at).not.toBeNull();
  });

  it('holding needs a reason, and only the coder who holds the chart can hold it', async () => {
    await post('H-1', 'hold', {}).expect(422);
    await post('H-1', 'hold', { reason: '  ' }).expect(422);
    await post('H-1', 'hold', { reason: 'Need client clarification' }, other).expect(404);
    await as(app, manager)
      .post(`/production/charts/${chartIds['H-1']}/hold`, { reason: 'Because' })
      .expect(403);
    expect(await heldAt('H-1')).toBeNull();
  });

  it('a held chart shows its reason, cannot be submitted, and the Manager cannot pull it back', async () => {
    const res = await post('H-1', 'hold', { reason: 'Need client clarification' }).expect(200);
    expect(res.body).toMatchObject({ heldAt: expect.any(String), holdReason: 'Need client clarification' });
    await post('H-1', 'hold', { reason: 'Again' }).expect(409);

    // Submit refused while on hold.
    const blocked = await post('H-1', 'submit', { icds: 3, dos: 1 }).expect(409);
    expect(blocked.body.code).toBe('CHART_ON_HOLD');

    // The coder and the Manager both see the hold.
    const mine = await as(app, coder.session).get('/allocation/mine').expect(200);
    expect(mine.body.charts.find((c: { chartId: string }) => c.chartId === 'H-1')).toMatchObject({
      holdReason: 'Need client clarification',
    });
    const list = await as(app, manager).get(`/projects/${projectId}/charts`).expect(200);
    expect(list.body.items.find((c: { chartId: string }) => c.chartId === 'H-1')).toMatchObject({
      holdReason: 'Need client clarification',
    });

    // Pull-back: the held chart is skipped, the other is pulled back.
    const pull = await as(app, manager)
      .post(`/projects/${projectId}/charts/pull-back`, { chartIds: [chartIds['H-1'], chartIds['H-3']] })
      .expect(200);
    expect(pull.body).toEqual({ pulledBack: 1, skipped: 1 });
    const [h1] = await db.sql<{ status: string }>(`SELECT status FROM charts WHERE chart_ref = 'H-1'`);
    expect(h1?.status).toBe('IN_PRODUCTION');
    const [h3] = await db.sql<{ status: string }>(`SELECT status FROM charts WHERE chart_ref = 'H-3'`);
    expect(h3?.status).toBe('PENDING_ALLOCATION');
  });

  it('resuming clears the hold, adds the held time and allows submitting with remarks', async () => {
    // Make the hold look 10 minutes old so the held time is measurable.
    await db.sql(`UPDATE charts SET held_at = now() - interval '10 minutes' WHERE chart_ref = 'H-1'`);
    await post('H-1', 'resume').expect(200);
    await post('H-1', 'resume').expect(409);
    const [row] = await db.sql<{ held_at: Date | null; hold_reason: string | null; held_seconds: number }>(
      `SELECT held_at, hold_reason, held_seconds FROM charts WHERE chart_ref = 'H-1'`,
    );
    expect(row?.held_at).toBeNull();
    expect(row?.hold_reason).toBeNull();
    expect(row?.held_seconds).toBeGreaterThanOrEqual(599);

    // Pretend the chart was opened 70 minutes ago: 70 min − 10 min on hold = ~60 min active.
    await db.sql(`UPDATE charts SET work_started_at = now() - interval '70 minutes' WHERE chart_ref = 'H-1'`);
    await post('H-1', 'submit', { icds: 5, dos: 3, remarks: 'Two charts were unclear' }).expect(200);
    const [entry] = await db.sql<{ remarks: string | null; active_seconds: number }>(
      `SELECT remarks, active_seconds FROM production_entries WHERE chart_id = $1`,
      [chartIds['H-1']],
    );
    expect(entry?.remarks).toBe('Two charts were unclear');
    expect(entry?.active_seconds).toBeGreaterThanOrEqual(3590);
    expect(entry?.active_seconds).toBeLessThanOrEqual(3620);
  });

  it('the dashboard shows total, today, CPH from active time, and no audit % before an audit', async () => {
    const res = await as(app, coder.session).get('/production/dashboard').expect(200);
    expect(res.body).toMatchObject({
      totalCoded: 1,
      todayCoded: 1,
      auditPercentage: null,
      auditedCharts: 0,
      onHold: 0,
    });
    // 1 chart in ~1 active hour.
    expect(res.body.cph).toBeGreaterThanOrEqual(0.9);
    expect(res.body.cph).toBeLessThanOrEqual(1.1);
    // Other roles have no coder dashboard.
    await as(app, manager).get('/production/dashboard').expect(403);
    const empty = await as(app, other.session).get('/production/dashboard').expect(200);
    expect(empty.body).toMatchObject({ totalCoded: 0, todayCoded: 0, cph: null, auditPercentage: null });
  });

  it('an audit with errors notifies the coder and sets the audit percentage', async () => {
    // H-1 has 5 ICDs + 3 DOS = 8; the auditor finds 1 audit error + 1 exception = 2 → 75 %.
    await as(app, auditor.session)
      .post(`/audits/charts/${chartIds['H-1']}/submit`, {
        auditErrors: 1,
        errorExceptions: 1,
        result: 'PASS',
      })
      .expect(200);

    const list = await as(app, coder.session).get('/notifications').expect(200);
    expect(list.body.unread).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      type: 'AUDIT_ERRORS',
      subject: 'Audit errors on chart H-1',
      entityType: 'Chart',
      entityId: chartIds['H-1'],
      readAt: null,
    });
    expect(list.body.items[0].message).toContain('2 errors');

    const dash = await as(app, coder.session).get('/production/dashboard').expect(200);
    expect(dash.body).toMatchObject({ auditPercentage: 75, auditedCharts: 1, totalErrors: 2 });

    // Notifications are private to the recipient.
    const others = await as(app, other.session).get('/notifications').expect(200);
    expect(others.body).toEqual({ unread: 0, items: [] });
    await as(app, other.session).post(`/notifications/${list.body.items[0].id}/read`).expect(404);
  });

  it('an error-free audit sends no notification; read and read-all clear the bell', async () => {
    await post('H-2', 'open').expect(200);
    await post('H-2', 'submit', { icds: 2, dos: 2 }).expect(200);
    await as(app, auditor.session)
      .post(`/audits/charts/${chartIds['H-2']}/submit`, {
        auditErrors: 0,
        errorExceptions: 0,
        result: 'PASS',
      })
      .expect(200);
    const list = await as(app, coder.session).get('/notifications').expect(200);
    expect(list.body.items).toHaveLength(1);

    await as(app, coder.session).post(`/notifications/${list.body.items[0].id}/read`).expect(204);
    await as(app, coder.session).post(`/notifications/${list.body.items[0].id}/read`).expect(204); // idempotent
    const after = await as(app, coder.session).get('/notifications').expect(200);
    expect(after.body.unread).toBe(0);
    expect(after.body.items[0].readAt).not.toBeNull();
    const all = await as(app, coder.session).post('/notifications/read-all').expect(200);
    expect(all.body).toEqual({ marked: 0 });
  });

  it('the client pull-back still returns a held chart and clears its hold', async () => {
    const csv = [
      'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks',
      'cm@vlms.com,cm@example.test,H-9,4,1-25,',
    ].join('\n');
    await as(app, manager)
      .post(`/projects/${projectId}/allocation/commit`, { csv, mode: 'all-or-nothing' })
      .expect(200);
    const list = await as(app, manager).get(`/projects/${projectId}/charts?q=H-9`).expect(200);
    chartIds['H-9'] = list.body.items[0].id;
    await post('H-9', 'open').expect(200);
    await post('H-9', 'hold', { reason: 'Waiting' }).expect(200);
    await as(app, manager)
      .post(`/projects/${projectId}/client-pullback`, { reason: 'Client withdrew the project' })
      .expect(200);
    const [row] = await db.sql<{ status: string; held_at: Date | null; held_seconds: number }>(
      `SELECT status, held_at, held_seconds FROM charts WHERE chart_ref = 'H-9'`,
    );
    expect(row).toMatchObject({ status: 'PENDING_ALLOCATION', held_at: null, held_seconds: 0 });
  });
});
