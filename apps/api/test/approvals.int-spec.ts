import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { anonymous, as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Approval engine (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let lead: { id: string; session: Session };
  let otherLead: { id: string; session: Session };
  let coder: { id: string; session: Session };
  let coder2: { id: string; session: Session };
  let projectId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    const mk = (code: string, email: string, role: string) =>
      createActiveEmployee(app, manager, { employeeCode: code, fullName: `A ${code}`, email, role });
    lead = await mk('AP-TL', 'aptl@example.test', 'TEAM_LEAD');
    otherLead = await mk('AP-TL2', 'aptl2@example.test', 'TEAM_LEAD');
    coder = await mk('AP-C', 'apc@example.test', 'CODER');
    coder2 = await mk('AP-C2', 'apc2@example.test', 'CODER');
    const team = (await as(app, manager).post('/teams', { name: 'Approval Team' }).expect(201)).body;
    await as(app, manager).patch(`/teams/${team.id}`, { teamLeadId: lead.id }).expect(200);
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coder.id }).expect(200);
    projectId = (
      await as(app, manager)
        .post('/projects', {
          clientName: 'Acme',
          name: 'Closable',
          allocationType: 'MANUAL',
          leadId: lead.id,
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const ask = (who: Session, body: object) => as(app, who).post('/approvals', body);

  it('a Team Lead asks to deactivate a coder; the Manager approves and the coder is deactivated', async () => {
    const created = await ask(lead.session, {
      type: 'EMPLOYEE_DEACTIVATION',
      entityId: coder.id,
      reason: 'Left the company',
    }).expect(201);
    expect(created.body).toMatchObject({
      status: 'PENDING',
      subject: 'A AP-C',
      request: { reason: 'Left the company' },
    });

    // The Manager is told; a second identical request is refused while this one is open.
    const bell = await as(app, manager).get('/notifications').expect(200);
    expect(bell.body.items.some((n: { type: string }) => n.type === 'APPROVAL_REQUESTED')).toBe(true);
    await ask(lead.session, { type: 'EMPLOYEE_DEACTIVATION', entityId: coder.id, reason: 'again' }).expect(
      409,
    );

    // The requester sees it; another Team Lead does not.
    const mine = await as(app, lead.session).get('/approvals').expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect((await as(app, otherLead.session).get('/approvals').expect(200)).body.items).toHaveLength(0);
    // Only a Manager may decide.
    await as(app, lead.session)
      .post(`/approvals/${created.body.id}/decision`, { decision: 'APPROVED' })
      .expect(403);

    const decided = await as(app, manager)
      .post(`/approvals/${created.body.id}/decision`, { decision: 'APPROVED', comments: 'Confirmed with HR' })
      .expect(200);
    expect(decided.body).toMatchObject({ status: 'APPROVED', resolvedBy: { fullName: expect.any(String) } });
    const [row] = await db.sql<{ status: string }>(
      `SELECT status FROM employees WHERE email = 'apc@example.test'`,
    );
    expect(row?.status).toBe('INACTIVE');
    const told = await as(app, lead.session).get('/notifications').expect(200);
    expect(told.body.items.some((n: { type: string }) => n.type === 'APPROVAL_DECIDED')).toBe(true);
    // Final: it cannot be decided or cancelled again.
    await as(app, manager)
      .post(`/approvals/${created.body.id}/decision`, { decision: 'REJECTED', comments: 'not needed' })
      .expect(409);
    await as(app, lead.session).post(`/approvals/${created.body.id}/cancel`).expect(409);
    const logs = await db.sql(
      `SELECT 1 FROM audit_logs WHERE action IN ('APPROVAL.REQUESTED','APPROVAL.APPROVED')`,
    );
    expect(logs).toHaveLength(2);
  });

  it('a rejection needs a reason and changes nothing', async () => {
    // coder2 is outside the Team Lead's team, so the Team Lead cannot even see them.
    await ask(lead.session, {
      type: 'EMPLOYEE_DEACTIVATION',
      entityId: coder2.id,
      reason: 'Not my team',
    }).expect(404);
    const created = await ask(lead.session, {
      type: 'PROJECT_CLOSURE',
      entityId: projectId,
      comments: 'Client finished',
    }).expect(201);
    await as(app, manager)
      .post(`/approvals/${created.body.id}/decision`, { decision: 'REJECTED' })
      .expect(422);
    const rejected = await as(app, manager)
      .post(`/approvals/${created.body.id}/decision`, { decision: 'REJECTED', comments: 'Charts still open' })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', decisionComments: 'Charts still open' });
    const [p] = await db.sql<{ status: string }>(`SELECT status FROM projects WHERE id = $1`, [projectId]);
    expect(p?.status).toBe('ACTIVE');
  });

  it('approving a project closure closes the project; the requester can cancel only their own open request', async () => {
    const created = await ask(lead.session, { type: 'PROJECT_CLOSURE', entityId: projectId }).expect(201);
    await as(app, otherLead.session).post(`/approvals/${created.body.id}/cancel`).expect(404);
    const cancelled = await as(app, lead.session).post(`/approvals/${created.body.id}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const again = await ask(lead.session, { type: 'PROJECT_CLOSURE', entityId: projectId }).expect(201);
    await as(app, manager).post(`/approvals/${again.body.id}/decision`, { decision: 'APPROVED' }).expect(200);
    const [p] = await db.sql<{ status: string }>(`SELECT status FROM projects WHERE id = $1`, [projectId]);
    expect(p?.status).toBe('CLOSED');
    await ask(lead.session, { type: 'PROJECT_CLOSURE', entityId: projectId }).expect(409);
  });

  it('a login-name change is carried out on approval; bad requests and wrong roles are refused', async () => {
    const created = await ask(lead.session, {
      type: 'LOGIN_NAME_CHANGE',
      entityId: coder.id,
      loginName: 'newlogin@vlms.com',
    }).expect(201);
    expect(created.body.request.loginName).toBe('newlogin@vlms.com');
    // coder is already deactivated by the first test, so approving is refused and the request stays open.
    const refused = await as(app, manager).post(`/approvals/${created.body.id}/decision`, {
      decision: 'APPROVED',
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const still = await as(app, manager).get('/approvals?status=PENDING').expect(200);
    expect(still.body.items.map((i: { id: string }) => i.id)).toContain(created.body.id);

    await ask(lead.session, { type: 'LOGIN_NAME_CHANGE', entityId: coder.id }).expect(422);
    await ask(manager, { type: 'PROJECT_CLOSURE', entityId: projectId }).expect(403);
    await ask(coder2.session, { type: 'EMPLOYEE_DEACTIVATION', entityId: coder.id, reason: 'x y z' }).expect(
      403,
    );
    await ask(lead.session, { type: 'EMPLOYEE_DEACTIVATION', entityId: lead.id, reason: 'self' }).expect(422);
    await anonymous(app).get('/approvals').expect(401);
  });

  it('reopening a project, reactivating a person and changing a role are carried out on approval', async () => {
    // The project was closed by an earlier test; only a closed project can be reopened.
    const reopen = await ask(lead.session, { type: 'PROJECT_REOPEN', entityId: projectId }).expect(201);
    await as(app, manager)
      .post(`/approvals/${reopen.body.id}/decision`, { decision: 'APPROVED' })
      .expect(200);
    const [p] = await db.sql<{ status: string }>(`SELECT status FROM projects WHERE id = $1`, [projectId]);
    expect(p?.status).toBe('ACTIVE');
    await ask(lead.session, { type: 'PROJECT_REOPEN', entityId: projectId }).expect(409);

    // HR sees everyone in the organisation. The first test deactivated `coder`; asking to reactivate an active person is refused.
    const hr = await createActiveEmployee(app, manager, {
      employeeCode: 'AP-HR',
      fullName: 'A HR',
      email: 'aphr@example.test',
      role: 'HR',
    });
    await ask(hr.session, { type: 'EMPLOYEE_REACTIVATION', entityId: coder2.id }).expect(409);
    const react = await ask(hr.session, { type: 'EMPLOYEE_REACTIVATION', entityId: coder.id }).expect(201);
    await as(app, manager).post(`/approvals/${react.body.id}/decision`, { decision: 'APPROVED' }).expect(200);
    const [e] = await db.sql<{ status: string }>(`SELECT status FROM employees WHERE id = $1`, [coder.id]);
    expect(e?.status).toBe('PENDING_ACTIVATION');

    // Role change needs a role and a reason, and the same role is refused.
    await ask(hr.session, { type: 'ROLE_CHANGE', entityId: coder2.id, reason: 'moving to audit' }).expect(
      422,
    );
    await ask(hr.session, {
      type: 'ROLE_CHANGE',
      entityId: coder2.id,
      role: 'CODER',
      reason: 'same',
    }).expect(422);
    const change = await ask(hr.session, {
      type: 'ROLE_CHANGE',
      entityId: coder2.id,
      role: 'AUDITOR',
      reason: 'moving to audit',
    }).expect(201);
    expect(change.body.request.role).toBe('AUDITOR');
    await as(app, manager)
      .post(`/approvals/${change.body.id}/decision`, { decision: 'APPROVED' })
      .expect(200);
    const [r] = await db.sql<{ role: string }>(`SELECT role FROM employees WHERE id = $1`, [coder2.id]);
    expect(r?.role).toBe('AUDITOR');
  });
});
