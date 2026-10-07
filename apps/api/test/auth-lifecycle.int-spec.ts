import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import {
  OTHER_PASSWORD,
  STRONG_PASSWORD,
  anonymous,
  as,
  bootstrapAndSignInManager,
  createActiveEmployee,
  outbox,
  runBootstrap,
  signIn,
  tokenFromEmail,
  type Session,
} from './auth-helpers';

jest.setTimeout(60_000);

/**
 * Phase 3 — the whole authentication lifecycle over HTTP against real PostgreSQL (real migrations, real triggers,
 * real guards, memory mail transport). Synthetic data only.
 */
describeDb('Authentication lifecycle (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  beforeEach(() => outbox(app).clear());

  const employeeBody = (n: number, role = 'CODER') => ({
    employeeCode: `EMP-${n.toString().padStart(4, '0')}`,
    fullName: `Synthetic Person ${n}`,
    email: `person${n}@example.test`,
    role,
  });

  describe('Manager bootstrap', () => {
    it('created a single ACTIVE Manager with a password hash, no default password, and no Login Name', async () => {
      const rows = await db.sql<{ status: string; role: string; hash: string | null }>(
        `SELECT e.status, e.role, c.password_hash AS hash FROM employees e LEFT JOIN credentials c ON c.employee_id = e.id WHERE e.role = 'MANAGER'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'ACTIVE', role: 'MANAGER' });
      expect(rows[0]?.hash).toMatch(/^\$argon2id\$/);
      expect(await db.sql(`SELECT 1 FROM login_name_assignments`)).toHaveLength(0);
    });

    it('is idempotent: running it again after activation creates nothing', async () => {
      const outcome = await runBootstrap(app, {
        email: 'someone-else@example.test',
        fullName: 'Someone Else',
        employeeCode: 'MGR-0002',
      });
      expect(outcome.status).toBe('already-active');
      expect(await db.sql(`SELECT 1 FROM employees WHERE role = 'MANAGER'`)).toHaveLength(1);
      expect(outbox(app).outbox).toHaveLength(0);
    });
  });

  describe('Employee path: create → activate → password → sign in → Login Name', () => {
    it('walks the whole path and never hands the Manager a password', async () => {
      const body = employeeBody(1);
      const created = await as(app, manager).post('/employees', body).expect(201);
      expect(created.body).toMatchObject({
        status: 'PENDING_ACTIVATION',
        email: body.email,
        loginName: null,
      });
      expect(JSON.stringify(created.body)).not.toMatch(/password|hash|token/i);
      // Creating without sendActivation sends nothing yet.
      expect(outbox(app).outbox).toHaveLength(0);

      // A pending employee cannot sign in, and the response does not reveal why.
      const pending = await anonymous(app).post('/auth/login', {
        email: body.email,
        password: STRONG_PASSWORD,
      });
      expect(pending.status).toBe(401);
      expect(pending.body.code).toBe('UNAUTHENTICATED');

      // Manager sends the activation link; the email carries a link built from WEB_URL.
      await as(app, manager).post(`/employees/${created.body.id}/activation-email`).expect(200);
      const mail = outbox(app).lastTo(body.email);
      expect(mail?.text).toContain('http://localhost:3000/account/activate?token=');
      expect(mail?.subject).toMatch(/Activate/);

      const token = tokenFromEmail(app, body.email);
      // The database keeps only a hash of the token.
      const stored = await db.sql<{ token_hash: string }>(
        `SELECT token_hash FROM auth_tokens WHERE employee_id = $1`,
        [created.body.id],
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.token_hash).not.toContain(token);

      await anonymous(app).post('/auth/tokens/check', { type: 'ACTIVATION', token }).expect(200);
      await anonymous(app).post('/auth/activation', { token, password: STRONG_PASSWORD }).expect(204);

      const employee = await db.sql<{ status: string; activated_at: Date | null }>(
        `SELECT status, activated_at FROM employees WHERE id = $1`,
        [created.body.id],
      );
      expect(employee[0]?.status).toBe('ACTIVE');
      expect(employee[0]?.activated_at).not.toBeNull();
      // No Login Name was generated at activation (spec 3.4).
      expect(await db.sql(`SELECT 1 FROM login_name_assignments`)).toHaveLength(0);

      const session = await signIn(app, body.email, STRONG_PASSWORD);
      const me = await as(app, session).get('/auth/me').expect(200);
      expect(me.body.employee).toMatchObject({
        email: body.email,
        role: 'CODER',
        loginName: null,
        status: 'ACTIVE',
      });

      // Login Name assignment is a separate, Manager-only step.
      await as(app, session)
        .post('/login-names/assignments', { employeeId: created.body.id, loginName: 'SCLN001' })
        .expect(403);
      const assigned = await as(app, manager)
        .post('/login-names/assignments', { employeeId: created.body.id, loginName: 'SCLN001' })
        .expect(200);
      expect(assigned.body).toMatchObject({ loginName: 'SCLN001' });
      const afterAssign = await as(app, session).get('/auth/me').expect(200);
      expect(afterAssign.body.employee.loginName).toBe('SCLN001');

      // A Login Name is not an authentication identity.
      const byLoginName = await anonymous(app).post('/auth/login', {
        email: 'SCLN001',
        password: STRONG_PASSWORD,
      });
      expect(byLoginName.status).toBe(422);
    });
  });

  describe('Sign-in security', () => {
    it('rejects a wrong password and an unknown email with the same response', async () => {
      const wrongPassword = await anonymous(app).post('/auth/login', {
        email: 'manager@example.test',
        password: 'Wrong-Password-99x',
      });
      const unknownEmail = await anonymous(app).post('/auth/login', {
        email: 'nobody@example.test',
        password: 'Wrong-Password-99x',
      });
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.code).toBe('UNAUTHENTICATED');
      expect(unknownEmail.body.code).toBe('UNAUTHENTICATED');
      expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
    });

    it('never returns a password, hash or token, and sets httpOnly cookies', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'manager@example.test', password: STRONG_PASSWORD })
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|accessToken|refreshToken|eyJ/);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.find((c) => c.startsWith('sc_at='))).toMatch(/HttpOnly/i);
      expect(cookies.find((c) => c.startsWith('sc_rt='))).toMatch(/HttpOnly/i);
      expect(cookies.find((c) => c.startsWith('sc_rt='))).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookies.find((c) => c.startsWith('sc_csrf='))).not.toMatch(/HttpOnly/i);
    });

    it('locks the credential after repeated failures (429), then still refuses the right password', async () => {
      const email = 'lockout@example.test';
      await createActiveEmployee(app, manager, { ...employeeBody(40), email });
      for (let i = 0; i < 5; i += 1) {
        await anonymous(app).post('/auth/login', { email, password: 'Wrong-Password-99x' });
      }
      const locked = await anonymous(app).post('/auth/login', { email, password: STRONG_PASSWORD });
      expect(locked.status).toBe(429);
    });

    it('rejects a Login Name used as the email', async () => {
      const res = await anonymous(app).post('/auth/login', { email: 'SCLN001', password: STRONG_PASSWORD });
      expect(res.status).toBe(422);
    });
  });

  describe('Logout and session revocation', () => {
    it('logout revokes the session immediately, even though the access token has not expired', async () => {
      const email = 'logout@example.test';
      const { session } = await createActiveEmployee(app, manager, { ...employeeBody(10), email });
      await as(app, session).get('/auth/me').expect(200);
      await as(app, session).post('/auth/logout').expect(204);
      await as(app, session).get('/auth/me').expect(401);
    });

    it('deactivation revokes sessions at once and blocks new sign-ins; history is preserved', async () => {
      const email = 'deactivate@example.test';
      const { id, session } = await createActiveEmployee(app, manager, { ...employeeBody(11), email });
      await as(app, session).get('/auth/me').expect(200);
      await as(app, manager).post(`/employees/${id}/deactivate`, { reason: 'Left the company' }).expect(200);
      await as(app, session).get('/auth/me').expect(401);
      const again = await anonymous(app).post('/auth/login', { email, password: STRONG_PASSWORD });
      expect(again.status).toBe(403);
      expect(again.body.code).toBe('ACCOUNT_UNAVAILABLE');
      expect(again.headers['set-cookie']).toBeUndefined();
      // Not deleted.
      expect(await db.sql(`SELECT status FROM employees WHERE id = $1`, [id])).toEqual([
        { status: 'INACTIVE' },
      ]);
      expect(outbox(app).lastTo(email)?.subject).toMatch(/deactivat|access|account/i);
    });

    it('refresh rotates the token; replaying an old refresh token revokes the whole family', async () => {
      const email = 'refresh@example.test';
      const { session } = await createActiveEmployee(app, manager, { ...employeeBody(12), email });
      const server = app.getHttpServer();
      const first = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf);
      expect(first.status).toBe(200);
      const rotated = (first.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('sc_rt='))!
        .split(';')[0]!;
      const replay = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', session.cookie)
        .set('X-CSRF-Token', session.csrf);
      expect(replay.status).toBe(401);
      // The legitimately rotated token is now dead too (family revoked on reuse).
      const afterReuse = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${rotated}; sc_csrf=${session.csrf}`)
        .set('X-CSRF-Token', session.csrf);
      expect(afterReuse.status).toBe(401);
    });

    it('a user can list and revoke their own sessions but not another person’s', async () => {
      const { session: a } = await createActiveEmployee(app, manager, {
        ...employeeBody(13),
        email: 'sess-a@example.test',
      });
      const { session: b } = await createActiveEmployee(app, manager, {
        ...employeeBody(14),
        email: 'sess-b@example.test',
      });
      const mine = await as(app, a).get('/auth/sessions').expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].current).toBe(true);
      const theirs = await as(app, b).get('/auth/sessions').expect(200);
      await as(app, a).delete(`/auth/sessions/${theirs.body[0].id}`).expect(404);
      await as(app, b).get('/auth/me').expect(200);
    });
  });

  describe('Activation tokens', () => {
    it('are single use: the second use is rejected, and so is a check', async () => {
      const created = await as(app, manager)
        .post('/employees', { ...employeeBody(20), sendActivation: true })
        .expect(201);
      const token = tokenFromEmail(app, 'person20@example.test');
      await anonymous(app).post('/auth/activation', { token, password: STRONG_PASSWORD }).expect(204);
      const reuse = await anonymous(app).post('/auth/activation', { token, password: OTHER_PASSWORD });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('TOKEN_INVALID');
      const check = await anonymous(app)
        .post('/auth/tokens/check', { type: 'ACTIVATION', token })
        .expect(200);
      expect(check.body).toEqual({ valid: false });
      // The first password still works; the replayed one was not applied.
      await signIn(app, 'person20@example.test', STRONG_PASSWORD);
      expect(created.body.id).toBeDefined();
    });

    it('expire: an expired link is rejected and the account stays pending', async () => {
      const created = await as(app, manager)
        .post('/employees', { ...employeeBody(21), sendActivation: true })
        .expect(201);
      const token = tokenFromEmail(app, 'person21@example.test');
      await db.sql(
        `UPDATE auth_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE employee_id = $1`,
        [created.body.id],
      );
      const res = await anonymous(app).post('/auth/activation', { token, password: STRONG_PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TOKEN_INVALID');
      expect(await db.sql(`SELECT status FROM employees WHERE id = $1`, [created.body.id])).toEqual([
        { status: 'PENDING_ACTIVATION' },
      ]);
    });

    it('resending revokes the previous link', async () => {
      const created = await as(app, manager)
        .post('/employees', { ...employeeBody(22), sendActivation: true })
        .expect(201);
      const first = tokenFromEmail(app, 'person22@example.test');
      await as(app, manager).post(`/employees/${created.body.id}/activation-email`).expect(200);
      const second = tokenFromEmail(app, 'person22@example.test');
      expect(second).not.toBe(first);
      await anonymous(app).post('/auth/activation', { token: first, password: STRONG_PASSWORD }).expect(400);
      await anonymous(app).post('/auth/activation', { token: second, password: STRONG_PASSWORD }).expect(204);
    });

    it('reject a weak password and a garbage token without consuming the link', async () => {
      await as(app, manager)
        .post('/employees', { ...employeeBody(23), sendActivation: true })
        .expect(201);
      const token = tokenFromEmail(app, 'person23@example.test');
      await anonymous(app).post('/auth/activation', { token, password: 'password1234' }).expect(422);
      await anonymous(app).post('/auth/activation', { token, password: 'person23@example.test' }).expect(422);
      await anonymous(app)
        .post('/auth/activation', { token: 'x'.repeat(43), password: STRONG_PASSWORD })
        .expect(400);
      await anonymous(app).post('/auth/activation', { token, password: STRONG_PASSWORD }).expect(204);
    });
  });

  describe('Password reset', () => {
    it('request → email → reset → sign in with the new password only', async () => {
      const email = 'reset@example.test';
      await createActiveEmployee(app, manager, { ...employeeBody(30), email });
      outbox(app).clear();

      const accepted = await anonymous(app).post('/auth/password/forgot', { email });
      expect(accepted.status).toBe(202);
      expect(accepted.body).toEqual({ accepted: true });
      const mail = outbox(app).lastTo(email);
      expect(mail?.text).toContain('/account/reset-password?token=');

      const token = tokenFromEmail(app, email);
      await anonymous(app).post('/auth/tokens/check', { type: 'PASSWORD_RESET', token }).expect(200);
      await anonymous(app).post('/auth/password/reset', { token, password: OTHER_PASSWORD }).expect(204);

      await signIn(app, email, OTHER_PASSWORD);
      const old = await anonymous(app).post('/auth/login', { email, password: STRONG_PASSWORD });
      expect(old.status).toBe(401);
    });

    it('revokes existing sessions when the password is reset', async () => {
      const email = 'reset-sessions@example.test';
      const { session } = await createActiveEmployee(app, manager, { ...employeeBody(31), email });
      await as(app, session).get('/auth/me').expect(200);
      await anonymous(app).post('/auth/password/forgot', { email }).expect(202);
      await anonymous(app)
        .post('/auth/password/reset', { token: tokenFromEmail(app, email), password: OTHER_PASSWORD })
        .expect(204);
      await as(app, session).get('/auth/me').expect(401);
    });

    it('is single use and expires', async () => {
      const email = 'reset-once@example.test';
      const { id } = await createActiveEmployee(app, manager, { ...employeeBody(32), email });
      await anonymous(app).post('/auth/password/forgot', { email }).expect(202);
      const token = tokenFromEmail(app, email);
      await anonymous(app).post('/auth/password/reset', { token, password: OTHER_PASSWORD }).expect(204);
      const reuse = await anonymous(app).post('/auth/password/reset', {
        token,
        password: 'Third-Password-Value-9',
      });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('TOKEN_INVALID');

      outbox(app).clear();
      await anonymous(app).post('/auth/password/forgot', { email }).expect(202);
      const fresh = tokenFromEmail(app, email);
      await db.sql(
        `UPDATE auth_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE employee_id = $1 AND used_at IS NULL`,
        [id],
      );
      await anonymous(app)
        .post('/auth/password/reset', { token: fresh, password: STRONG_PASSWORD })
        .expect(400);
    });

    it('does not reveal whether an address exists, and sends nothing to unknown, pending or inactive accounts', async () => {
      const unknown = await anonymous(app).post('/auth/password/forgot', { email: 'ghost@example.test' });
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual({ accepted: true });

      await as(app, manager).post('/employees', employeeBody(33)).expect(201);
      await anonymous(app).post('/auth/password/forgot', { email: 'person33@example.test' }).expect(202);

      const { id } = await createActiveEmployee(app, manager, {
        ...employeeBody(34),
        email: 'gone@example.test',
      });
      await as(app, manager).post(`/employees/${id}/deactivate`, { reason: 'Left the company' }).expect(200);
      outbox(app).clear();
      await anonymous(app).post('/auth/password/forgot', { email: 'gone@example.test' }).expect(202);

      expect(outbox(app).lastTo('ghost@example.test')).toBeUndefined();
      expect(outbox(app).lastTo('person33@example.test')).toBeUndefined(); // pending must activate, not reset
      expect(outbox(app).lastTo('gone@example.test')).toBeUndefined();
    });

    it('lets a Manager initiate a reset for an ACTIVE employee but not for a pending one', async () => {
      const { id } = await createActiveEmployee(app, manager, {
        ...employeeBody(35),
        email: 'mgr-reset@example.test',
      });
      outbox(app).clear();
      const res = await as(app, manager).post(`/employees/${id}/password-reset`).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/token|password/i);
      expect(outbox(app).lastTo('mgr-reset@example.test')?.text).toContain('/account/reset-password?token=');

      const pending = await as(app, manager).post('/employees', employeeBody(36)).expect(201);
      const refused = await as(app, manager).post(`/employees/${pending.body.id}/password-reset`);
      expect([400, 409, 422]).toContain(refused.status);
    });
  });

  describe('Change password', () => {
    it('requires the current password, keeps this session, and revokes the others', async () => {
      const email = 'change@example.test';
      const { session } = await createActiveEmployee(app, manager, { ...employeeBody(37), email });
      const other = await signIn(app, email, STRONG_PASSWORD);
      await as(app, session)
        .post('/auth/password/change', { currentPassword: 'Wrong-Password-99x', newPassword: OTHER_PASSWORD })
        .expect(422);
      await as(app, session)
        .post('/auth/password/change', { currentPassword: STRONG_PASSWORD, newPassword: OTHER_PASSWORD })
        .expect(204);
      await as(app, session).get('/auth/me').expect(200);
      await as(app, other).get('/auth/me').expect(401);
      await signIn(app, email, OTHER_PASSWORD);
    });
  });

  describe('Secrets never reach the logs, the audit trail or the database in clear', () => {
    it('keeps passwords and tokens out of audit records, activity and stored columns', async () => {
      const email = 'hygiene@example.test';
      await as(app, manager)
        .post('/employees', { ...employeeBody(38), email, sendActivation: true })
        .expect(201);
      const token = tokenFromEmail(app, email);
      await anonymous(app).post('/auth/activation', { token, password: STRONG_PASSWORD }).expect(204);
      await signIn(app, email, STRONG_PASSWORD);
      await anonymous(app).post('/auth/login', { email, password: OTHER_PASSWORD });

      const dump = JSON.stringify(await db.sql(`SELECT * FROM audit_logs`));
      expect(dump).not.toContain(token);
      expect(dump).not.toContain(STRONG_PASSWORD);
      expect(dump).not.toContain(OTHER_PASSWORD);
      const tokens = JSON.stringify(await db.sql(`SELECT * FROM auth_tokens`));
      expect(tokens).not.toContain(token);
      const credentials = JSON.stringify(await db.sql(`SELECT * FROM credentials`));
      expect(credentials).not.toContain(STRONG_PASSWORD);
      // Sign-in outcomes are audited, though.
      const actions = (await db.sql<{ action: string }>(`SELECT DISTINCT action FROM audit_logs`)).map(
        (r) => r.action,
      );
      expect(actions).toEqual(expect.arrayContaining(['AUTH.LOGIN', 'AUTH.LOGIN_FAILED']));
    });
  });
});
