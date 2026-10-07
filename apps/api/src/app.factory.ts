import { type INestApplication, RequestMethod } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfig } from './core/config/app-config.service';
import { REQUEST_ID_HEADER } from './core/logging/logging.module';

export const API_PREFIX = 'api/v1';

/** Applies HTTP-level configuration shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(AppConfig);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.use(
    helmet({
      // The API serves JSON only.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isDeployed ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-csrf-token',
      'idempotency-key',
      'if-match',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });
  const http = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (k: string, v: unknown) => void;
  };
  http.disable?.('x-powered-by');
  // Behind the AWS ALB — trust exactly one proxy hop for client IPs (rate limiting, audit logs).
  http.set?.('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
