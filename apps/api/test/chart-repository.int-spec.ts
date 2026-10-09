import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { anonymous, as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Chart repository across projects (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coderA: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let projectA: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (code: string, email: string, role: string) =>
      createActiveEmployee(app, manager, { employeeCode: code, fullName: `R ${code}`, email, role });
    coderA = await mk('CR-A', 'cra@example.test', 'CODER');
    coderB = await mk('CR-B', 'crb@example.test', 'CODER');
    auditor = await mk('CR-AU', 'crau@example.test', 'AUDITOR');
    const mkProject = async (name: string) =>
      (
        await as(app, manager)
          .post('/projects', { clientName: 'Acme', name, allocationType: 'MANUAL' })
          .expect(201)
      ).body.id as string;
    projectA = await mkProject('Repo A');
    const projectB = await mkProject('Repo B');
    const H = 'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks';
    await as(app, manager)
      .post(`/projects/${projectA}/allocation/commit`, {
        csv: [H, 'cra@vlms.com,cra@example.test,A-1,10,,', 'cra@vlms.com,cra@example.test,A-2,20,,'].join(
          '\n',
        ),
        mode: 'all-or-nothing',
      })
      .expect(200);
    await as(app, manager)
      .post(`/projects/${projectB}/allocation/commit`, {
        csv: [H, 'crb@vlms.com,crb@example.test,B-1,5,,'].join('\n'),
        mode: 'all-or-nothing',
      })
      .expect(200);
    await as(app, manager)
      .post(`/projects/${projectA}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
    for (const p of [projectA, projectB]) {
      const list = await as(app, manager).get(`/projects/${p}/charts`).expect(200);
      for (const c of list.body.items) ids[c.chartId] = c.id;
    }
    await as(app, coderA.session)
      .post(`/production/charts/${ids['A-1']}/submit`, { icds: 2, dos: 1 })
      .expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('Manager sees charts of every project, with status counts and filters', async () => {
    const all = await as(app, manager).get('/charts').expect(200);
    expect(all.body.total).toBe(3);
    expect(all.body.statusCounts).toEqual({ ALLOCATED: 2, PENDING_AUDIT: 1 });
    const a1 = all.body.items.find((c: { chartId: string }) => c.chartId === 'A-1');
    expect(a1).toMatchObject({ status: 'PENDING_AUDIT', project: { name: 'Repo A', client: 'Acme' } });

    const byProject = await as(app, manager).get(`/charts?projectId=${projectA}`).expect(200);
    expect(byProject.body.total).toBe(2);
    const byStatus = await as(app, manager).get('/charts?status=ALLOCATED').expect(200);
    expect(byStatus.body.items.map((c: { chartId: string }) => c.chartId).sort()).toEqual(['A-2', 'B-1']);
    // Status counts ignore the status filter, so the chips stay complete.
    expect(byStatus.body.statusCounts).toEqual({ ALLOCATED: 2, PENDING_AUDIT: 1 });
    const search = await as(app, manager).get('/charts?q=b-').expect(200);
    expect(search.body.items.map((c: { chartId: string }) => c.chartId)).toEqual(['B-1']);
    const withCoder = byStatus.body.items.find((c: { chartId: string }) => c.chartId === 'B-1');
    expect(withCoder.coder).toMatchObject({ fullName: 'R CR-B', loginName: 'crb@vlms.com' });
    await as(app, manager).get('/charts?projectId=nope').expect(422);
  });

  it('a Coder sees only their own charts; a staffed Auditor only their projects', async () => {
    const mineB = await as(app, coderB.session).get('/charts').expect(200);
    expect(mineB.body.items.map((c: { chartId: string }) => c.chartId)).toEqual(['B-1']);
    const mineA = await as(app, coderA.session).get('/charts').expect(200);
    // Submitted charts stay in the coder's list (with their new status) until the chart is completed.
    expect(mineA.body.items.map((c: { chartId: string }) => c.chartId).sort()).toEqual(['A-1', 'A-2']);
    const aud = await as(app, auditor.session).get('/charts').expect(200);
    expect(aud.body.items.map((c: { chartId: string }) => c.chartId).sort()).toEqual(['A-1', 'A-2']);
  });

  it('timeline shows every status change and is scoped like the list', async () => {
    const t = await as(app, manager).get(`/charts/${ids['A-1']}/timeline`).expect(200);
    expect(t.body.chart).toMatchObject({ chartId: 'A-1', status: 'PENDING_AUDIT' });
    const statuses = t.body.events.map((e: { toStatus: string }) => e.toStatus);
    expect(statuses).toEqual(expect.arrayContaining(['ALLOCATED', 'IN_PRODUCTION', 'PENDING_AUDIT']));
    expect(
      t.body.events.find((e: { toStatus: string }) => e.toStatus === 'PENDING_AUDIT').actor,
    ).toMatchObject({
      fullName: 'R CR-A',
    });
    // The coder who did the work can read it; another coder and a stranger cannot.
    await as(app, coderA.session).get(`/charts/${ids['A-1']}/timeline`).expect(200);
    await as(app, coderB.session).get(`/charts/${ids['A-1']}/timeline`).expect(404);
    await as(app, manager).get('/charts/00000000-0000-7000-8000-000000000000/timeline').expect(404);
    await anonymous(app).get('/charts').expect(401);
  });
});
