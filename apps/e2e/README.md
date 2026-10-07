# @smartcode/e2e

Playwright end-to-end tests against real servers.

```bash
pnpm --filter @smartcode/e2e install:browsers     # once
pnpm build && E2E_START_SERVERS=1 pnpm test:e2e     # starts the built API + web
WEB_URL=https://app.staging.example.test API_URL=https://api.staging.example.test pnpm test:e2e
```

The mandatory business workflow from `docs/13-testing-strategy.md` (create employee → activate → … → re-audit → completion) is added module by module and must pass before any production deployment. Synthetic data only.

## Phase 3 lifecycle suite

`tests/auth-lifecycle.spec.ts` drives the full account lifecycle in a browser (Manager bootstrap → activation → sign-in → sign-out/session revocation → employee creation → activation → Login Name → CSV import → password reset). It reads activation and reset links from the API's file mail outbox (`E2E_MAIL_DIR`). Run it end to end, including database setup and both servers, with `apps/e2e/scripts/run-e2e.sh`.
