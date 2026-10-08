import type { INestApplication } from '@nestjs/common';
import { ROLES, can, type Role } from '@smartcode/shared';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

const HEADER = 'Login Name,Email ID,Chart ID,Pages,Page Bucket,Remarks';

describeDb(
  'Phase 5 — Projects, allocation file, Coder allotment, pull-back and reports (HTTP + PostgreSQL)',
  () => {
    let db: TestDb;
    let app: INestApplication;
    let manager: Session;
    let lead: { id: string; session: Session };
    let coderA: { id: string; session: Session };
    let coderB: { id: string; session: Session };
    let auditor: { id: string; session: Session };
    let manual: { id: string };
    let auto: { id: string };
    const sessions = {} as Partial<Record<Role, Session>>;

    const mk = (role: Role, code: string, email: string, name = `P5 ${code}`) =>
      createActiveEmployee(app, manager, { employeeCode: code, fullName: name, email, role });

    const preview = (id: string, csv: string, session = manager) =>
      as(app, session).post(`/projects/${id}/allocation/preview`, { csv });
    const commit = (id: string, csv: string, mode: 'valid-only' | 'all-or-nothing' = 'valid-only') =>
      as(app, manager).post(`/projects/${id}/allocation/commit`, { csv, mode });

    beforeAll(async () => {
      db = await createTestDb();
      await new Fixtures(db).org();
      app = await createDbApp(db);
      ({ session: manager } = await bootstrapAndSignInManager(app));
      sessions.MANAGER = manager;
      lead = await mk('TEAM_LEAD', 'p5-tl', 'lead@example.test', 'Tina Lead');
      coderA = await mk('CODER', 'p5-ca', 'coder.a@example.test', 'Coder A');
      coderB = await mk('CODER', 'p5-cb', 'coder.b@example.test', 'Coder B');
      auditor = await mk('AUDITOR', 'p5-au', 'auditor@example.test', 'Audrey Auditor');
      sessions.TEAM_LEAD = lead.session;
      sessions.CODER = coderA.session;
      sessions.AUDITOR = auditor.session;
      sessions.HR = (await mk('HR', 'p5-hr', 'hr5@example.test')).session;
      sessions.GROUP_COACH = (await mk('GROUP_COACH', 'p5-gc', 'gc5@example.test')).session;
    });

    afterAll(async () => {
      await app?.close();
      await db?.close();
    });

    describe('create and list', () => {
      it('Manager creates a Manual project with a new client and a Project Lead; the client is reused next time', async () => {
        const res = await as(app, manager)
          .post('/projects', {
            clientName: 'Acme Health',
            name: 'Cardiology Q4',
            allocationType: 'MANUAL',
            leadId: lead.id,
          })
          .expect(201);
        manual = res.body;
        expect(res.body).toMatchObject({
          name: 'Cardiology Q4',
          client: { name: 'Acme Health' },
          allocationType: 'MANUAL',
          status: 'ACTIVE',
          lead: { id: lead.id, fullName: 'Tina Lead' },
          memberCount: 0,
        });

        const second = await as(app, manager)
          .post('/projects', { clientName: 'acme health', name: 'Auto Intake', allocationType: 'AUTOMATIC' })
          .expect(201);
        auto = second.body;
        expect(second.body.client.id).toBe(res.body.client.id);
        expect(second.body.lead).toBeNull();
        const clients = await db.sql(`SELECT id FROM clients`);
        expect(clients).toHaveLength(1);
      });

      it('refuses a duplicate project name for the same client, and a lead who is not a Team Lead', async () => {
        await as(app, manager)
          .post('/projects', { clientName: 'ACME HEALTH', name: 'cardiology q4', allocationType: 'MANUAL' })
          .expect(409);
        await as(app, manager)
          .post('/projects', {
            clientName: 'Acme Health',
            name: 'Bad Lead',
            allocationType: 'MANUAL',
            leadId: coderA.id,
          })
          .expect(422);
        await as(app, manager)
          .post('/projects', { clientName: 'Acme Health', name: 'X', allocationType: 'SEMI' })
          .expect(422);
      });

      it('lists with filters and the audit trail records the creation', async () => {
        const all = await as(app, manager).get('/projects').expect(200);
        expect(all.body.total).toBe(2);
        const onlyAuto = await as(app, manager).get('/projects?allocationType=AUTOMATIC').expect(200);
        expect(onlyAuto.body.items.map((p: { name: string }) => p.name)).toEqual(['Auto Intake']);
        const search = await as(app, manager).get('/projects?q=acme').expect(200);
        expect(search.body.total).toBe(2);
        const clients = await as(app, manager).get('/projects/clients').expect(200);
        expect(clients.body.map((c: { name: string }) => c.name)).toEqual(['Acme Health']);
        const logs = await db.sql<{ action: string }>(
          `SELECT action FROM audit_logs WHERE action IN ('CLIENT.CREATED','PROJECT.CREATED') ORDER BY action`,
        );
        expect(logs.map((l) => l.action)).toEqual(['CLIENT.CREATED', 'PROJECT.CREATED', 'PROJECT.CREATED']);
      });

      it.each(ROLES.filter((r) => !can(r, 'project.manage')))(
        '%s cannot create projects (403)',
        async (role) => {
          const session = sessions[role];
          if (!session) return;
          await as(app, session)
            .post('/projects', { clientName: 'Nope', name: 'Nope', allocationType: 'MANUAL' })
            .expect(403);
        },
      );

      it('a Team Lead sees only the projects they lead; an unstaffed Coder sees none (404 on direct access)', async () => {
        const mine = await as(app, lead.session).get('/projects').expect(200);
        expect(mine.body.items.map((p: { id: string }) => p.id)).toEqual([manual.id]);
        await as(app, lead.session).get(`/projects/${auto.id}`).expect(404);
        const none = await as(app, coderA.session).get('/projects').expect(200);
        expect(none.body.total).toBe(0);
        await as(app, coderA.session).get(`/projects/${manual.id}`).expect(404);
      });

      it('updates the name and status; a Team Lead cannot', async () => {
        await as(app, lead.session).patch(`/projects/${manual.id}`, { name: 'Hack' }).expect(403);
        await as(app, manager).patch(`/projects/${manual.id}`, {}).expect(422);
        const res = await as(app, manager)
          .patch(`/projects/${manual.id}`, { name: 'Cardiology Q4 (2026)' })
          .expect(200);
        expect(res.body.name).toBe('Cardiology Q4 (2026)');
      });
    });

    describe('Automatic projects have no chart allocation', () => {
      it('refuses the allocation file with a clear error', async () => {
        const res = await preview(auto.id, `${HEADER}\nLN-1,coder.a@example.test,C-1,1,,`).expect(422);
        expect(res.body.code).toBe('AUTOMATIC_PROJECT');
        await commit(auto.id, `${HEADER}\nLN-1,coder.a@example.test,C-1,1,,`).expect(422);
      });
    });

    describe('Manual allocation file', () => {
      it('rejects a wrong header and unknown columns', async () => {
        const missing = await preview(manual.id, 'Login Name,Chart ID\nLN-1,C-1').expect(200);
        expect(missing.body.fileErrors.join(' ')).toMatch(/Email ID/);
        const unknown = await preview(manual.id, `${HEADER},Extra\nLN-1,a@example.test,C-1,1,,,x`).expect(
          200,
        );
        expect(unknown.body.fileErrors.join(' ')).toMatch(/Unknown column "Extra"/);
      });

      const FILE = [
        HEADER,
        'ca@vlms.com,coder.a@example.test,CH-1001,12,1-10,First chart',
        'ca@vlms.com,coder.a@example.test,CH-1002,30,26-50,',
        'cb@vlms.com,coder.b@example.test,CH-1003,8,1-10,',
        'nb@vlms.com,nobody@example.test,CH-1004,5,,',
        'x@vlms.com,lead@example.test,CH-1005,5,,',
        'cb@vlms.com,coder.b@example.test,CH-1003,9,,',
        'cb@vlms.com,coder.b@example.test,CH-1006,abc,,',
      ].join('\n');

      it('previews every row with its own reason and warns that Login Names will be assigned', async () => {
        const res = await preview(manual.id, FILE).expect(200);
        expect(res.body).toMatchObject({ total: 7, valid: 2, invalid: 5 });
        const byLine = Object.fromEntries(res.body.rows.map((r: { line: number }) => [r.line, r]));
        expect(byLine[2].status).toBe('VALID');
        expect(byLine[2].warnings.join(' ')).toMatch(/Assigns Login Name "ca@vlms.com"/);
        expect(byLine[5].errors.join(' ')).toMatch(/No employee has this Email ID/);
        expect(byLine[6].errors.join(' ')).toMatch(/not a Coder/);
        expect(byLine[4].errors.join(' ')).toMatch(/repeated/);
        expect(byLine[7].errors.join(' ')).toMatch(/repeated/);
        expect(byLine[8].errors.join(' ')).toMatch(/Pages/);
        // Nothing was written by a preview.
        expect(await db.sql(`SELECT 1 FROM charts`)).toHaveLength(0);
      });

      it('all-or-nothing writes nothing when any row is invalid', async () => {
        const res = await commit(manual.id, FILE, 'all-or-nothing').expect(200);
        expect(res.body.committed).toBe(false);
        expect(await db.sql(`SELECT 1 FROM charts`)).toHaveLength(0);
      });

      it('valid-only creates charts, assigns Login Names, staffs the coders and allocates (source CSV)', async () => {
        const res = await commit(manual.id, FILE).expect(200);
        expect(res.body).toMatchObject({ committed: true, created: 2, skipped: 5 });

        const charts = await db.sql<{
          chart_ref: string;
          status: string;
          pages: number | null;
          page_bucket: string | null;
          remarks: string | null;
          login: string;
          email: string;
          source: string;
        }>(
          `SELECT c.chart_ref, c.status, c.pages, c.page_bucket, c.remarks, ln.value AS login, e.email, a.source
           FROM charts c
           JOIN chart_allocations a ON a.chart_id = c.id AND a.status = 'ACTIVE'
           JOIN login_names ln ON ln.id = a.login_name_id
           JOIN employees e ON e.id = a.employee_id
          WHERE c.project_id = $1 ORDER BY c.chart_ref`,
          [manual.id],
        );
        expect(charts).toEqual([
          {
            chart_ref: 'CH-1001',
            status: 'ALLOCATED',
            pages: 12,
            page_bucket: '1-10',
            remarks: 'First chart',
            login: 'ca@vlms.com',
            email: 'coder.a@example.test',
            source: 'CSV',
          },
          {
            chart_ref: 'CH-1002',
            status: 'ALLOCATED',
            pages: 30,
            page_bucket: '26-50',
            remarks: null,
            login: 'ca@vlms.com',
            email: 'coder.a@example.test',
            source: 'CSV',
          },
        ]);

        const detail = await as(app, manager).get(`/projects/${manual.id}`).expect(200);
        expect(detail.body.memberCount).toBe(1);
        expect(detail.body.members[0]).toMatchObject({
          fullName: 'Coder A',
          projectRole: 'CODER',
          loginName: 'ca@vlms.com',
          openCharts: 2,
        });
        expect(detail.body.chartsByStatus).toEqual({ ALLOCATED: 2 });
        const logs = await db.sql<{ action: string }>(
          `SELECT action FROM audit_logs WHERE action IN ('CHART.ALLOCATED','PROJECT.CHARTS_IMPORTED','LOGIN_NAME.ASSIGNED','PROJECT.STAFF_ASSIGNED')`,
        );
        expect(logs.filter((l) => l.action === 'CHART.ALLOCATED')).toHaveLength(2);
        expect(logs.map((l) => l.action)).toEqual(
          expect.arrayContaining([
            'PROJECT.CHARTS_IMPORTED',
            'LOGIN_NAME.ASSIGNED',
            'PROJECT.STAFF_ASSIGNED',
          ]),
        );
      });

      it('Chart ID search (Chart Allocation) shows the new allotment', async () => {
        const res = await as(app, manager).get('/allocation/charts?q=CH-1001').expect(200);
        expect(res.body[0]).toMatchObject({
          chartId: 'CH-1001',
          allocation: { loginName: 'ca@vlms.com', assignedTo: { email: 'coder.a@example.test' } },
        });
      });

      it('a chart that is already allocated cannot be loaded again until it is pulled back', async () => {
        const res = await preview(
          manual.id,
          `${HEADER}
ca@vlms.com,coder.a@example.test,CH-1001,1,,`,
        ).expect(200);
        expect(res.body.rows[0].errors.join(' ')).toMatch(
          /already allocated to Coder A — pull it back first/,
        );
      });

      it('a coder cannot be given a second Login Name by the file while holding charts', async () => {
        const res = await preview(
          manual.id,
          `${HEADER}
other@vlms.com,coder.a@example.test,CH-2001,1,,`,
        ).expect(200);
        expect(res.body.rows[0].errors.join(' ')).toMatch(/already works under Login Name "ca@vlms.com"/);
      });

      it('only a Manager can upload an allocation file (403 for every other role)', async () => {
        for (const role of ROLES.filter((r) => !can(r, 'chart.allocate'))) {
          const session = sessions[role];
          if (!session) continue;
          await as(app, session)
            .post(`/projects/${manual.id}/allocation/preview`, { csv: HEADER })
            .expect(403);
          await as(app, session)
            .post(`/projects/${manual.id}/allocation/commit`, { csv: HEADER, mode: 'valid-only' })
            .expect(403);
        }
      });

      it('a second batch gives another coder their charts in the same file as an existing coder (all-or-nothing)', async () => {
        const file = [
          HEADER,
          'cb@vlms.com,coder.b@example.test,CH-1003,8,1-10,',
          'ca@vlms.com,coder.a@example.test,CH-1004,4,,urgent',
        ].join('\n');
        const res = await commit(manual.id, file, 'all-or-nothing').expect(200);
        expect(res.body).toMatchObject({ committed: true, created: 2, skipped: 0 });
        const detail = await as(app, manager).get(`/projects/${manual.id}`).expect(200);
        expect(detail.body.memberCount).toBe(2);
        expect(detail.body.chartsByStatus).toEqual({ ALLOCATED: 4 });
      });
    });

    describe('Coder portal: My allotment', () => {
      it('shows only the signed-in coder’s charts with pages, bucket and remarks', async () => {
        const a = await as(app, coderA.session).get('/allocation/mine').expect(200);
        expect(a.body.loginName).toBe('ca@vlms.com');
        expect(a.body.total).toBe(3);
        expect(a.body.charts.map((c: { chartId: string }) => c.chartId).sort()).toEqual([
          'CH-1001',
          'CH-1002',
          'CH-1004',
        ]);
        expect(a.body.charts.find((c: { chartId: string }) => c.chartId === 'CH-1004')).toMatchObject({
          pages: 4,
          remarks: 'urgent',
          status: 'ALLOCATED',
          project: { name: 'Cardiology Q4 (2026)', client: 'Acme Health' },
        });
        const b = await as(app, coderB.session).get('/allocation/mine').expect(200);
        expect(b.body.charts.map((c: { chartId: string }) => c.chartId)).toEqual(['CH-1003']);
      });

      it('the coder can open the project’s chart list but only sees their own charts', async () => {
        const res = await as(app, coderB.session).get(`/projects/${manual.id}/charts`).expect(200);
        expect(res.body.items.map((c: { chartId: string }) => c.chartId)).toEqual(['CH-1003']);
      });

      it('a Manager has no personal allotment', async () => {
        const res = await as(app, manager).get('/allocation/mine').expect(200);
        expect(res.body).toEqual({ loginName: null, total: 0, charts: [] });
      });
    });

    describe('Manager pull-back', () => {
      it('pulls a chart back from its coder; the coder’s allotment and the repository both update', async () => {
        const list = await as(app, manager).get(`/projects/${manual.id}/charts?q=CH-1002`).expect(200);
        const chartId = list.body.items[0].id as string;
        const res = await as(app, manager)
          .post(`/projects/${manual.id}/charts/pull-back`, { chartIds: [chartId], reason: 'Wrong coder' })
          .expect(200);
        expect(res.body).toEqual({ pulledBack: 1, skipped: 0 });
        const mine = await as(app, coderA.session).get('/allocation/mine').expect(200);
        expect(mine.body.charts.map((c: { chartId: string }) => c.chartId).sort()).toEqual([
          'CH-1001',
          'CH-1004',
        ]);
        const [row] = await db.sql<{ status: string; ended: number }>(
          `SELECT c.status, (SELECT count(*)::int FROM chart_allocations a WHERE a.chart_id = c.id AND a.status = 'ENDED' AND a.end_reason = 'DEALLOCATED') AS ended
           FROM charts c WHERE c.id = $1`,
          [chartId],
        );
        expect(row).toEqual({ status: 'PENDING_ALLOCATION', ended: 1 });
        // Pulling the same chart again is a harmless skip.
        const again = await as(app, manager)
          .post(`/projects/${manual.id}/charts/pull-back`, { chartIds: [chartId] })
          .expect(200);
        expect(again.body).toEqual({ pulledBack: 0, skipped: 1 });
      });

      it('a pulled-back chart can be loaded again in a file and goes to another coder', async () => {
        const res = await commit(
          manual.id,
          `${HEADER}\ncb@vlms.com,coder.b@example.test,CH-1002,30,26-50,moved`,
        ).expect(200);
        expect(res.body).toMatchObject({ committed: true, created: 1 });
        const [row] = await db.sql<{ email: string }>(
          `SELECT e.email FROM chart_allocations a JOIN charts c ON c.id = a.chart_id JOIN employees e ON e.id = a.employee_id
          WHERE c.chart_ref = 'CH-1002' AND a.status = 'ACTIVE'`,
        );
        expect(row?.email).toBe('coder.b@example.test');
        const history = await db.sql(
          `SELECT 1 FROM chart_allocations a JOIN charts c ON c.id = a.chart_id WHERE c.chart_ref = 'CH-1002'`,
        );
        expect(history).toHaveLength(2);
      });

      it('a member who still holds charts cannot be removed; one without charts can', async () => {
        await as(app, manager).delete(`/projects/${manual.id}/members/${coderA.id}`).expect(409);
        const extra = await mk('CODER', 'p5-cc', 'coder.c@example.test', 'Coder C');
        await as(app, manager)
          .post(`/projects/${manual.id}/members`, { employeeId: extra.id, projectRole: 'CODER' })
          .expect(200);
        await as(app, manager)
          .post(`/projects/${manual.id}/members`, { employeeId: extra.id, projectRole: 'AUDITOR' })
          .expect(422);
        const removed = await as(app, manager)
          .delete(`/projects/${manual.id}/members/${extra.id}`)
          .expect(200);
        expect(removed.body.members.map((m: { employeeId: string }) => m.employeeId)).not.toContain(extra.id);
      });
    });

    describe('Reports, live tracking and submit to client', () => {
      let doneChartId: string;

      beforeAll(async () => {
        // Coder B finishes CH-1003 today (production → audit pass → completed). Synthetic lifecycle only.
        const [chart] = await db.sql<{ id: string }>(`SELECT id FROM charts WHERE chart_ref = 'CH-1003'`);
        doneChartId = (chart as { id: string }).id;
        const [alloc] = await db.sql<{ id: string; login_name_id: string }>(
          `SELECT id, login_name_id FROM chart_allocations WHERE chart_id = $1 AND status = 'ACTIVE'`,
          [doneChartId],
        );
        const { id: allocationId, login_name_id: loginNameId } = alloc as {
          id: string;
          login_name_id: string;
        };
        await db.sql(`UPDATE charts SET status = 'IN_PRODUCTION' WHERE id = $1`, [doneChartId]);
        const [entry] = await db.sql<{ id: string }>(
          `INSERT INTO production_entries (id, chart_id, coder_id, login_name_id, allocation_id, page_count, icds, dos, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 8, 5, 2, now()) RETURNING id`,
          [doneChartId, coderB.id, loginNameId, allocationId],
        );
        await db.sql(
          `UPDATE production_entries SET status = 'SUBMITTED', submitted_at = now(), coded_at = now() WHERE id = $1`,
          [(entry as { id: string }).id],
        );
        await db.sql(`UPDATE charts SET status = 'CODED' WHERE id = $1`, [doneChartId]);
        await db.sql(`UPDATE charts SET status = 'PENDING_AUDIT' WHERE id = $1`, [doneChartId]);
        await db.sql(
          `INSERT INTO audits (id, chart_id, production_entry_id, auditor_id, audit_errors, error_exceptions, status, result, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 2, 1, 'PASSED', 'PASS', now())`,
          [doneChartId, (entry as { id: string }).id, auditor.id],
        );
        await db.sql(`UPDATE charts SET status = 'AUDITED' WHERE id = $1`, [doneChartId]);
        await db.sql(`UPDATE charts SET status = 'COMPLETED' WHERE id = $1`, [doneChartId]);
      });

      it('live tracking counts today’s finished charts per coder and per day', async () => {
        const res = await as(app, manager).get(`/projects/${manual.id}/live`).expect(200);
        expect(res.body.doneToday).toBe(1);
        expect(res.body.days).toHaveLength(14);
        expect(res.body.days.at(-1)).toEqual({ date: res.body.today, chartsDone: 1 });
        const b = res.body.coders.find(
          (c: { coder: { fullName: string } }) => c.coder.fullName === 'Coder B',
        );
        expect(b).toMatchObject({ doneToday: 1, allocated: 1 });
        expect(res.body.allocated).toBe(3);
      });

      it('production report: today, month and a custom range; invalid ranges are refused', async () => {
        for (const range of ['today', 'month']) {
          const res = await as(app, manager)
            .get(`/projects/${manual.id}/reports/production?range=${range}`)
            .expect(200);
          expect(res.body.totals).toEqual({ charts: 1, pages: 8, icds: 5, dos: 2 });
          expect(res.body.rows[0].coder).toMatchObject({ fullName: 'Coder B', loginName: 'cb@vlms.com' });
        }
        const empty = await as(app, manager)
          .get(`/projects/${manual.id}/reports/production?range=custom&from=2020-01-01&to=2020-01-31`)
          .expect(200);
        expect(empty.body.totals.charts).toBe(0);
        await as(app, manager)
          .get(`/projects/${manual.id}/reports/production?range=custom&from=2020-02-01&to=2020-01-31`)
          .expect(422);
        await as(app, manager).get(`/projects/${manual.id}/reports/production?range=custom`).expect(422);
      });

      it('quality report totals the audit results and errors', async () => {
        const res = await as(app, manager)
          .get(`/projects/${manual.id}/reports/quality?range=today`)
          .expect(200);
        expect(res.body.totals).toMatchObject({
          audited: 1,
          passed: 1,
          auditErrors: 2,
          errorExceptions: 1,
          totalErrors: 3,
        });
        expect(res.body.rows[0].coder.fullName).toBe('Coder B');
      });

      it('Team Lead of the project may read reports; a coder sees only their own numbers', async () => {
        await as(app, lead.session).get(`/projects/${manual.id}/reports/production`).expect(200);
        const own = await as(app, coderA.session)
          .get(`/projects/${manual.id}/reports/production`)
          .expect(200);
        expect(own.body.totals.charts).toBe(0);
      });

      it('submits finished charts to the client; others are skipped and it is not repeated', async () => {
        const all = await as(app, manager).get(`/projects/${manual.id}/charts`).expect(200);
        const ids = all.body.items.map((c: { id: string }) => c.id);
        const res = await as(app, manager)
          .post(`/projects/${manual.id}/charts/submit-to-client`, { chartIds: ids })
          .expect(200);
        expect(res.body).toEqual({ submitted: 1, skipped: ids.length - 1 });
        const again = await as(app, manager)
          .post(`/projects/${manual.id}/charts/submit-to-client`, {})
          .expect(200);
        expect(again.body.submitted).toBe(0);
        const detail = await as(app, manager).get(`/projects/${manual.id}`).expect(200);
        expect(detail.body.submittedToClient).toBe(1);
        await expect(
          db.sql(`UPDATE charts SET submitted_to_client_at = now() WHERE chart_ref = 'CH-1001'`),
        ).rejects.toThrow(/charts_submitted_to_client_chk/);
      });
    });

    describe('Client pull-back', () => {
      it('ends every open allocation: every coder’s allotment drops to zero; finished work is untouched', async () => {
        await as(app, manager).post(`/projects/${manual.id}/client-pullback`, { reason: '' }).expect(422);
        const res = await as(app, manager)
          .post(`/projects/${manual.id}/client-pullback`, { reason: 'Client recalled the batch' })
          .expect(200);
        expect(res.body.pulledBack).toBe(3);
        for (const coder of [coderA, coderB]) {
          const mine = await as(app, coder.session).get('/allocation/mine').expect(200);
          expect(mine.body).toMatchObject({ total: 0, charts: [] });
        }
        const detail = await as(app, manager).get(`/projects/${manual.id}`).expect(200);
        expect(detail.body.chartsByStatus).toEqual({ PENDING_ALLOCATION: 3, COMPLETED: 1 });
        expect(detail.body.clientPullbackAt).not.toBeNull();
        expect(detail.body.members.every((m: { openCharts: number }) => m.openCharts === 0)).toBe(true);
        const logs = await db.sql(`SELECT 1 FROM audit_logs WHERE action = 'PROJECT.CLIENT_PULLBACK'`);
        expect(logs).toHaveLength(1);
      });

      it('a Team Lead or Coder cannot trigger a pull-back (403)', async () => {
        await as(app, lead.session)
          .post(`/projects/${manual.id}/client-pullback`, { reason: 'because' })
          .expect(403);
        await as(app, coderA.session)
          .post(`/projects/${manual.id}/charts/pull-back`, { chartIds: [] })
          .expect(403);
      });
    });
  },
);
