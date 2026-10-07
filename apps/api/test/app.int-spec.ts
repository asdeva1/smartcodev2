import { Body, Controller, Get, type INestApplication, Param, Post } from '@nestjs/common';
import { ROLES, auditErrorCountsSchema, type AuditErrorCounts } from '@smartcode/shared';
import request from 'supertest';
import { AuthenticatedOnly, RequirePermission } from '../src/core/auth/decorators';
import { ZodValidationPipe } from '../src/core/validation/zod-validation.pipe';
import { createTestApp, tokenFor } from './helpers';

/**
 * Test-only routes that exercise the guards exactly as Phase 9 will use them.
 * They exist only in this test module, never in the application.
 */
@Controller('probe')
class ProbeController {
  @Post('audits/:id/resolution')
  @RequirePermission('audit.resolveReview')
  resolve(@Param('id') id: string) {
    return { resolved: id };
  }

  @Post('charts/allocations')
  @RequirePermission('chart.allocate')
  allocate() {
    return { allocated: true };
  }

  @Get('me')
  @AuthenticatedOnly()
  me() {
    return { ok: true };
  }

  @Get('no-policy')
  noPolicy() {
    return { leaked: true };
  }

  @Post('validate')
  @AuthenticatedOnly()
  validate(@Body(new ZodValidationPipe(auditErrorCountsSchema)) body: AuditErrorCounts) {
    return body;
  }
}

describe('API foundation (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('GET /health/live → 200 without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', service: 'smartcode-api' });
    });

    it('GET /health/ready reports database state without connection details', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready');
      if (process.env.DATABASE_URL) {
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'ready', checks: { database: { status: 'up' } } });
      } else {
        expect(res.status).toBe(503);
        expect(res.body.checks.database.status).toBe('not_configured');
      }
      expect(JSON.stringify(res.body)).not.toMatch(/postgres(ql)?:\/\//);
    });

    it('health is not under the API prefix', async () => {
      await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
    });
  });

  it('GET /api/v1/meta is public and shows SPC unexpanded (D-16)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/meta').expect(200);
    expect(res.body).toMatchObject({ apiVersion: 'v1', terminology: { SPC: 'SPC' } });
  });

  describe('errors', () => {
    it('unknown routes return RFC 7807 problem+json with the request id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .set('x-request-id', 'req-test-0001')
        .expect(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['x-request-id']).toBe('req-test-0001');
      expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'req-test-0001' });
    });

    it('generates a request id when none (or an unsafe one) is supplied', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').set('x-request-id', '<script>');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('security headers & CORS', () => {
    it('sets helmet headers and hides the framework', async () => {
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows only configured origins, with credentials', async () => {
      const ok = await request(app.getHttpServer())
        .get('/api/v1/meta')
        .set('Origin', 'http://localhost:3000');
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(ok.headers['access-control-allow-credentials']).toBe('true');
      const bad = await request(app.getHttpServer())
        .get('/api/v1/meta')
        .set('Origin', 'https://evil.example');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('authentication & authorization', () => {
    const resolve = () => request(app.getHttpServer()).post('/api/v1/probe/audits/audit-1/resolution');

    it('401 without a token, or with an invalid one', async () => {
      const res = await resolve().expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      await resolve().set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('D-01: Team Lead resolving a review → 403', async () => {
      const res = await resolve()
        .set('Authorization', `Bearer ${await tokenFor(app, 'TEAM_LEAD')}`)
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it.each(ROLES.filter((r) => r !== 'MANAGER'))('D-01: %s resolving a review → 403', async (role) => {
      await resolve()
        .set('Authorization', `Bearer ${await tokenFor(app, role)}`)
        .expect(403);
    });

    it('D-01: Manager resolving a review → allowed', async () => {
      const res = await resolve()
        .set('Authorization', `Bearer ${await tokenFor(app, 'MANAGER')}`)
        .expect(201);
      expect(res.body).toEqual({ resolved: 'audit-1' });
    });

    it('accepts the access token from the httpOnly cookie', async () => {
      await resolve()
        .set('Cookie', `sc_at=${await tokenFor(app, 'MANAGER')}`)
        .expect(201);
    });

    it('D-03: only Manager allocates charts', async () => {
      for (const role of ROLES) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/probe/charts/allocations')
          .set('Authorization', `Bearer ${await tokenFor(app, role)}`);
        expect([role, res.status]).toEqual([role, role === 'MANAGER' ? 201 : 403]);
      }
    });

    it('@AuthenticatedOnly lets any signed-in role through', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/probe/me')
        .set('Authorization', `Bearer ${await tokenFor(app, 'CODER', 'vendor-a')}`)
        .expect(200);
    });

    it('deny by default: a route without an access policy is refused even for a Manager', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/no-policy')
        .set('Authorization', `Bearer ${await tokenFor(app, 'MANAGER')}`)
        .expect(403);
      expect(res.body).not.toHaveProperty('leaked');
    });
  });

  it('validation returns 422 with field errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/validate')
      .set('Authorization', `Bearer ${await tokenFor(app, 'AUDITOR')}`)
      .send({ auditErrors: -1 })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      'auditErrors',
      'errorExceptions',
    ]);
  });
});
