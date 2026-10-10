#!/usr/bin/env node
// Concurrent load test for read endpoints. Not for production data volumes you cannot afford to slow down.
//   $env:LOADTEST_API_URL = "https://api.example.com"
//   $env:LOADTEST_TOKEN   = "<access token of a Manager, from a browser session; never share it>"
//   node scripts/loadtest.mjs [--users 25] [--seconds 30]
// Reports requests, errors and p50/p95/max latency per endpoint, and exits 1 when a p95 budget is exceeded.
const api = (process.env.LOADTEST_API_URL ?? '').replace(/\/$/, '');
const token = process.env.LOADTEST_TOKEN;
if (!api || !token) {
  console.error('Set LOADTEST_API_URL and LOADTEST_TOKEN.');
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const users = arg('users', 25);
const seconds = arg('seconds', 30);

// path, p95 budget in ms (docs/performance-results.md)
const ENDPOINTS = [
  ['/charts', 1500],
  ['/charts?status=COMPLETED', 1500],
  ['/dashboards/manager', 3000],
  ['/projects', 1500],
  ['/approvals', 1500],
  ['/activity', 1500],
  ['/audit-logs', 1500],
  ['/visits', 1500],
];
const stats = new Map(ENDPOINTS.map(([p]) => [p, { ms: [], errors: 0 }]));
const stopAt = Date.now() + seconds * 1000;

async function worker(id) {
  let i = id;
  while (Date.now() < stopAt) {
    const [path] = ENDPOINTS[i++ % ENDPOINTS.length];
    const s = stats.get(path);
    const t0 = performance.now();
    try {
      const r = await fetch(`${api}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      await r.arrayBuffer();
      if (r.status !== 200) s.errors++;
      else s.ms.push(performance.now() - t0);
    } catch {
      s.errors++;
    }
  }
}

console.log(`Load test: ${users} users for ${seconds}s against ${api}`);
await Promise.all(Array.from({ length: users }, (_, n) => worker(n)));

const q = (a, p) => (a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))]) : 0);
let failed = false;
console.log(
  '\nendpoint'.padEnd(34) +
    'ok'.padStart(7) +
    'errors'.padStart(8) +
    'p50'.padStart(8) +
    'p95'.padStart(8) +
    'max'.padStart(8),
);
for (const [path, budget] of ENDPOINTS) {
  const { ms, errors } = stats.get(path);
  ms.sort((a, b) => a - b);
  const p95 = q(ms, 0.95);
  const bad = errors > 0 || p95 > budget;
  failed ||= bad;
  console.log(
    path.padEnd(34) +
      String(ms.length).padStart(7) +
      String(errors).padStart(8) +
      String(q(ms, 0.5)).padStart(8) +
      String(p95).padStart(8) +
      String(q(ms, 1)).padStart(8) +
      (bad ? `   <-- over budget (${budget} ms) or errors` : ''),
  );
}
process.exit(failed ? 1 : 0);
