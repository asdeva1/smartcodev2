import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(300_000);

/**
 * Performance budget at realistic volume (docs/13-testing-strategy.md §7): 30,000 charts across 5 projects with 30 coders,
 * allocations, production entries and audits. The data is bulk-inserted with triggers off (synthetic data only);
 * every endpoint is then called through the real HTTP stack and must answer within its budget.
 * Set PERF_CHARTS to change the volume (default 30000).
 */
const CHARTS = Number(process.env.PERF_CHARTS ?? 30_000);
const PROJECTS = 5;
const CODERS = 30;

describeDb(`Performance at volume (${CHARTS} charts)`, () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coder: Session;
  const projectIds: string[] = [];
  const timings: { name: string; ms: number; budget: number }[] = [];

  beforeAll(async () => {
    db = await createTestDb();
    const fx = new Fixtures(db);
    const orgId = await fx.org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const managerId = (await db.sql<{ id: string }>(`SELECT id FROM employees WHERE role = 'MANAGER'`))[0]!
      .id;
    const auditor = await fx.employee({ role: 'AUDITOR' });
    for (let p = 0; p < PROJECTS; p++) projectIds.push((await fx.project()).id);
    const coderIds: string[] = [];
    const loginIds: string[] = [];
    for (let c = 0; c < CODERS; c++) {
      const e =
        c === 0
          ? await createActiveEmployee(app, manager, {
              employeeCode: 'PERF-C0',
              fullName: 'Perf Coder',
              email: 'perfc0@example.test',
              role: 'CODER',
            })
          : { id: (await fx.employee({ role: 'CODER' })).id, session: undefined };
      if (c === 0) coder = e.session as Session;
      const ln = await fx.loginName();
      await fx.assignLoginName(ln.id, e.id, managerId);
      coderIds.push(e.id);
      loginIds.push(ln.id);
      for (const pid of projectIds) await fx.assignProject(pid, e.id, 'CODER', managerId);
    }
    for (const pid of projectIds) await fx.assignProject(pid, auditor.id, 'AUDITOR', managerId);

    await db.tx(async (q) => {
      await q(`SET LOCAL session_replication_role = replica`);
      await q(
        `CREATE TEMP TABLE seed ON COMMIT DROP AS
         SELECT i, gen_random_uuid() AS id, ($2::uuid[])[(i % $3) + 1] AS project_id, ((i % $4) + 1) AS c,
                CASE WHEN i % 10 < 3 THEN 'PENDING_ALLOCATION' WHEN i % 10 = 3 THEN 'ALLOCATED'
                     WHEN i % 10 = 4 THEN 'IN_PRODUCTION' WHEN i % 10 = 5 THEN 'PENDING_AUDIT' ELSE 'COMPLETED' END AS status
         FROM generate_series(1, $1::int) i`,
        [CHARTS, projectIds, PROJECTS, CODERS],
      );
      await q(
        `INSERT INTO charts (id, organization_id, project_id, chart_ref, status, allocated_at, coded_at, audited_at, completed_at, pages, created_at, updated_at)
         SELECT id, $1, project_id, 'PERF-' || lpad(i::text, 7, '0'), status::chart_status,
                CASE WHEN status <> 'PENDING_ALLOCATION' THEN now() - (i % 20) * interval '1 hour' END,
                CASE WHEN status IN ('PENDING_AUDIT','COMPLETED') THEN now() - (i % 20) * interval '1 hour' END,
                CASE WHEN status = 'COMPLETED' THEN now() - (i % 20) * interval '1 hour' END,
                CASE WHEN status = 'COMPLETED' THEN now() - (i % 20) * interval '1 hour' END,
                10 + (i % 40), now(), now()
         FROM seed`,
        [orgId],
      );
      await q(
        `INSERT INTO chart_allocations (id, chart_id, login_name_id, employee_id, allocated_by_id, source, status, allocated_at, created_at, updated_at)
         SELECT gen_random_uuid(), id, ($1::uuid[])[c], ($2::uuid[])[c], $3, 'CSV', 'ACTIVE', now(), now(), now()
         FROM seed WHERE status <> 'PENDING_ALLOCATION'`,
        [loginIds, coderIds, managerId],
      );
      await q(
        `INSERT INTO production_entries (id, chart_id, version, is_current, status, coder_id, login_name_id, allocation_id, page_count, icds, dos, coded_at, submitted_at, active_seconds, created_at, updated_at)
         SELECT gen_random_uuid(), s.id, 1, true, 'SUBMITTED', a.employee_id, a.login_name_id, a.id, 10 + (s.i % 40), 3 + (s.i % 9), 1 + (s.i % 4),
                now() - (s.i % 20) * interval '1 hour', now() - (s.i % 20) * interval '1 hour', 600 + (s.i % 900), now(), now()
         FROM seed s JOIN chart_allocations a ON a.chart_id = s.id WHERE s.status IN ('PENDING_AUDIT','COMPLETED')`,
      );
      await q(
        `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, sequence, is_re_audit, audited_at, audit_errors, error_exceptions, total_errors, result, status, created_at, updated_at)
         SELECT gen_random_uuid(), s.id, p.id, $1, 1, false, now() - (s.i % 20) * interval '1 hour', s.i % 3, 0, s.i % 3, 'PASS', 'PASSED', now(), now()
         FROM seed s JOIN production_entries p ON p.chart_id = s.id WHERE s.status = 'COMPLETED'`,
        [auditor.id],
      );
    });
    await db.sql(`ANALYZE`);
  });

  afterAll(async () => {
    // eslint-disable-next-line no-console -- the timing table is the purpose of this test
    console.log(
      '\nEndpoint timings (slowest of 3 calls)\n' +
        timings
          .map((t) => `  ${t.name.padEnd(46)} ${String(t.ms).padStart(6)} ms  (budget ${t.budget} ms)`)
          .join('\n'),
    );
    await app?.close();
    await db?.close();
  });

  async function timed(name: string, budget: number, call: () => Promise<{ status: number }>) {
    let worst = 0;
    for (let n = 0; n < 3; n++) {
      const t0 = performance.now();
      const res = await call();
      worst = Math.max(worst, Math.round(performance.now() - t0));
      expect(res.status).toBe(200);
    }
    timings.push({ name, ms: worst, budget });
    expect(worst).toBeLessThan(budget);
  }

  it('has the expected volume', async () => {
    const [row] = await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM charts`);
    expect(Number(row?.n)).toBe(CHARTS);
  });

  it('chart repository, first page', () => timed('GET /charts', 1000, () => as(app, manager).get('/charts')));
  it('chart repository, search by chart id', () =>
    timed('GET /charts?q=PERF-00012', 1000, () => as(app, manager).get('/charts?q=PERF-00012')));
  it('chart repository, filtered by status and project', () =>
    timed('GET /charts?status=COMPLETED&projectId=…', 1000, () =>
      as(app, manager).get(`/charts?status=COMPLETED&projectId=${projectIds[0]}`),
    ));
  it('chart repository, deep page', () =>
    timed('GET /charts?page=100', 1000, () => as(app, manager).get('/charts?page=100')));
  it('project chart list', () =>
    timed('GET /projects/:id/charts', 1000, () => as(app, manager).get(`/projects/${projectIds[0]}/charts`)));
  it('project live board', () =>
    timed('GET /projects/:id/live', 1500, () => as(app, manager).get(`/projects/${projectIds[0]}/live`)));
  it('Manager dashboard', () =>
    timed('GET /dashboards/manager', 2000, () => as(app, manager).get('/dashboards/manager')));
  it('production report', () =>
    timed('GET /projects/:id/reports/production', 2000, () =>
      as(app, manager).get(`/projects/${projectIds[0]}/reports/production`),
    ));
  it('quality report', () =>
    timed('GET /projects/:id/reports/quality', 2000, () =>
      as(app, manager).get(`/projects/${projectIds[0]}/reports/quality`),
    ));
  it('report download (Excel)', () =>
    timed('GET /projects/:id/reports/production/export', 4000, () =>
      as(app, manager).get(`/projects/${projectIds[0]}/reports/production/export?format=xlsx`),
    ));
  it('coder dashboard', () =>
    timed('GET /production/dashboard (coder)', 1000, () => as(app, coder).get('/production/dashboard')));
  it('coder work list', () =>
    timed('GET /allocation/mine (coder)', 1000, () => as(app, coder).get('/allocation/mine')));
  it('activity feed', () => timed('GET /activity', 1000, () => as(app, manager).get('/activity')));
  it('audit log', () => timed('GET /audit-logs', 1000, () => as(app, manager).get('/audit-logs')));
});
