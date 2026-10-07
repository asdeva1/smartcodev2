# @smartcode/e2e

Playwright end-to-end tests against real servers.

```bash
pnpm --filter @smartcode/e2e install:browsers     # once
pnpm build && E2E_START_SERVERS=1 pnpm test:e2e     # starts the built API + web
WEB_URL=https://app.staging.example.test API_URL=https://api.staging.example.test pnpm test:e2e
```

The mandatory business workflow from `docs/13-testing-strategy.md` (create employee → activate → … → re-audit → completion) is added module by module and must pass before any production deployment. Synthetic data only.
