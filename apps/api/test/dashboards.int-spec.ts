import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { anonymous, as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Phase 11 — Manager dashboard (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let vendorId: string;
  let vendorAdmin: Session;
  let coder: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let vendorCoder: { id: string; session: Session };
  const ids: Record<string, string> = {};

  const dash = (qs = '', who = manager) => as(app, who).get(`/dashboards/manager${qs}`);

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (role: string, code: string, email: string, extra: object = {}) =>
      createActiveEmployee(app, manager, {
        employeeCode: code,
        fullName: `D ${code}`,
        email,
        role,
        ...extra,
      });
    coder = await mk('CODER', 'D-C', 'dc@example.test');
    auditor = await mk('AUDITOR', 'D-A', 'da@example.test');

    const vendor = await as(app, manager)
      .post('/vendors', {
        code: 'DV1',
        name: 'Dash Vendor',
        admin: { employeeCode: 'D-VA', fullName: 'Vendor Admin', email: 'dva@example.test' },
        sendActivation: true,
      })
      .expect(201);
    vendorId = vendor.body.id;
    vendorAdmin = (
      await createActiveEmployee(app, manager, {
        employeeCode: 'D-VA2',
        fullName: 'Vendor Admin 2',
        email: 'dva2@example.test',
        role: 'VENDOR_ADMIN',
        vendorId,
      })
    ).session;
    vendorCoder = await mk('CODER', 'D-VC', 'dvc@example.test', { vendorId });

    const inHouse = await as(app, manager)
      .post('/projects', { clientName: 'Acme', name: 'In-house work', allocationType: 'MANUAL' })
      .expect(201);
    const vendorProject = await as(app, manager)
      .post('/projects', { clientName: 'Acme', name: 'Vendor work', allocationType: 'MANUAL', vendorId })
      .expect(201);
    await as(app, manager)
      .post(`/projects/${inHouse.body.id}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
    const upload = (projectId: string, csv: string) =>
      as(app, manager)
        .post(`/projects/${projectId}/allocation/commit`, { csv, mode: 'all-or-nothing' })
        .expect(200);
    const H = 'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks';
    await upload(
      inHouse.body.id,
      [
        H,
        'dc@vlms.com,dc@example.test,I-1,12,,',
        'dc@vlms.com,dc@example.test,I-2,30,,',
        'dc@vlms.com,dc@example.test,I-3,8,,',
      ].join('\n'),
    );
    await upload(
      vendorProject.body.id,
      [H, 'dvc@vlms.com,dvc@example.test,V-1,20,,', 'dvc@vlms.com,dvc@example.test,V-2,5,,'].join('\n'),
    );
    for (const p of [inHouse.body.id, vendorProject.body.id]) {
      const list = await as(app, manager).get(`/projects/${p}/charts`).expect(200);
      for (const c of list.body.items) ids[c.chartId] = c.id;
    }
    // The in-house coder submits two charts; the auditor audits one (8 ICD+DOS, 2 errors → 75 %).
    await as(app, coder.session)
      .post(`/production/charts/${ids['I-1']}/submit`, { icds: 5, dos: 3 })
      .expect(200);
    await as(app, coder.session)
      .post(`/production/charts/${ids['I-2']}/submit`, { icds: 10, dos: 2 })
      .expect(200);
    await as(app, auditor.session)
      .post(`/audits/charts/${ids['I-1']}/submit`, { auditErrors: 1, errorExceptions: 1, result: 'PASS' })
      .expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('shows organization-wide counts, production, audit status and accuracy (in-house and vendor combined)', async () => {
    const res = await dash().expect(200);
    expect(res.body.people).toMatchObject({ projects: 2, teams: 0, activeCoders: 2, activeAuditors: 1 });
    expect(res.body.charts).toMatchObject({ total: 5, inProgress: 3, pendingAudit: 1, pendingAllocation: 0 });
    expect(res.body.production.today).toEqual({ charts: 2, pages: 42, icds: 15, dos: 5 });
    expect(res.body.production.month.charts).toBe(2);
    expect(res.body.audits).toEqual({ pending: 1, completed: 1 });
    expect(res.body.performance).toMatchObject({ auditPercentage: 75, auditedCharts: 1, totalErrors: 2 });
    expect(res.body.vendors.map((v: { name: string }) => v.name)).toEqual(['In-house', 'Dash Vendor']);
    expect(res.body.vendors[0]).toMatchObject({
      vendorId: null,
      activeCoders: 1,
      chartsToday: 2,
      chartsMonth: 2,
      pagesMonth: 42,
    });
    expect(res.body.vendors[1]).toMatchObject({
      vendorId,
      activeCoders: 1,
      chartsMonth: 0,
      auditPercentage: null,
    });
  });

  it('can be filtered to in-house work or to one vendor', async () => {
    const inHouse = await dash('?vendorId=IN_HOUSE').expect(200);
    expect(inHouse.body.filter).toEqual({ vendorId: null, name: 'In-house' });
    expect(inHouse.body.charts.total).toBe(3);
    expect(inHouse.body.people.projects).toBe(1);
    expect(inHouse.body.vendors).toHaveLength(1);

    const one = await dash(`?vendorId=${vendorId}`).expect(200);
    expect(one.body.filter).toEqual({ vendorId, name: 'Dash Vendor' });
    expect(one.body.charts.total).toBe(2);
    expect(one.body.production.month.charts).toBe(0);
    expect(one.body.vendors.map((v: { name: string }) => v.name)).toEqual(['Dash Vendor']);

    await dash('?vendorId=00000000-0000-7000-8000-000000000000').expect(404);
    await dash('?vendorId=nope').expect(422);
  });

  it('Vendor Admin sees only their own vendor, with a row per coder', async () => {
    await as(app, vendorCoder.session)
      .post(`/production/charts/${ids['V-1']}/submit`, { icds: 4, dos: 1 })
      .expect(200);
    const res = await as(app, vendorAdmin).get('/dashboards/vendor').expect(200);
    expect(res.body.vendor).toEqual({ id: vendorId, name: 'Dash Vendor' });
    expect(res.body.charts.total).toBe(2);
    expect(res.body.production.month).toMatchObject({ charts: 1, pages: 20, icds: 4, dos: 1 });
    expect(res.body.vendors.map((v: { name: string }) => v.name)).toEqual(['Dash Vendor']);
    expect(res.body.coders).toHaveLength(1);
    expect(res.body.coders[0]).toMatchObject({
      fullName: 'D D-VC',
      loginName: 'dvc@vlms.com',
      chartsToday: 1,
      chartsMonth: 1,
      pagesMonth: 20,
      openCharts: 1,
    });
    // No in-house coder or in-house work leaks in.
    expect(JSON.stringify(res.body)).not.toContain('D D-C');
  });

  it('the vendor dashboard is for the Vendor Admin only', async () => {
    expect([403, 404]).toContain((await as(app, manager).get('/dashboards/vendor')).status);
    await as(app, coder.session).get('/dashboards/vendor').expect(403);
    await as(app, vendorAdmin).get('/dashboards/manager').expect(403);
    await anonymous(app).get('/dashboards/vendor').expect(401);
  });

  it('is Manager-only (403 for every other role, 401 without a session)', async () => {
    await dash('', coder.session).expect(403);
    await dash('', auditor.session).expect(403);
    await dash('', vendorAdmin).expect(403);
    await anonymous(app).get('/dashboards/manager').expect(401);
  });
});
