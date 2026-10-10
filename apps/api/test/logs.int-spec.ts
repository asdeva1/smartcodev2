import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { anonymous, as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Audit log and Activity log (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coder: { id: string; session: Session };
  let coder2: { id: string; session: Session };
  let lead: { id: string; session: Session };
  let vendorAdmin: Session;

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (code: string, email: string, role: string, extra: object = {}) =>
      createActiveEmployee(app, manager, {
        employeeCode: code,
        fullName: `L ${code}`,
        email,
        role,
        ...extra,
      });
    coder = await mk('LG-C', 'lgc@example.test', 'CODER');
    coder2 = await mk('LG-C2', 'lgc2@example.test', 'CODER');
    lead = await mk('LG-TL', 'lgtl@example.test', 'TEAM_LEAD');
    const vendor = await as(app, manager)
      .post('/vendors', {
        code: 'LGV',
        name: 'Log Vendor',
        admin: { employeeCode: 'LG-VA', fullName: 'Log Vendor Admin', email: 'lgva@example.test' },
        sendActivation: true,
      })
      .expect(201);
    vendorAdmin = (await mk('LG-VA2', 'lgva2@example.test', 'VENDOR_ADMIN', { vendorId: vendor.body.id }))
      .session;
    const team = (await as(app, manager).post('/teams', { name: 'Log Team' }).expect(201)).body;
    await as(app, manager).patch(`/teams/${team.id}`, { teamLeadId: lead.id }).expect(200);
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coder.id }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('Manager reads the audit log with filters; nobody else can', async () => {
    const all = await as(app, manager).get('/audit-logs').expect(200);
    expect(all.body.total).toBeGreaterThan(0);
    const created = await as(app, manager).get('/audit-logs?action=employee.created').expect(200);
    expect(created.body.items.length).toBeGreaterThan(0);
    for (const r of created.body.items) expect(r.action.startsWith('EMPLOYEE.CREATED')).toBe(true);
    expect(created.body.items[0].actor).toMatchObject({ role: 'MANAGER' });
    const today = new Date().toISOString().slice(0, 10);
    const dated = await as(app, manager).get(`/audit-logs?from=${today}&to=${today}&pageSize=5`).expect(200);
    expect(dated.body.items.length).toBeLessThanOrEqual(5);
    const none = await as(app, manager).get('/audit-logs?from=2000-01-01&to=2000-01-02').expect(200);
    expect(none.body.total).toBe(0);
    await as(app, manager).get('/audit-logs?from=yesterday').expect(422);

    for (const s of [coder.session, lead.session, vendorAdmin])
      await as(app, s).get('/audit-logs').expect(403);
    await anonymous(app).get('/audit-logs').expect(401);
  });

  it('Activity log: Manager sees everyone, others only their own scope', async () => {
    const mgr = await as(app, manager).get('/activity').expect(200);
    expect(mgr.body.total).toBeGreaterThan(0);
    const teamAction = mgr.body.items.map((i: { action: string }) => i.action);
    expect(teamAction.length).toBeGreaterThan(0);

    // Coders have no activity of their own yet; they see nothing, and never the Manager's.
    const own = await as(app, coder.session).get('/activity').expect(200);
    expect(own.body.items.every((i: { actor: { id: string } | null }) => i.actor?.id === coder.id)).toBe(
      true,
    );
    const other = await as(app, coder2.session).get('/activity').expect(200);
    expect(other.body.items.every((i: { actor: { id: string } | null }) => i.actor?.id === coder2.id)).toBe(
      true,
    );

    // A Team Lead sees themselves and their team, never the Manager or a coder outside the team.
    const tl = await as(app, lead.session).get('/activity').expect(200);
    const allowed = new Set([lead.id, coder.id]);
    expect(
      tl.body.items.every((i: { actor: { id: string } | null }) => !!i.actor && allowed.has(i.actor.id)),
    ).toBe(true);

    // A Vendor Admin sees only their own vendor's people.
    const va = await as(app, vendorAdmin).get('/activity').expect(200);
    expect(
      va.body.items.every(
        (i: { actor: { fullName: string } | null }) =>
          i.actor === null || i.actor.fullName.startsWith('L LG-VA'),
      ),
    ).toBe(true);
    await anonymous(app).get('/activity').expect(401);
  });
});
