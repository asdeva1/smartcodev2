#!/usr/bin/env node
// Post-deploy smoke test. Read-only: no data is created. Usage:
//   SMOKE_API_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com pnpm smoke
// Exit code 1 when any check fails.
const api = (process.env.SMOKE_API_URL ?? '').replace(/\/$/, '');
// Health checks live at the root; every application route is under /api/v1.
const v1 = `${api}/api/v1`;
const web = (process.env.SMOKE_WEB_URL ?? '').replace(/\/$/, '');
if (!api) {
  console.error('Set SMOKE_API_URL (and optionally SMOKE_WEB_URL).');
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name} — ${e.message}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
const get = (url, init) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });

console.log(`Smoke test — API ${api}${web ? `, web ${web}` : ''}`);

await check('API is live (/health/live)', async () => {
  const r = await get(`${api}/health/live`);
  must(r.status === 200, `status ${r.status}`);
});
await check('API is ready: database reachable (/health/ready)', async () => {
  const r = await get(`${api}/health/ready`);
  must(r.status === 200, `status ${r.status}`);
});
await check('API sends security headers', async () => {
  const r = await get(`${api}/health/live`);
  must(r.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options');
  must(!r.headers.get('x-powered-by'), 'X-Powered-By is exposed');
});
await check('Protected routes refuse anonymous callers (401)', async () => {
  for (const path of [
    '/auth/me',
    '/projects',
    '/charts',
    '/dashboards/manager',
    '/audit-logs',
    '/approvals',
  ]) {
    const r = await get(`${v1}${path}`);
    must(r.status === 401, `${path} returned ${r.status}, expected 401`);
  }
});
await check('A forged token is refused (401)', async () => {
  const r = await get(`${v1}/auth/me`, { headers: { authorization: 'Bearer not.a.token' } });
  must(r.status === 401, `status ${r.status}`);
});
await check('Login rejects bad credentials without revealing which part is wrong', async () => {
  const r = await get(`${v1}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'smoke-nobody@example.invalid', password: 'wrong-password-123' }),
  });
  must([400, 401, 422].includes(r.status), `status ${r.status}`);
  const text = await r.text();
  must(!/stack|prisma|postgres/i.test(text), 'error body leaks internals');
});
await check('Unknown routes return a clean 404 (no stack trace)', async () => {
  const r = await get(`${api}/no-such-route-${Date.now()}`);
  must(r.status === 404, `status ${r.status}`);
  must(!/at .*\.(js|ts):\d+/.test(await r.text()), 'stack trace leaked');
});

if (web) {
  await check('Web app serves the sign-in page', async () => {
    const r = await get(`${web}/login`);
    must(r.status === 200, `status ${r.status}`);
  });
  await check('Web sends security headers', async () => {
    const r = await get(`${web}/login`);
    must(!!r.headers.get('strict-transport-security'), 'missing HSTS');
    must(r.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options');
    must(
      !!r.headers.get('x-frame-options') ||
        /frame-ancestors/.test(r.headers.get('content-security-policy') ?? ''),
      'clickjacking protection missing',
    );
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed ? `\n${failed} of ${results.length} checks FAILED` : `\nAll ${results.length} checks passed`,
);
process.exit(failed ? 1 : 0);
