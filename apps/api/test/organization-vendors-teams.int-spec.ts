import type { INestApplication } from '@nestjs/common';
import { ROLES, can, type Role } from '@smartcode/shared';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import {
  anonymous,
  as,
  bootstrapAndSignInManager,
  createActiveEmployee,
  outbox,
  tokenFromEmail,
  STRONG_PASSWORD,
  signIn,
  type Session,
} from './auth-helpers';

jest.setTimeout(120_000);

const NIL = '00000000-0000-7000-8000-000000000000';

describeDb('Phase 4 — Organization, Vendors, Teams and vendor isolation (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let adminA: Session;
  let adminB: Session;
  let vendorA: { id: string; name: string };
  let vendorB: { id: string; name: string };
  const sessions = {} as Partial<Record<Role, Session>>;

  const newVendor = (n: number) => ({
    code: `VND${n}`,
    name: `Vendor ${n}`,
    admin: { employeeCode: `VA-${n}`, fullName: `Vendor Admin ${n}`, email: `va${n}@example.test` },
    sendActivation: true,
  });

  async function createVendor(n: number) {
    const res = await as(app, manager).post('/vendors', newVendor(n)).expect(201);
    await anonymous(app)
      .post('/auth/activation', {
        token: tokenFromEmail(app, `va${n}@example.test`),
        password: STRONG_PASSWORD,
      })
      .expect(204);
    return {
      vendor: res.body as { id: string; name: string },
      admin: await signIn(app, `va${n}@example.test`, STRONG_PASSWORD),
    };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    sessions.MANAGER = manager;
    const a = await createVendor(1);
    const b = await createVendor(2);
    vendorA = a.vendor;
    vendorB = b.vendor;
    adminA = a.admin;
    adminB = b.admin;
    sessions.VENDOR_ADMIN = adminA;
    const people: [Role, string, string?][] = [
      ['HR', 'p4-hr'],
      ['GROUP_COACH', 'p4-gc'],
      ['TEAM_LEAD', 'p4-tl', vendorA.id],
      ['AUDITOR', 'p4-au', vendorA.id],
      ['CODER', 'p4-co', vendorA.id],
    ];
    for (const [role, code, vendorId] of people) {
      const made = await createActiveEmployee(app, manager, {
        employeeCode: code,
        fullName: `P4 ${role}`,
        email: `${code}@example.test`,
        role,
        ...(vendorId ? { vendorId } : {}),
      });
      sessions[role] = made.session;
    }
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  beforeEach(() => outbox(app).clear());

  describe('Organization settings', () => {
    it('Manager reads and updates; time zone and labels are validated', async () => {
      const got = await as(app, manager).get('/organization').expect(200);
      expect(got.body.slug).toBeDefined();
      expect(got.body.counts.vendors).toBe(2);

      await as(app, manager).patch('/organization', { timeZone: 'Mars/Olympus' }).expect(422);
      await as(app, manager)
        .patch('/organization', { terminology: { UNKNOWN: 'x' } })
        .expect(422);
      await as(app, manager).patch('/organization', {}).expect(422);

      const updated = await as(app, manager)
        .patch('/organization', {
          name: 'SmartClues Test',
          timeZone: 'Asia/Kolkata',
          terminology: { SPC: 'SPC' },
        })
        .expect(200);
      expect(updated.body.name).toBe('SmartClues Test');
      expect(updated.body.terminology).toEqual({ SPC: 'SPC' });

      const audit = await db.sql(`SELECT action FROM audit_logs WHERE action = 'ORGANIZATION.UPDATED'`);
      expect(audit.length).toBeGreaterThan(0);
    });

    it.each(ROLES.filter((r) => !can(r, 'settings.manage')))('%s is refused (403)', async (role) => {
      const session = sessions[role];
      if (!session) return;
      await as(app, session).get('/organization').expect(403);
      await as(app, session).patch('/organization', { name: 'Nope Nope' }).expect(403);
    });
  });

  describe('Vendors', () => {
    it('creates a vendor with its Vendor Admin, who gets an activation email and is Pending until activated', async () => {
      const spec = newVendor(3);
      const res = await as(app, manager).post('/vendors', spec).expect(201);
      expect(res.body.admins).toHaveLength(1);
      expect(res.body.admins[0].status).toBe('PENDING_ACTIVATION');
      expect(res.body.admins[0].email).toBe(spec.admin.email);
      expect(outbox(app).lastTo(spec.admin.email)).toBeDefined();
      expect(JSON.stringify(res.body)).not.toMatch(/password|token|hash/i);
    });

    it('rejects a duplicate code or name, and a duplicate admin email without leaving a half-created vendor', async () => {
      await as(app, manager)
        .post('/vendors', { ...newVendor(10), code: 'VND1' })
        .expect(409);
      await as(app, manager)
        .post('/vendors', { ...newVendor(11), name: 'vendor 1' })
        .expect(409);
      const before = (await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM vendors`))[0]!.n;
      await as(app, manager)
        .post('/vendors', { ...newVendor(12), admin: { ...newVendor(12).admin, email: 'va1@example.test' } })
        .expect(409);
      const after = (await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM vendors`))[0]!.n;
      expect(after).toBe(before);
    });

    it('validates input before touching the database', async () => {
      await as(app, manager).post('/vendors', { code: '', name: '', admin: {} }).expect(422);
    });

    it('Manager sees every vendor; a Vendor Admin sees only their own and gets 404 for another', async () => {
      const all = await as(app, manager).get('/vendors').expect(200);
      expect(all.body.total).toBeGreaterThanOrEqual(3);
      const own = await as(app, adminA).get('/vendors').expect(200);
      expect(own.body.items.map((v: { id: string }) => v.id)).toEqual([vendorA.id]);
      await as(app, adminA).get(`/vendors/${vendorA.id}`).expect(200);
      await as(app, adminA).get(`/vendors/${vendorB.id}`).expect(404);
      await as(app, adminB).get(`/vendors/${vendorA.id}`).expect(404);
    });

    it('only a Manager may create, rename or deactivate vendors', async () => {
      await as(app, adminA).post('/vendors', newVendor(20)).expect(403);
      await as(app, adminA).patch(`/vendors/${vendorA.id}`, { name: 'Renamed By Admin' }).expect(403);
      await as(app, adminA).post(`/vendors/${vendorA.id}/deactivate`).expect(403);
      for (const role of ['HR', 'GROUP_COACH', 'TEAM_LEAD', 'AUDITOR', 'CODER'] as const) {
        const session = sessions[role];
        if (!session) continue;
        await as(app, session).get('/vendors').expect(403);
        await as(app, session).post('/vendors', newVendor(21)).expect(403);
      }
    });

    it('renames, refuses to deactivate a vendor with active staff, and records the audit trail', async () => {
      await as(app, manager).patch(`/vendors/${vendorB.id}`, { name: 'Vendor Two Renamed' }).expect(200);
      await as(app, manager).patch(`/vendors/${vendorB.id}`, { name: 'Vendor 1' }).expect(409);
      await as(app, manager).post(`/vendors/${vendorB.id}/deactivate`).expect(409);
      const actions = (
        await db.sql<{ action: string }>(`SELECT action FROM audit_logs WHERE entity_type = 'Vendor'`)
      ).map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(['VENDOR.CREATED', 'VENDOR.UPDATED']));
      vendorB.name = 'Vendor Two Renamed';
    });

    it('a vendor with no active staff can be deactivated and reactivated', async () => {
      const lone = await as(app, manager)
        .post('/vendors', { ...newVendor(30), sendActivation: false })
        .expect(201);
      await db.sql(`UPDATE employees SET status = 'INACTIVE', deactivated_at = now() WHERE vendor_id = $1`, [
        lone.body.id,
      ]);
      const off = await as(app, manager).post(`/vendors/${lone.body.id}/deactivate`).expect(200);
      expect(off.body.status).toBe('INACTIVE');
      const on = await as(app, manager).post(`/vendors/${lone.body.id}/reactivate`).expect(200);
      expect(on.body.status).toBe('ACTIVE');
    });
  });

  describe('Teams and vendor isolation', () => {
    let inHouse: { id: string };
    let teamA: { id: string };
    let teamB: { id: string };
    let leadA: { id: string; session: Session };
    let coderA: { id: string; session: Session };
    let coderB: { id: string; session: Session };

    beforeAll(async () => {
      inHouse = (await as(app, manager).post('/teams', { name: 'In-house Alpha' }).expect(201)).body;
      teamA = (await as(app, adminA).post('/teams', { name: 'Team A1' }).expect(201)).body;
      teamB = (await as(app, adminB).post('/teams', { name: 'Team B1' }).expect(201)).body;
      leadA = await createActiveEmployee(app, adminA, {
        employeeCode: 'TA-LEAD',
        fullName: 'Lead A',
        email: 'lead-a@example.test',
        role: 'TEAM_LEAD',
      });
      coderA = await createActiveEmployee(app, adminA, {
        employeeCode: 'TA-CODER',
        fullName: 'Coder A',
        email: 'coder-a@example.test',
        role: 'CODER',
      });
      coderB = await createActiveEmployee(app, adminB, {
        employeeCode: 'TB-CODER',
        fullName: 'Coder B',
        email: 'coder-b@example.test',
        role: 'CODER',
      });
    });

    it('a team belongs to the creator’s vendor, whatever the request says', async () => {
      const own = await as(app, adminA)
        .post('/teams', { name: 'Team A-forced', vendorId: vendorA.id })
        .expect(201);
      expect(own.body.vendor.id).toBe(vendorA.id);
      await as(app, adminA).post('/teams', { name: 'Team Sneaky', vendorId: vendorB.id }).expect(404);
      expect(teamA.id).toBeDefined();
      const tree = await as(app, manager).get(`/teams/${inHouse.id}`).expect(200);
      expect(tree.body.vendor).toBeNull();
    });

    it('team names are unique per vendor (case-insensitive) but can repeat across vendors', async () => {
      await as(app, adminA).post('/teams', { name: 'team a1' }).expect(409);
      await as(app, adminB).post('/teams', { name: 'Team A1' }).expect(201);
    });

    it('a Vendor Admin cannot see, change or join another vendor’s teams or people', async () => {
      await as(app, adminA).get(`/teams/${teamB.id}`).expect(404);
      await as(app, adminA).patch(`/teams/${teamB.id}`, { name: 'Hijacked' }).expect(404);
      await as(app, adminA).post(`/teams/${teamB.id}/members`, { employeeId: coderA.id }).expect(404);
      await as(app, adminA).get(`/teams/${inHouse.id}`).expect(404);
      await as(app, adminA).post(`/teams/${teamA.id}/members`, { employeeId: coderB.id }).expect(422);
      const list = await as(app, adminA).get('/teams').expect(200);
      const ids = list.body.items.map((t: { id: string }) => t.id);
      expect(ids).toContain(teamA.id);
      expect(ids).not.toContain(teamB.id);
      expect(ids).not.toContain(inHouse.id);
    });

    it('adds members, moves them between teams, sets a Team Lead and removes members', async () => {
      const second = (await as(app, adminA).post('/teams', { name: 'Team A2' }).expect(201)).body;
      await as(app, adminA).post(`/teams/${teamA.id}/members`, { employeeId: coderA.id }).expect(200);
      const lead = await as(app, adminA).patch(`/teams/${teamA.id}`, { teamLeadId: leadA.id }).expect(200);
      expect(lead.body.teamLead.id).toBe(leadA.id);

      const moved = await as(app, adminA)
        .post(`/teams/${second.id}/members`, { employeeId: coderA.id })
        .expect(200);
      expect(moved.body.members.map((m: { id: string }) => m.id)).toContain(coderA.id);
      const first = await as(app, adminA).get(`/teams/${teamA.id}`).expect(200);
      expect(first.body.members.map((m: { id: string }) => m.id)).not.toContain(coderA.id);

      await as(app, adminA).delete(`/teams/${second.id}/members/${coderA.id}`).expect(200);
      await as(app, adminA).delete(`/teams/${second.id}/members/${coderA.id}`).expect(404);
      const current = await db.sql(
        `SELECT 1 FROM team_memberships WHERE employee_id = $1 AND ended_at IS NULL`,
        [coderA.id],
      );
      expect(current).toHaveLength(0);
    });

    it('the database rule keeps non-leads out of the Team Lead slot', async () => {
      const res = await as(app, adminA).patch(`/teams/${teamA.id}`, { teamLeadId: coderA.id });
      expect(res.status).toBe(422);
    });

    it('an in-house team only accepts in-house employees', async () => {
      await as(app, manager).post(`/teams/${inHouse.id}/members`, { employeeId: coderA.id }).expect(422);
    });

    it('a team with members cannot be deactivated until they are removed', async () => {
      await as(app, adminA).post(`/teams/${teamA.id}/members`, { employeeId: coderA.id }).expect(200);
      await as(app, adminA).post(`/teams/${teamA.id}/deactivate`).expect(409);
      await as(app, adminA).delete(`/teams/${teamA.id}/members/${coderA.id}`).expect(200);
      const off = await as(app, adminA).post(`/teams/${teamA.id}/deactivate`).expect(200);
      expect(off.body.status).toBe('INACTIVE');
      await as(app, adminA).post(`/teams/${teamA.id}/reactivate`).expect(200);
    });

    it('Team Leads and Coders read only their own team and cannot manage', async () => {
      await as(app, manager).post(`/teams/${teamA.id}/members`, { employeeId: coderA.id }).expect(200);
      await as(app, adminA).patch(`/teams/${teamA.id}`, { teamLeadId: leadA.id }).expect(200);
      const tl = await as(app, leadA.session).get('/teams').expect(200);
      expect(tl.body.items.map((t: { id: string }) => t.id)).toEqual([teamA.id]);
      const coder = await as(app, coderA.session).get('/teams').expect(200);
      expect(coder.body.items.map((t: { id: string }) => t.id)).toEqual([teamA.id]);
      await as(app, leadA.session).get(`/teams/${teamB.id}`).expect(404);
      await as(app, leadA.session).post('/teams', { name: 'TL Team' }).expect(403);
      await as(app, coderA.session).post(`/teams/${teamA.id}/members`, { employeeId: coderA.id }).expect(403);
      await as(app, coderA.session).patch(`/teams/${teamA.id}`, { name: 'Coder Team' }).expect(403);
    });

    it('HR and Group Coach hold no team-management rights', async () => {
      for (const role of ['HR', 'GROUP_COACH'] as const) {
        const session = sessions[role]!;
        await as(app, session)
          .post('/teams', { name: `${role} Team` })
          .expect(403);
        await as(app, session).patch(`/teams/${NIL}`, { name: 'Nope Nope' }).expect(403);
      }
    });

    it('writes audit entries for team changes', async () => {
      const actions = (
        await db.sql<{ action: string }>(`SELECT DISTINCT action FROM audit_logs WHERE entity_type = 'Team'`)
      ).map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'TEAM.CREATED',
          'TEAM.UPDATED',
          'TEAM.MEMBER_ADDED',
          'TEAM.MEMBER_REMOVED',
          'TEAM.DEACTIVATED',
        ]),
      );
    });

    it('malformed ids are 404, not 500', async () => {
      await as(app, manager).get('/teams/not-a-uuid').expect(404);
      await as(app, manager).get('/vendors/not-a-uuid').expect(404);
    });
  });
});

describeDb('Chart Allocation (Manager): assign Login Name by email, CSV template and Chart ID search', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  const sessions = {} as Partial<Record<Role, Session>>;
  let coder: { id: string; session: Session };

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    coder = await createActiveEmployee(app, manager, {
      employeeCode: 'CA-CODER',
      fullName: 'Naveen P',
      email: 'naveen@smartcluestech.com',
      role: 'CODER',
    });
    for (const [role, code] of [
      ['HR', 'ca-hr'],
      ['GROUP_COACH', 'ca-gc'],
    ] as const) {
      sessions[role] = (
        await createActiveEmployee(app, manager, {
          employeeCode: code,
          fullName: `CA ${role}`,
          email: `${code}@example.test`,
          role,
        })
      ).session;
    }
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('assigns a Login Name that looks like an email, typing only the employee email', async () => {
    await as(app, manager)
      .post('/login-names/assignments', {
        loginName: 'naveen@vlms.com',
        email: 'Naveen@SmartClues Tech.com'.replace(' ', ''),
      })
      .expect(200);
    const list = await as(app, manager).get('/login-names?q=naveen').expect(200);
    expect(list.body.items[0]).toMatchObject({
      value: 'naveen@vlms.com',
      holder: { email: 'naveen@smartcluestech.com', fullName: 'Naveen P' },
    });
  });

  it('refuses an unknown email, a missing email and a request with both id and email', async () => {
    await as(app, manager)
      .post('/login-names/assignments', { loginName: 'x@vlms.com', email: 'nobody@example.test' })
      .expect(404);
    await as(app, manager).post('/login-names/assignments', { loginName: 'x@vlms.com' }).expect(422);
    await as(app, manager)
      .post('/login-names/assignments', {
        loginName: 'x@vlms.com',
        email: 'a@example.test',
        employeeId: coder.id,
      })
      .expect(422);
  });

  it('imports the Login Name, Email template and rejects the old column layout', async () => {
    await createActiveEmployee(app, manager, {
      employeeCode: 'CA-CODER2',
      fullName: 'Ravi K',
      email: 'ravi@smartcluestech.com',
      role: 'CODER',
    });
    const csv = 'Login Name,Email\nravi@vlms.com,ravi@smartcluestech.com\n';
    const preview = await as(app, manager).post('/login-names/import/preview', { csv }).expect(200);
    expect(preview.body).toMatchObject({ valid: 1, invalid: 0 });
    expect(preview.body.rows[0].values).toEqual({
      'Login Name': 'ravi@vlms.com',
      Email: 'ravi@smartcluestech.com',
    });
    const commit = await as(app, manager)
      .post('/login-names/import/commit', { csv, mode: 'valid-only' })
      .expect(200);
    expect(commit.body).toMatchObject({ committed: true, created: 1 });
    const old = await as(app, manager)
      .post('/login-names/import/preview', {
        csv: 'Employee Email,Login Name\nravi@smartcluestech.com,r@vlms.com\n',
      })
      .expect(200);
    expect(old.body.fileErrors.length).toBeGreaterThan(0);
  });

  it('only the Manager can assign or import', async () => {
    for (const role of ['HR', 'GROUP_COACH'] as const) {
      const s = sessions[role]!;
      await as(app, s)
        .post('/login-names/assignments', { loginName: 'h@vlms.com', email: 'x@example.test' })
        .expect(403);
      await as(app, s)
        .post('/login-names/import/commit', { csv: 'Login Name,Email\n', mode: 'valid-only' })
        .expect(403);
    }
  });

  it('Chart ID search shows Login Name, assigned employee, who allocated and when — and is Manager-only', async () => {
    const fx = new Fixtures(db);
    fx.organizationId = (await db.sql<{ id: string }>(`SELECT id FROM organizations LIMIT 1`))[0]!.id;
    const project = await fx.project();
    const mgr = (await db.sql<{ id: string }>(`SELECT id FROM employees WHERE role = 'MANAGER'`))[0]!.id;
    const ln = await db.sql<{ id: string }>(`SELECT id FROM login_names WHERE value = 'naveen@vlms.com'`);
    const chart = await fx.chart(project.id, 'CH-LOOKUP-1');
    await fx.chart(project.id, 'CH-LOOKUP-2');
    await fx.assignProject(project.id, coder.id, 'CODER', mgr);
    await db.prisma.chartAllocation.create({
      data: {
        chartId: chart.id,
        loginNameId: ln[0]!.id,
        employeeId: coder.id,
        allocatedById: mgr,
        source: 'MANUAL',
      },
    });

    const hit = await as(app, manager).get('/allocation/charts?q=ch-lookup-1').expect(200);
    expect(hit.body).toHaveLength(1);
    expect(hit.body[0]).toMatchObject({
      chartId: 'CH-LOOKUP-1',
      allocation: {
        loginName: 'naveen@vlms.com',
        assignedTo: { fullName: 'Naveen P', email: 'naveen@smartcluestech.com' },
        allocatedBy: { fullName: 'Test Manager' },
      },
    });
    expect(hit.body[0].allocation.allocatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const both = await as(app, manager).get('/allocation/charts?q=CH-LOOKUP').expect(200);
    expect(both.body).toHaveLength(2);
    expect(both.body.find((c: { chartId: string }) => c.chartId === 'CH-LOOKUP-2').allocation).toBeNull();

    await as(app, manager).get('/allocation/charts?q=NOPE-0').expect(200);
    await as(app, manager).get('/allocation/charts').expect(422);
    for (const role of ['HR', 'GROUP_COACH'] as const)
      await as(app, sessions[role]!).get('/allocation/charts?q=CH').expect(403);
    await anonymous(app).get('/allocation/charts?q=CH').expect(401);
  });
});
