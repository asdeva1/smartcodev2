# Go-live checklist

Tick every line before announcing production. Owner in brackets.

## Quality gates

- [ ] CI green on the release commit: lint, typecheck, unit and integration tests, build, CDK synth (dev)
- [ ] Mandatory end-to-end workflow green (`full-workflow.int-spec.ts` and the Playwright suite) (dev)
- [ ] Performance test within budget (`performance.int-spec.ts`, `docs/performance-results.md`) (dev)
- [ ] Security workflow green: dependency audit, secret scan, container scan, CodeQL (dev)
- [ ] Open items in `docs/security-review.md` §3 decided or accepted in writing (owner)
- [ ] Same image tag deployed to staging and passed `pnpm smoke` plus a manual run-through of every role's screens (QA)

## Infrastructure

- [ ] Production account, region and domains agreed ([provision-production.md](provision-production.md)) (owner)
- [ ] All five stacks deployed; deletion protection and Multi-AZ confirmed on the database (ops)
- [ ] Secrets populated; database users separated (API cannot change schema) (ops)
- [ ] SES out of sandbox; test activation email received (ops)
- [ ] WAF active; rate rule on authentication endpoints (ops)
- [ ] Alarms subscribed to the on-call email; a test alarm delivered (ops)
- [ ] Backup restore tested and timed ([backup-restore.md](backup-restore.md)) (ops)

## Launch

- [ ] Manager bootstrapped ([bootstrap-manager.md](bootstrap-manager.md)); second Manager created (Manager)
- [ ] Vendors, teams, clients, projects, employees loaded; login names assigned (Manager / HR)
- [ ] Each role signs in once and sees its own home screen (QA)
- [ ] `pnpm smoke` green against production (dev)
- [ ] Support contact, incident process ([incident-response.md](incident-response.md)) and rollback steps shared with the team (owner)

## First week

- [ ] Daily check of alarms, error rate and audit log
- [ ] GuardDuty / Security Hub findings reviewed
- [ ] Feedback collected; first patch release uses [deploy.md](deploy.md)
