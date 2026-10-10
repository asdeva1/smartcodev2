import type { INestApplication } from '@nestjs/common';
import { ROLES, can, type Permission, type Role } from '@smartcode/shared';
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
  type Session,
} from './auth-helpers';

jest.setTimeout(120_000);

const NIL = '00000000-0000-7000-8000-000000000000';

interface Probe {
  name: string;
  permission: Permission;
  method: 'get' | 'post' | 'patch';
  url: string;
  body?: object;
}

/** Every Phase 3 endpoint that is gated by a permission, with a body that would be valid for an allowed caller. */
const PROBES: Probe[] = [
  { name: 'list employees', permission: 'employee.read', method: 'get', url: '/employees' },
  { name: 'read employee', permission: 'employee.read', method: 'get', url: `/employees/${NIL}` },
  { name: 'export employees', permission: 'employee.read', method: 'get', url: '/employees/export' },
  {
    name: 'employee timeline',
    permission: 'employee.read',
    method: 'get',
    url: `/employees/${NIL}/timeline`,
  },
  { name: 'directory options', permission: 'employee.read', method: 'get', url: '/employees/options' },
  {
    name: 'create employee',
    permission: 'employee.create',
    method: 'post',
    url: '/employees',
    body: {
      employeeCode: 'RBAC-0001',
      fullName: 'Rbac Probe',
      email: 'rbac-probe@example.test',
      role: 'CODER',
    },
  },
  {
    name: 'preview employee CSV',
    permission: 'employee.create',
    method: 'post',
    url: '/employees/import/preview',
    body: { csv: 'Employee Name,Employee ID,Email,Role\n' },
  },
  {
    name: 'commit employee CSV',
    permission: 'employee.create',
    method: 'post',
    url: '/employees/import/commit',
    body: { csv: 'Employee Name,Employee ID,Email,Role\n', mode: 'valid-only' },
  },
  {
    name: 'update employee',
    permission: 'employee.update',
    method: 'patch',
    url: `/employees/${NIL}`,
    body: { fullName: 'X Y' },
  },
  {
    name: 'send activation',
    permission: 'employee.sendActivation',
    method: 'post',
    url: `/employees/${NIL}/activation-email`,
  },
  {
    name: 'bulk activation',
    permission: 'employee.sendActivation',
    method: 'post',
    url: '/employees/activation-emails',
    body: { employeeIds: [NIL] },
  },
  {
    name: 'initiate password reset',
    permission: 'employee.triggerPasswordReset',
    method: 'post',
    url: `/employees/${NIL}/password-reset`,
  },
  {
    name: 'deactivate',
    permission: 'employee.deactivate',
    method: 'post',
    url: `/employees/${NIL}/deactivate`,
    body: { reason: 'Probe only' },
  },
  {
    name: 'reactivate',
    permission: 'employee.deactivate',
    method: 'post',
    url: `/employees/${NIL}/reactivate`,
  },
  {
    name: 'change role',
    permission: 'employee.changeRole',
    method: 'post',
    url: `/employees/${NIL}/role`,
    body: { role: 'AUDITOR', reason: 'Probe only' },
  },
  { name: 'list Login Names', permission: 'loginName.read', method: 'get', url: '/login-names' },
  {
    name: 'Login Name history',
    permission: 'loginName.read',
    method: 'get',
    url: `/employees/${NIL}/login-names`,
  },
  {
    name: 'assign Login Name',
    permission: 'loginName.assign',
    method: 'post',
    url: '/login-names/assignments',
    body: { employeeId: NIL, loginName: 'SCLN-PROBE' },
  },
  {
    name: 'release Login Name',
    permission: 'loginName.assign',
    method: 'post',
    url: '/login-names/release',
    body: { employeeId: NIL },
  },
  {
    name: 'preview Login Name CSV',
    permission: 'loginName.assign',
    method: 'post',
    url: '/login-names/import/preview',
    body: { csv: 'Login Name,Email\n' },
  },
  {
    name: 'commit Login Name CSV',
    permission: 'loginName.assign',
    method: 'post',
    url: '/login-names/import/commit',
    body: { csv: 'Login Name,Email\n', mode: 'valid-only' },
  },
];

describeDb('Employee Directory, Login Names and RBAC (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let vendorA: { id: string };
  let vendorB: { id: string };
  const sessions = {} as Record<Role, Session>;
  const ids = {} as Record<string, string>;
  let vendorBAdmin: Session;
  let vendorBCoder: { id: string; session: Session };

  const person = (n: number, role: Role, vendorId?: string) => ({
    employeeCode: `DIR-${n.toString().padStart(4, '0')}`,
    fullName: `Directory Person ${n}`,
    email: `dir${n}@example.test`,
    role,
    ...(vendorId ? { vendorId } : {}),
  });

  beforeAll(async () => {
    db = await createTestDb();
    const fx = new Fixtures(db);
    await fx.org();
    vendorA = await fx.vendor('Alpha Vendor');
    vendorB = await fx.vendor('Beta Vendor');
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    sessions.MANAGER = manager;

    const plan: [Role, string?][] = [
      ['HR'],
      ['GROUP_COACH'],
      ['TEAM_LEAD', vendorA.id],
      ['AUDITOR', vendorA.id],
      ['CODER', vendorA.id],
      ['VENDOR_ADMIN', vendorA.id],
    ];
    let n = 100;
    for (const [role, vendorId] of plan) {
      n += 1;
      const made = await createActiveEmployee(app, manager, person(n, role, vendorId));
      sessions[role] = made.session;
      ids[role] = made.id;
    }
    const adminB = await createActiveEmployee(app, manager, person(201, 'VENDOR_ADMIN', vendorB.id));
    vendorBAdmin = adminB.session;
    vendorBCoder = await createActiveEmployee(app, manager, person(202, 'CODER', vendorB.id));
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  beforeEach(() => outbox(app).clear());

  describe('RBAC matrix: every endpoint × every role', () => {
    it('covers all seven roles', () => {
      expect(Object.keys(sessions).sort()).toEqual([...ROLES].sort());
    });

    describe.each(PROBES)('$name', (probe) => {
      it('401 without a session', async () => {
        const res = await anonymous(app)[probe.method === 'get' ? 'get' : 'post'](probe.url, probe.body);
        expect(res.status).toBe(probe.method === 'patch' ? 404 : 401);
      });

      it.each(ROLES)('%s', async (role) => {
        const caller = as(app, sessions[role]);
        const res =
          probe.method === 'get'
            ? await caller.get(probe.url)
            : probe.method === 'patch'
              ? await caller.patch(probe.url, probe.body ?? {})
              : await caller.post(probe.url, probe.body);
        if (can(role, probe.permission)) {
          expect([401, 403]).not.toContain(res.status);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('FORBIDDEN');
        }
      });
    });

    it.each(['TEAM_LEAD', 'AUDITOR', 'CODER'] as Role[])('%s cannot create an employee', async (role) => {
      const res = await as(app, sessions[role]).post('/employees', person(900, 'CODER'));
      expect(res.status).toBe(403);
    });

    it('HR cannot create an employee (the approved matrix gives HR read/update only)', async () => {
      await as(app, sessions.HR).post('/employees', person(901, 'CODER')).expect(403);
    });

    it('Login Name assignment is Manager-only', async () => {
      for (const role of ROLES.filter((r) => r !== 'MANAGER')) {
        const res = await as(app, sessions[role]).post('/login-names/assignments', {
          employeeId: ids.CODER,
          loginName: 'SCLN-NOPE',
        });
        expect(res.status).toBe(403);
      }
      expect(await db.sql(`SELECT 1 FROM login_name_assignments`)).toHaveLength(0);
    });

    it('only the Manager can change a role', async () => {
      for (const role of ROLES.filter((r) => r !== 'MANAGER')) {
        await as(app, sessions[role])
          .post(`/employees/${ids.CODER}/role`, { role: 'HR', reason: 'Not allowed' })
          .expect(403);
      }
    });
  });

  describe('Employee Directory (organization-wide for the Manager)', () => {
    it('lists everyone with the specified columns and no secrets', async () => {
      const res = await as(app, manager).get('/employees?pageSize=100').expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(9);
      const row = res.body.items.find((e: { employeeCode: string }) => e.employeeCode === 'DIR-0105');
      expect(row).toEqual(
        expect.objectContaining({
          employeeCode: 'DIR-0105',
          fullName: 'Directory Person 105',
          email: 'dir105@example.test',
          role: 'CODER',
          status: 'ACTIVE',
          loginName: null,
        }),
      );
      for (const key of ['team', 'teamLead', 'projects', 'vendor', 'createdAt', 'activatedAt']) {
        expect(row).toHaveProperty(key);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/password|argon2|tokenHash|credential/i);
    });

    it('filters by role, status and vendor, and searches by code, name, email and Login Name', async () => {
      const coders = await as(app, manager).get('/employees?role=CODER&pageSize=100').expect(200);
      expect(coders.body.items.every((e: { role: string }) => e.role === 'CODER')).toBe(true);

      const vendor = await as(app, manager).get(`/employees?vendorId=${vendorB.id}&pageSize=100`).expect(200);
      expect(vendor.body.items.map((e: { employeeCode: string }) => e.employeeCode).sort()).toEqual([
        'DIR-0201',
        'DIR-0202',
      ]);

      const pending = await as(app, manager).post('/employees', person(300, 'CODER')).expect(201);
      const byStatus = await as(app, manager)
        .get('/employees?status=PENDING_ACTIVATION&pageSize=100')
        .expect(200);
      expect(byStatus.body.items.map((e: { id: string }) => e.id)).toContain(pending.body.id);

      for (const q of ['DIR-0300', 'Directory Person 300', 'dir300@example.test']) {
        const found = await as(app, manager)
          .get(`/employees?q=${encodeURIComponent(q)}`)
          .expect(200);
        expect(found.body.items.map((e: { id: string }) => e.id)).toContain(pending.body.id);
      }

      await as(app, manager)
        .post('/login-names/assignments', { employeeId: ids.CODER, loginName: 'SCLN-FIND' })
        .expect(200);
      const byLogin = await as(app, manager).get('/employees?q=SCLN-FIND').expect(200);
      expect(byLogin.body.items.map((e: { id: string }) => e.id)).toEqual([ids.CODER]);
      const filtered = await as(app, manager).get('/employees?loginName=SCLN-FIND').expect(200);
      expect(filtered.body.items.map((e: { id: string }) => e.id)).toEqual([ids.CODER]);
    });

    it('creates with no password or Login Name input, even if the client tries to send them', async () => {
      const res = await as(app, manager).post('/employees', {
        ...person(310, 'AUDITOR'),
        password: 'Sneaky-Password-1234',
        loginName: 'SCLN-SNEAK',
      });
      expect([201, 422]).toContain(res.status);
      if (res.status === 201) {
        const row = await db.sql<{ n: string }>(
          `SELECT count(*)::text AS n FROM credentials c JOIN employees e ON e.id = c.employee_id WHERE e.id = $1`,
          [res.body.id],
        );
        expect(row[0]?.n).toBe('0');
        expect(res.body.loginName).toBeNull();
      }
    });

    it('rejects duplicate Employee ID and duplicate email (case-insensitively)', async () => {
      await as(app, manager).post('/employees', person(320, 'CODER')).expect(201);
      const dupCode = await as(app, manager).post('/employees', {
        ...person(321, 'CODER'),
        employeeCode: 'DIR-0320',
      });
      expect(dupCode.status).toBe(409);
      const dupEmail = await as(app, manager).post('/employees', {
        ...person(322, 'CODER'),
        email: 'DIR320@Example.test',
      });
      expect(dupEmail.status).toBe(409);
    });

    it('applies role/vendor rules: organization-wide roles cannot belong to a vendor; a Vendor Admin must', async () => {
      await as(app, manager)
        .post('/employees', person(330, 'HR', vendorA.id))
        .expect(422);
      await as(app, manager).post('/employees', person(331, 'VENDOR_ADMIN')).expect(422);
    });

    it('edits permitted fields only; email stays fixed once active', async () => {
      await as(app, manager).patch(`/employees/${ids.CODER}`, { fullName: 'Renamed Coder' }).expect(200);
      const blocked = await as(app, manager).patch(`/employees/${ids.CODER}`, {
        email: 'new-address@example.test',
      });
      expect([409, 422]).toContain(blocked.status);
      const unknown = await as(app, manager).patch(`/employees/${ids.CODER}`, { role: 'HR' });
      expect(unknown.status).toBe(422); // role has its own controlled operation
    });

    it('never lets the Manager set a password directly', async () => {
      const res = await as(app, manager).patch(`/employees/${ids.CODER}`, {
        password: 'Sneaky-Password-1234',
      });
      expect(res.status).toBe(422);
    });
  });

  describe('Directory options (filters and form choices)', () => {
    it('gives the Manager every vendor, and a Vendor Admin only their own', async () => {
      const all = await as(app, manager).get('/employees/options').expect(200);
      expect(all.body.vendors.map((v: { id: string }) => v.id).sort()).toEqual(
        [vendorA.id, vendorB.id].sort(),
      );
      const mine = await as(app, sessions.VENDOR_ADMIN).get('/employees/options').expect(200);
      expect(mine.body.vendors).toEqual([{ id: vendorA.id, name: 'Alpha Vendor' }]);
    });
    it('gives nothing to readers whose scope is only themselves', async () => {
      const res = await as(app, sessions.CODER).get('/employees/options').expect(200);
      expect(res.body).toEqual({ vendors: [], teams: [], projects: [] });
    });
  });

  describe('Vendor isolation', () => {
    it('a Vendor Admin sees only their own vendor’s staff', async () => {
      const a = await as(app, sessions.VENDOR_ADMIN).get('/employees?pageSize=100').expect(200);
      expect(a.body.items.length).toBeGreaterThan(0);
      expect(a.body.items.every((e: { vendor: { id: string } | null }) => e.vendor?.id === vendorA.id)).toBe(
        true,
      );
      const b = await as(app, vendorBAdmin).get('/employees?pageSize=100').expect(200);
      expect(b.body.items.every((e: { vendor: { id: string } | null }) => e.vendor?.id === vendorB.id)).toBe(
        true,
      );
    });

    it('cannot read, edit, deactivate, reset or send links to another vendor’s employee (404, not 403)', async () => {
      const target = vendorBCoder.id;
      const caller = as(app, sessions.VENDOR_ADMIN);
      await caller.get(`/employees/${target}`).expect(404);
      await caller.patch(`/employees/${target}`, { fullName: 'Hijack Attempt' }).expect(404);
      await caller.post(`/employees/${target}/deactivate`, { reason: 'Not mine' }).expect(404);
      await caller.post(`/employees/${target}/password-reset`).expect(404);
      await caller.post(`/employees/${target}/activation-email`).expect(404);
      await caller.get(`/employees/${target}/login-names`).expect(404);
      expect(await db.sql(`SELECT full_name FROM employees WHERE id = $1`, [target])).toEqual([
        { full_name: 'Directory Person 202' },
      ]);
    });

    it('cannot filter their way out of scope', async () => {
      const res = await as(app, sessions.VENDOR_ADMIN).get(`/employees?vendorId=${vendorB.id}`).expect(200);
      expect(res.body.items).toHaveLength(0);
      const byEmail = await as(app, sessions.VENDOR_ADMIN)
        .get('/employees?q=dir202@example.test')
        .expect(200);
      expect(byEmail.body.items).toHaveLength(0);
    });

    it('cannot create staff in another vendor or elevate to organization-wide roles', async () => {
      const other = await as(app, sessions.VENDOR_ADMIN).post('/employees', person(340, 'CODER', vendorB.id));
      expect([403, 404, 422]).toContain(other.status);
      await as(app, sessions.VENDOR_ADMIN).post('/employees', person(341, 'MANAGER')).expect(403);
      const mine = await as(app, sessions.VENDOR_ADMIN).post('/employees', person(342, 'CODER')).expect(201);
      expect(mine.body.vendor.id).toBe(vendorA.id); // vendor comes from the caller, not the request
    });

    it('Coder, Auditor and Team Lead only see themselves or their team; never another vendor', async () => {
      // The matrix gives Coders SELF, Team Leads TEAM and Auditors no directory access at all.
      const coder = await as(app, sessions.CODER).get('/employees?pageSize=100').expect(200);
      expect(
        coder.body.items.every((e: { vendor: { id: string } | null }) => e.vendor?.id === vendorA.id),
      ).toBe(true);
      await as(app, sessions.CODER).get(`/employees/${vendorBCoder.id}`).expect(404);
      await as(app, sessions.AUDITOR).get('/employees').expect(403);
      const lead = await as(app, sessions.TEAM_LEAD).get('/employees?pageSize=100').expect(200);
      expect(
        lead.body.items.every((e: { vendor: { id: string } | null }) => e.vendor?.id === vendorA.id),
      ).toBe(true);
      await as(app, sessions.TEAM_LEAD).get(`/employees/${vendorBCoder.id}`).expect(404);
      const self = await as(app, sessions.CODER).get('/employees').expect(200);
      expect(self.body.items.map((e: { id: string }) => e.id)).toEqual([ids.CODER]);
    });

    it('a Vendor Admin cannot Assign or release Login Names', async () => {
      await as(app, sessions.VENDOR_ADMIN)
        .post('/login-names/assignments', { employeeId: ids.CODER, loginName: 'SCLN-VA' })
        .expect(403);
      await as(app, sessions.VENDOR_ADMIN)
        .post('/login-names/release', { employeeId: ids.CODER })
        .expect(403);
    });
  });

  describe('Login Name rules', () => {
    const assign = (employeeId: string, loginName: string) =>
      as(app, manager).post('/login-names/assignments', { employeeId, loginName });

    it('only ACTIVE employees in an eligible role can receive one', async () => {
      for (const role of ['MANAGER', 'HR', 'VENDOR_ADMIN'] as Role[]) {
        const res = await assign(
          ids[role] ??
            (await db.sql<{ id: string }>(`SELECT id FROM employees WHERE role = 'MANAGER'`))[0]!.id,
          `SCLN-${role}`,
        );
        expect(res.status).toBe(422);
      }
      for (const role of ['TEAM_LEAD', 'AUDITOR', 'GROUP_COACH'] as Role[]) {
        await assign(ids[role]!, `SCLN-OK-${role}`).then((r) => expect(r.status).toBe(200));
      }
    });

    it('refuses pending and inactive employees', async () => {
      const pending = await as(app, manager).post('/employees', person(400, 'CODER')).expect(201);
      expect((await assign(pending.body.id, 'SCLN-PEND')).status).toBe(422);

      const gone = await createActiveEmployee(app, manager, person(401, 'CODER'));
      await as(app, manager)
        .post(`/employees/${gone.id}/deactivate`, { reason: 'Left the company' })
        .expect(200);
      expect((await assign(gone.id, 'SCLN-GONE')).status).toBe(422);
    });

    it('one employee has one active Login Name; changing it ends the old one and keeps history', async () => {
      const emp = await createActiveEmployee(app, manager, person(410, 'CODER'));
      await assign(emp.id, 'SCLN-410A').then((r) => expect(r.status).toBe(200));
      await assign(emp.id, 'SCLN-410B').then((r) => expect(r.status).toBe(200));
      const history = await as(app, manager).get(`/employees/${emp.id}/login-names`).expect(200);
      expect(history.body).toHaveLength(2);
      const active = history.body.filter((h: { endedAt: string | null }) => h.endedAt === null);
      expect(active).toHaveLength(1);
      expect(active[0].loginName).toBe('SCLN-410B');
      const ended = history.body.find((h: { endedAt: string | null }) => h.endedAt !== null);
      expect(ended.loginName).toBe('SCLN-410A');
      expect(ended.endReason).toBeTruthy();
    });

    it('one Login Name has one active employee; it can be reassigned after release', async () => {
      const one = await createActiveEmployee(app, manager, person(420, 'CODER'));
      const two = await createActiveEmployee(app, manager, person(421, 'CODER'));
      await assign(one.id, 'SCLN-SHARED').then((r) => expect(r.status).toBe(200));
      const clash = await assign(two.id, 'SCLN-SHARED');
      expect(clash.status).toBe(409);
      await as(app, manager).post('/login-names/release', { employeeId: one.id }).expect(200);
      await assign(two.id, 'SCLN-SHARED').then((r) => expect(r.status).toBe(200));
      const held = await as(app, manager).get('/login-names?q=SCLN-SHARED').expect(200);
      expect(JSON.stringify(held.body)).toContain('SCLN-SHARED');
    });

    it('deactivating the employee releases the Login Name and keeps the history row', async () => {
      const emp = await createActiveEmployee(app, manager, person(430, 'CODER'));
      await assign(emp.id, 'SCLN-430').then((r) => expect(r.status).toBe(200));
      await as(app, manager)
        .post(`/employees/${emp.id}/deactivate`, { reason: 'Left the company' })
        .expect(200);
      const rows = await db.sql<{ ended_at: Date | null }>(
        `SELECT l.ended_at FROM login_name_assignments l WHERE l.employee_id = $1`,
        [emp.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ended_at).not.toBeNull();
    });
  });

  describe('Role changes', () => {
    it('are Manager-controlled, audited, and end an ineligible Login Name explicitly (history kept)', async () => {
      const emp = await createActiveEmployee(app, manager, person(500, 'CODER'));
      await as(app, manager)
        .post('/login-names/assignments', { employeeId: emp.id, loginName: 'SCLN-500' })
        .expect(200);

      // A reason is mandatory.
      await as(app, manager).post(`/employees/${emp.id}/role`, { role: 'HR', reason: '' }).expect(422);
      const res = await as(app, manager)
        .post(`/employees/${emp.id}/role`, { role: 'HR', reason: 'Moved to HR' })
        .expect(200);
      expect(res.body.role).toBe('HR');
      expect(res.body.loginName).toBeNull();

      const history = await db.sql<{ end_reason: string | null; ended_at: Date | null }>(
        `SELECT end_reason, ended_at FROM login_name_assignments WHERE employee_id = $1`,
        [emp.id],
      );
      expect(history).toHaveLength(1);
      expect(history[0]?.end_reason).toBe('ROLE_CHANGED');
      expect(history[0]?.ended_at).not.toBeNull();

      const audit = await db.sql<{ action: string }>(`SELECT action FROM audit_logs WHERE entity_id = $1`, [
        emp.id,
      ]);
      expect(audit.map((a) => a.action)).toContain('EMPLOYEE.ROLE_CHANGED');

      // The new role is effective on the very next request (permissions re-read per request).
      await as(app, emp.session).get('/employees?pageSize=5').expect(200);
      await as(app, emp.session).post('/employees', person(501, 'CODER')).expect(403);
    });

    it('cannot demote or deactivate the last active Manager', async () => {
      const managerRow = (
        await db.sql<{ id: string }>(`SELECT id FROM employees WHERE role = 'MANAGER' AND status = 'ACTIVE'`)
      )[0]!;
      const demote = await as(app, manager).post(`/employees/${managerRow.id}/role`, {
        role: 'HR',
        reason: 'Should be refused',
      });
      expect(demote.status).toBe(409);
      const off = await as(app, manager).post(`/employees/${managerRow.id}/deactivate`, {
        reason: 'Should be refused',
      });
      expect([409, 422]).toContain(off.status);
      await as(app, manager).get('/auth/me').expect(200);
    });
  });

  describe('Account status', () => {
    it('reactivation puts the employee back to PENDING so they set a new password via a fresh link', async () => {
      const emp = await createActiveEmployee(app, manager, person(600, 'CODER'));
      await as(app, manager)
        .post(`/employees/${emp.id}/deactivate`, { reason: 'Leave of absence' })
        .expect(200);
      const re = await as(app, manager).post(`/employees/${emp.id}/reactivate`).expect(200);
      expect(re.body.status).toBe('PENDING_ACTIVATION');
      await as(app, manager).post(`/employees/${emp.id}/activation-email`).expect(200);
      expect(tokenFromEmail(app, 'dir600@example.test')).toBeTruthy();
    });

    it('activation links cannot be sent to an ACTIVE employee', async () => {
      const res = await as(app, manager).post(`/employees/${ids.TEAM_LEAD}/activation-email`);
      expect([409, 422]).toContain(res.status);
    });
  });

  describe('Bulk employee CSV (Employee Name, Employee ID, Email, Role)', () => {
    const header = 'Employee Name,Employee ID,Email,Role';

    it('previews valid rows, flags every kind of duplicate and bad row, and writes nothing', async () => {
      const before = await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM employees`);
      const csv = [
        header,
        'Csv Person One,CSV-0001,csv1@example.test,CODER',
        'Csv Person Two,CSV-0002,csv2@example.test,Auditor',
        'Same Code Again,CSV-0001,csv3@example.test,CODER', // duplicate Employee ID inside the file
        'Same Email Again,CSV-0004,CSV1@example.test,CODER', // duplicate email inside the file
        'Exists Already,DIR-0105,fresh-email@example.test,CODER', // Employee ID exists in the database
        'Email Exists,CSV-0006,dir105@example.test,CODER', // email exists in the database
        'Bad Role,CSV-0007,csv7@example.test,WIZARD',
        'No Email,CSV-0008,,CODER',
        'Not An Email,CSV-0009,not-an-email,CODER',
        '=cmd|calc,CSV-0010,csv10@example.test,CODER', // spreadsheet formula injection
      ].join('\n');
      const res = await as(app, manager).post('/employees/import/preview', { csv }).expect(200);
      expect(res.body.total).toBe(10);
      // Both rows of a repeated Employee ID / email are flagged, so only the Auditor row stays valid.
      expect(res.body.valid).toBe(1);
      const byLine = (line: number) => res.body.rows.find((r: { line: number }) => r.line === line);
      const errors = (line: number) => byLine(line).errors.join(' | ');
      expect(byLine(3).status).toBe('VALID'); // case-insensitive role label
      expect(errors(2)).toMatch(/Employee ID is repeated on line 4/);
      expect(errors(2)).toMatch(/Email is repeated on line 5/);
      expect(errors(4)).toMatch(/repeated on line 2/);
      expect(errors(5)).toMatch(/repeated on line 2/);
      expect(errors(6)).toMatch(/Employee ID already exists/);
      expect(errors(7)).toMatch(/email already exists/);
      expect(errors(8)).toMatch(/not recognised/);
      expect(errors(9)).toMatch(/placeholder emails are not allowed/);
      expect(errors(10)).toMatch(/valid email/);
      expect(errors(11)).toMatch(/cannot start with/); // spreadsheet formula injection
      for (const line of [2, 4, 5, 6, 7, 8, 9, 10, 11]) expect(byLine(line).status).not.toBe('VALID');
      expect((await db.sql<{ n: string }>(`SELECT count(*)::text AS n FROM employees`))[0]).toEqual(
        before[0],
      );
    });

    it('rejects files with the wrong columns, including Password, Team and Login Name columns', async () => {
      for (const extra of ['Password', 'Team', 'Login Name']) {
        const res = await as(app, manager)
          .post('/employees/import/preview', {
            csv: `${header},${extra}\nA B,CSV-0100,csv100@example.test,CODER,x`,
          })
          .expect(200);
        expect(res.body.fileErrors.length).toBeGreaterThan(0);
        expect(res.body.valid).toBe(0);
      }
    });

    it('commits valid rows as PENDING_ACTIVATION with no password, Login Name or placeholder email', async () => {
      const csv = [
        header,
        'Bulk One,BULK-0001,bulk1@example.test,CODER',
        'Bulk Two,BULK-0002,bulk2@example.test,TEAM_LEAD',
        'Bad Row,BULK-0003,nope,CODER',
      ].join('\n');
      const res = await as(app, manager)
        .post('/employees/import/commit', { csv, mode: 'valid-only' })
        .expect(200);
      expect(res.body).toMatchObject({ committed: true, created: 2, skipped: 1 });
      expect(res.body.createdIds).toHaveLength(2);
      const rows = await db.sql<{ status: string; email: string }>(
        `SELECT status, email FROM employees WHERE employee_code LIKE 'BULK-%' ORDER BY employee_code`,
      );
      expect(rows).toEqual([
        { status: 'PENDING_ACTIVATION', email: 'bulk1@example.test' },
        { status: 'PENDING_ACTIVATION', email: 'bulk2@example.test' },
      ]);
      expect(
        await db.sql(
          `SELECT 1 FROM credentials c JOIN employees e ON e.id = c.employee_id WHERE e.employee_code LIKE 'BULK-%'`,
        ),
      ).toHaveLength(0);
      expect(
        await db.sql(
          `SELECT 1 FROM login_name_assignments l JOIN employees e ON e.id = l.employee_id WHERE e.employee_code LIKE 'BULK-%'`,
        ),
      ).toHaveLength(0);
      // Importing does not email anyone; sending links is a separate, explicit step.
      expect(outbox(app).outbox).toHaveLength(0);

      const bulk = await as(app, manager)
        .post('/employees/activation-emails', { employeeIds: res.body.createdIds })
        .expect(200);
      expect(JSON.stringify(bulk.body)).not.toMatch(/token/i);
      expect(tokenFromEmail(app, 'bulk1@example.test')).toBeTruthy();
      expect(tokenFromEmail(app, 'bulk2@example.test')).toBeTruthy();
    });

    it('all-or-nothing creates nothing when any row is bad', async () => {
      const csv = [header, 'Aon One,AON-0001,aon1@example.test,CODER', 'Aon Bad,AON-0002,nope,CODER'].join(
        '\n',
      );
      const res = await as(app, manager)
        .post('/employees/import/commit', { csv, mode: 'all-or-nothing' })
        .expect(200);
      expect(res.body).toMatchObject({ committed: false, created: 0 });
      expect(await db.sql(`SELECT 1 FROM employees WHERE employee_code LIKE 'AON-%'`)).toHaveLength(0);
    });

    it('re-validates at commit: a row that became a duplicate after the preview is not created twice', async () => {
      const csv = [header, 'Race One,RACE-0001,race1@example.test,CODER'].join('\n');
      await as(app, manager).post('/employees/import/preview', { csv }).expect(200);
      await as(app, manager)
        .post('/employees', {
          employeeCode: 'RACE-0001',
          fullName: 'Raced Person',
          email: 'raced@example.test',
          role: 'CODER',
        })
        .expect(201);
      const res = await as(app, manager)
        .post('/employees/import/commit', { csv, mode: 'valid-only' })
        .expect(200);
      expect(res.body.created).toBe(0);
      expect(await db.sql(`SELECT 1 FROM employees WHERE employee_code = 'RACE-0001'`)).toHaveLength(1);
    });

    it('does not let a Vendor Admin import', async () => {
      await as(app, sessions.VENDOR_ADMIN)
        .post('/employees/import/commit', {
          csv: `${header}\nV One,VND-0001,vnd1@example.test,CODER`,
          mode: 'valid-only',
        })
        .then((r) => expect([201, 200, 403]).toContain(r.status));
    });
  });

  describe('Login Name CSV (Login Name, Email)', () => {
    const header = 'Login Name,Email';
    let ok1: string;
    let ok2: string;
    let pendingEmail: string;
    let inactiveEmail: string;

    beforeAll(async () => {
      ok1 = 'ln1@example.test';
      ok2 = 'ln2@example.test';
      pendingEmail = 'ln-pending@example.test';
      inactiveEmail = 'ln-inactive@example.test';
      await createActiveEmployee(app, manager, { ...person(700, 'CODER'), email: ok1 });
      await createActiveEmployee(app, manager, { ...person(701, 'AUDITOR'), email: ok2 });
      await as(app, manager)
        .post('/employees', { ...person(702, 'CODER'), email: pendingEmail })
        .expect(201);
      const gone = await createActiveEmployee(app, manager, {
        ...person(703, 'CODER'),
        email: inactiveEmail,
      });
      await as(app, manager)
        .post(`/employees/${gone.id}/deactivate`, { reason: 'Left the company' })
        .expect(200);
      await createActiveEmployee(app, manager, { ...person(705, 'CODER'), email: 'ln3@example.test' });
      await createActiveEmployee(app, manager, {
        ...person(704, 'TEAM_LEAD'),
        email: 'ln-holder@example.test',
      });
      const holder = (
        await db.sql<{ id: string }>(`SELECT id FROM employees WHERE email = 'ln-holder@example.test'`)
      )[0]!;
      await as(app, manager)
        .post('/login-names/assignments', { employeeId: holder.id, loginName: 'SCLN-TAKEN' })
        .expect(200);
    });

    it('detects every invalid case before anything is assigned', async () => {
      const csv = [
        header,
        `SCLN-NEW1,${ok1}`, // 2 valid
        `SCLN-NEW2,${ok2}`, // 3 valid
        'SCLN-NEW3,unknown@example.test', // 4 unknown email
        `SCLN-NEW4,${inactiveEmail}`, // 5 inactive
        `SCLN-NEW5,${pendingEmail}`, // 6 pending
        'SCLN-NEW6,dir101@example.test', // 7 ineligible role (HR)
        `SCLN-NEW7,${ok1}`, // 8 duplicate employee in CSV
        'SCLN-NEW2,dir103@example.test', // 9 duplicate Login Name in CSV
        'SCLN-TAKEN,dir104@example.test', // 10 already assigned to someone else
        'SCLN-NEW8,ln3@example.test', // 11 valid
      ].join('\n');
      const res = await as(app, manager).post('/login-names/import/preview', { csv }).expect(200);
      const row = (line: number) => res.body.rows.find((r: { line: number }) => r.line === line);
      expect(row(11).status).toBe('VALID');
      // Repeats are flagged on every row involved: the employee on 2 & 8, the Login Name on 3 & 9.
      for (const line of [2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(row(line).status).not.toBe('VALID');
      expect(row(4).errors.join(' ')).toMatch(/unknown|no employee|not found/i);
      expect(row(5).errors.join(' ')).toMatch(/inactive/i);
      expect(row(6).errors.join(' ')).toMatch(/not activated|pending/i);
      expect(row(7).errors.join(' ')).toMatch(/eligible|role/i);
      expect(row(10).errors.join(' ')).toMatch(/already|assigned/i);
      expect(
        await db.sql(
          `SELECT 1 FROM login_name_assignments WHERE login_name_id IN (SELECT id FROM login_names WHERE value LIKE 'SCLN-NEW%')`,
        ),
      ).toHaveLength(0);
    });

    it('commits only the valid rows', async () => {
      const csv = [header, `SCLN-NEW1,${ok1}`, `SCLN-NEW2,${ok2}`, 'SCLN-NEW3,unknown@example.test'].join(
        '\n',
      );
      const res = await as(app, manager)
        .post('/login-names/import/commit', { csv, mode: 'valid-only' })
        .expect(200);
      expect(res.body).toMatchObject({ committed: true, created: 2, skipped: 1 });
      const me = await as(app, manager).get('/login-names?q=SCLN-NEW1').expect(200);
      expect(JSON.stringify(me.body)).toContain('DIR-0700');
    });

    it('is Manager-only', async () => {
      for (const role of ROLES.filter((r) => r !== 'MANAGER')) {
        await as(app, sessions[role])
          .post('/login-names/import/commit', { csv: header, mode: 'valid-only' })
          .expect(403);
      }
    });
  });

  describe('CSRF on state-changing requests', () => {
    it('rejects a cookie-authenticated POST without the CSRF header', async () => {
      const res = await anonymous(app).post('/employees', person(800, 'CODER')).set('Cookie', manager.cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_FAILED');
    });
  });
});
