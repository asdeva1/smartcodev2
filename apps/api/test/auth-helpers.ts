import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuditLogService } from '../src/core/audit/audit-log.service';
import { AuthTokenService } from '../src/core/auth/auth-token.service';
import { bootstrapManager } from '../src/core/bootstrap/bootstrap-manager';
import { MAIL_TRANSPORT } from '../src/core/mail/mail.module';
import { MailService } from '../src/core/mail/mail.service';
import type { MemoryMailTransport } from '../src/core/mail/transports';
import { PrismaService } from '../src/core/prisma/prisma.service';

/** Synthetic only (D-05). Passwords satisfy the shared policy (≥12, not common, no personal data). */
export const STRONG_PASSWORD = 'Correct-Horse-Battery-7';
export const OTHER_PASSWORD = 'Another-Sturdy-Phrase-42';

export const outbox = (app: INestApplication): MemoryMailTransport =>
  app.get<MemoryMailTransport>(MAIL_TRANSPORT);

/** The single-use token embedded in the most recent email to `address`. */
export function tokenFromEmail(app: INestApplication, address: string): string {
  const message = outbox(app).lastTo(address);
  if (!message) throw new Error(`No email was sent to ${address}`);
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error('No token link in the email');
  return match[1] as string;
}

export interface Session {
  cookie: string;
  csrf: string;
}

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  const line = setCookie?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

export async function signIn(app: INestApplication, email: string, password: string): Promise<Session> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Sign-in failed (${res.status}): ${JSON.stringify(res.body)}`);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const at = cookieValue(setCookie, 'sc_at');
  const rt = cookieValue(setCookie, 'sc_rt');
  const csrf = cookieValue(setCookie, 'sc_csrf');
  if (!at || !rt || !csrf) throw new Error('Sign-in did not set all session cookies');
  return { cookie: `sc_at=${at}; sc_rt=${rt}; sc_csrf=${csrf}`, csrf };
}

/** A browser-like caller: cookies plus the double-submit CSRF header. */
export function as(app: INestApplication, session: Session) {
  const server = app.getHttpServer();
  const withAuth = (t: request.Test) => t.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
  return {
    get: (url: string) => withAuth(request(server).get(`/api/v1${url}`)),
    post: (url: string, body?: object) =>
      withAuth(
        request(server)
          .post(`/api/v1${url}`)
          .send(body ?? {}),
      ),
    patch: (url: string, body: object) => withAuth(request(server).patch(`/api/v1${url}`).send(body)),
    delete: (url: string) => withAuth(request(server).delete(`/api/v1${url}`)),
  };
}

export const anonymous = (app: INestApplication) => ({
  get: (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`),
  post: (url: string, body?: object) =>
    request(app.getHttpServer())
      .post(`/api/v1${url}`)
      .send(body ?? {}),
});

export function runBootstrap(
  app: INestApplication,
  input: { email: string; fullName: string; employeeCode: string },
) {
  return bootstrapManager(
    {
      prisma: app.get(PrismaService),
      tokens: app.get(AuthTokenService),
      audit: app.get(AuditLogService),
      mail: app.get(MailService),
    },
    input,
  );
}

/** Runs the real bootstrap, activates the Manager through the real activation endpoint, and signs in. */
export async function bootstrapAndSignInManager(app: INestApplication, email = 'manager@example.test') {
  const outcome = await runBootstrap(app, { email, fullName: 'Test Manager', employeeCode: 'MGR-0001' });
  await anonymous(app)
    .post('/auth/activation', { token: tokenFromEmail(app, email), password: STRONG_PASSWORD })
    .expect(204);
  return { outcome, session: await signIn(app, email, STRONG_PASSWORD) };
}

/** Manager creates the employee, the employee activates with their own password, then signs in. */
export async function createActiveEmployee(
  app: INestApplication,
  manager: Session,
  input: {
    employeeCode: string;
    fullName: string;
    email: string;
    role: string;
    vendorId?: string;
    teamId?: string;
  },
  password = STRONG_PASSWORD,
) {
  const created = await as(app, manager)
    .post('/employees', { ...input, sendActivation: true })
    .expect(201);
  await anonymous(app)
    .post('/auth/activation', { token: tokenFromEmail(app, input.email), password })
    .expect(204);
  return { id: created.body.id as string, session: await signIn(app, input.email, password) };
}
