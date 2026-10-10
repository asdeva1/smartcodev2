import type { INestApplication } from '@nestjs/common';
import type { Role } from '@smartcode/shared';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { Fixtures } from './db/fixtures';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Project ↔ Team (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let lead: { id: string; session: Session };
  let coderA: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let coach: { id: string; session: Session };
  let auditor: { id: string; session: Session };
  let team: { id: string };

  const mk = (role: Role, code: string, email: string, name: string) =>
    createActiveEmployee(app, manager, { employeeCode: code, fullName: name, email, role });
  const activeStaff = async (projectId: string) =>
    (
      await db.sql<{ employee_id: string; project_role: string; via_team_id: string | null }>(
        `SELECT employee_id, project_role, via_team_id FROM project_assignments
         WHERE project_id = $1 AND ended_at IS NULL`,
        [projectId],
      )
    ).sort(
      (a, b) => a.project_role.localeCompare(b.project_role) || a.employee_id.localeCompare(b.employee_id),
    );

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    lead = await mk('TEAM_LEAD', 'pt-tl', 'pt-lead@example.test', 'Tina Lead');
    coderA = await mk('CODER', 'pt-ca', 'pt-ca@example.test', 'Coder A');
    coderB = await mk('CODER', 'pt-cb', 'pt-cb@example.test', 'Coder B');
    coach = await mk('GROUP_COACH', 'pt-gc', 'pt-gc@example.test', 'Group Coach');
    auditor = await mk('AUDITOR', 'pt-au', 'pt-au@example.test', 'Audrey');
    team = (await as(app, manager).post('/teams', { name: 'Alpha Team' }).expect(201)).body;
    await as(app, manager).patch(`/teams/${team.id}`, { teamLeadId: lead.id }).expect(200);
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coderA.id }).expect(200);
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coach.id }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  let project: { id: string };

  it('creating a project with a team staffs it from the team and shows the team name', async () => {
    const res = await as(app, manager)
      .post('/projects', {
        clientName: 'Team Client',
        name: 'Team Project',
        allocationType: 'MANUAL',
        teamId: team.id,
      })
      .expect(201);
    project = res.body;
    expect(res.body.team).toEqual({ id: team.id, name: 'Alpha Team' });
    expect(res.body.lead).toMatchObject({ id: lead.id });
    expect(res.body.legacyStaffCount).toBe(0);
    const roles = (await activeStaff(project.id)).map((a) => `${a.project_role}`);
    expect(roles).toEqual(['CODER', 'GROUP_COACH', 'TEAM_LEAD']);
    const list = await as(app, manager).get('/projects').expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === project.id).team.name).toBe('Alpha Team');
  });

  it('team membership changes flow to the project', async () => {
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coderB.id }).expect(200);
    expect((await activeStaff(project.id)).some((a) => a.employee_id === coderB.id)).toBe(true);
    await as(app, manager).delete(`/teams/${team.id}/members/${coderB.id}`).expect(200);
    expect((await activeStaff(project.id)).some((a) => a.employee_id === coderB.id)).toBe(false);
    // The lead change replaces the Project Lead.
    const lead2 = await mk('TEAM_LEAD', 'pt-tl2', 'pt-lead2@example.test', 'Second Lead');
    await as(app, manager).patch(`/teams/${team.id}`, { teamLeadId: lead2.id }).expect(200);
    const staff = await activeStaff(project.id);
    expect(staff.filter((a) => a.project_role === 'TEAM_LEAD').map((a) => a.employee_id)).toEqual([lead2.id]);
  });

  it('a Coder or Group Coach cannot be added or removed by hand while the project has a team; Auditors can', async () => {
    await as(app, manager)
      .post(`/projects/${project.id}/members`, { employeeId: coderB.id, projectRole: 'CODER' })
      .expect(409);
    await as(app, manager).delete(`/projects/${project.id}/members/${coderA.id}`).expect(409);
    await as(app, manager).post(`/projects/${project.id}/lead`, { employeeId: lead.id }).expect(409);
    await as(app, manager)
      .post(`/projects/${project.id}/members`, { employeeId: auditor.id, projectRole: 'AUDITOR' })
      .expect(200);
  });

  it('team and project must share a vendor; clearing the team ends the derived staff only', async () => {
    const vendor = (
      await as(app, manager)
        .post('/vendors', {
          code: 'PT01',
          name: 'Vendor PT',
          admin: { employeeCode: 'PT-VA', fullName: 'PT Admin', email: 'pt-va@example.test' },
          sendActivation: false,
        })
        .expect(201)
    ).body;
    await as(app, manager)
      .post('/projects', {
        clientName: 'Team Client',
        name: 'Mismatch',
        allocationType: 'MANUAL',
        teamId: team.id,
        vendorId: vendor.id,
      })
      .expect(422);
    await as(app, manager).post(`/projects/${project.id}/team`, { teamId: null }).expect(200);
    const staff = await activeStaff(project.id);
    expect(staff.map((a) => a.project_role)).toEqual(['AUDITOR']);
  });

  it('assigning a team to an older project keeps hand-added coders and shows a warning count', async () => {
    const old = (
      await as(app, manager)
        .post('/projects', { clientName: 'Old Client', name: 'Legacy', allocationType: 'MANUAL' })
        .expect(201)
    ).body;
    await as(app, manager)
      .post(`/projects/${old.id}/members`, { employeeId: coderB.id, projectRole: 'CODER' })
      .expect(200);
    const detail = await as(app, manager).get(`/projects/${old.id}`).expect(200);
    expect(detail.body.team).toBeNull();
    expect(detail.body.legacyStaffCount).toBe(1);
    const withTeam = await as(app, manager).post(`/projects/${old.id}/team`, { teamId: team.id }).expect(200);
    expect(withTeam.body.legacyStaffCount).toBe(1);
    const staff = await activeStaff(old.id);
    expect(staff.filter((a) => a.via_team_id === null).map((a) => a.employee_id)).toContain(coderB.id);
    expect(staff.some((a) => a.via_team_id === team.id && a.employee_id === coderA.id)).toBe(true);
  });

  it('a team that works an active project cannot be deactivated; only the Manager manages project teams', async () => {
    await as(app, manager).post(`/teams/${team.id}/deactivate`).expect(409);
    await as(app, lead.session).post(`/projects/${project.id}/team`, { teamId: team.id }).expect(403);
  });

  it('the Manager opens a team dashboard by id; a Manager without an id is asked to choose', async () => {
    await as(app, manager).get('/dashboards/team-lead').expect(422);
    const res = await as(app, manager).get(`/dashboards/team-lead?teamId=${team.id}`).expect(200);
    expect(res.body.teams).toEqual([{ id: team.id, name: 'Alpha Team' }]);
    await as(app, manager)
      .get('/dashboards/team-lead?teamId=00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});
