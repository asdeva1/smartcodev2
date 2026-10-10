import type { NextConfig } from 'next';

const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin;
  } catch {
    return 'http://localhost:4000';
  }
})();
const isDev = process.env.NODE_ENV !== 'production';

/** The call service the browser may connect to (LiveKit Cloud, or the address in NEXT_PUBLIC_CALLS_URL). */
const callsOrigins = (() => {
  const origins = ['https://*.livekit.cloud', 'wss://*.livekit.cloud'];
  const configured = process.env.NEXT_PUBLIC_CALLS_URL?.trim();
  if (configured) {
    try {
      const u = new URL(configured);
      const host = u.host;
      origins.push(`https://${host}`, `wss://${host}`);
    } catch {
      /* an invalid address adds nothing */
    }
  }
  return origins.join(' ');
})();

/** Content Security Policy: only our own origin plus the configured API (D-06: no hard-coded domains). */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${callsOrigins}${isDev ? ' ws:' : ''}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()',
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@smartcode/shared', '@smartcode/brand'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  /**
   * Optional same-origin API proxy (deployment configuration, no business logic). When API_PROXY_TARGET is set the
   * browser talks only to this site and Next.js forwards /api/v1/* to the API. Used while the web app and the API
   * have no common parent domain, so the session cookies stay first-party. Unset locally and in production.
   */
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, '');
    return target ? [{ source: '/api/v1/:path*', destination: `${target}/api/v1/:path*` }] : [];
  },
};

export default config;
