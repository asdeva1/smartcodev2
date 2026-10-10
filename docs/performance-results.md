# Performance results — Phase 13

Test: `apps/api/test/performance.int-spec.ts` (runs in CI with the integration suite; `PERF_CHARTS` changes the volume).
Data: 30,000 charts across 5 projects, 30 coders, allocations, production entries and audits (synthetic), real PostgreSQL 16, full HTTP stack.
Each endpoint is called three times; the slowest call is recorded and must stay under its budget.

| Endpoint                                  | Slowest call | Budget  |
| ----------------------------------------- | ------------ | ------- |
| Chart repository, first page              | 88 ms        | 1000 ms |
| Chart repository, search by chart id      | 126 ms       | 1000 ms |
| Chart repository, status + project filter | 23 ms        | 1000 ms |
| Chart repository, deep page (100)         | 91 ms        | 1000 ms |
| Project chart list                        | 55 ms        | 1000 ms |
| Project live board                        | 448 ms       | 1500 ms |
| Manager dashboard                         | 1237 ms      | 2000 ms |
| Production report                         | 146 ms       | 2000 ms |
| Quality report                            | 31 ms        | 2000 ms |
| Report download (Excel)                   | 169 ms       | 4000 ms |
| Coder dashboard                           | 17 ms        | 1000 ms |
| Coder work list                           | 14 ms        | 1000 ms |
| Activity feed                             | 12 ms        | 1000 ms |
| Audit log                                 | 12 ms        | 1000 ms |

Measured on a shared development container, so production hardware should be faster. All endpoints are within budget; no index changes were needed.

## Watch list

- **Manager dashboard (1.2 s).** It reads the current month's production entries and audits and totals them in the application. That is fine for the expected monthly volume, but the cost grows with charts per month. If the live volume is several times larger, move the monthly totals into one SQL aggregate (`GROUP BY coder`) — the service is already isolated in `manager-dashboard.service.ts`.
- **Load test.** This is a single-user latency test. A concurrent load test (for example k6 with 50 users) should be run against staging once the production-sized database is available; the smoke script is the starting point.
