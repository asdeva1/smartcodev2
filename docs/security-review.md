# Security review — Phase 13

Scope: SmartCode Enterprise V2 API (NestJS), web app (Next.js), database (PostgreSQL), infrastructure (AWS CDK).
Method: OWASP ASVS 4.0 level 2 chapters mapped to evidence in the code and tests, plus automated scanning in CI.
Status values: **Met** (enforced and tested), **Met (config)** (enforced by infrastructure configuration), **Open** (needs action before go-live).

## 1. Automated checks

| Check                                       | Where                                    | Result                                                                                                              |
| ------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Dependency audit (`pnpm audit --prod`)      | CI job `security`, weekly schedule       | 0 known vulnerabilities after the overrides in the root `package.json` (uuid, mysql2, deepmerge-ts were transitive) |
| Secret scan (gitleaks)                      | CI job `security`                        | Runs on every pull request                                                                                          |
| Repository secret check                     | `pnpm secrets:check`                     | In CI `verify` job                                                                                                  |
| Container image scan (Trivy, HIGH/CRITICAL) | CI job `security`                        | Fails the build on fixable findings                                                                                 |
| Static analysis (CodeQL)                    | `.github/workflows/codeql.yml`           | JavaScript/TypeScript, weekly + every PR                                                                            |
| Route policy test                           | `apps/api/test/route-policy.int-spec.ts` | Every route must declare a permission or `@AuthenticatedOnly`                                                       |
| Live smoke checks                           | `pnpm smoke`                             | Headers, anonymous 401s, no stack traces                                                                            |

## 2. ASVS checklist

### V2 Authentication

| Requirement                                   | Status | Evidence                                                                                                        |
| --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| Passwords hashed with a memory-hard algorithm | Met    | Argon2id, `core/auth/password.service.ts`                                                                       |
| Brute-force protection                        | Met    | Failed-attempt counter and timed lockout, `modules/auth/auth.service.ts`; request throttling in `app.module.ts` |
| No account enumeration on login               | Met    | Same error for unknown user and wrong password; smoke check                                                     |
| Password change revokes sessions              | Met    | `auth-lifecycle.int-spec.ts`                                                                                    |
| Multi-factor authentication                   | Open   | Not in V2 scope; recommend for Manager accounts before wider rollout                                            |

### V3 Session management

| Requirement                                  | Status | Evidence                                                     |
| -------------------------------------------- | ------ | ------------------------------------------------------------ |
| Tokens in httpOnly, Secure, SameSite cookies | Met    | `core/auth/cookies.spec.ts`                                  |
| Refresh token opaque, rotated, stored hashed | Met    | `core/auth/session.service.ts`, `auth-lifecycle.int-spec.ts` |
| CSRF protection for cookie sessions          | Met    | CSRF guard, `core/auth/csrf.guard.ts`                        |
| Logout invalidates the session server-side   | Met    | `auth-lifecycle.int-spec.ts`                                 |

### V4 Access control

| Requirement                                    | Status | Evidence                                                                                                               |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Deny by default                                | Met    | Global guard; `route-policy.int-spec.ts`                                                                               |
| Server-side role and scope enforcement         | Met    | `RBAC_MATRIX`, `scopeFor`, `projectScopeWhere`; every module has role/scope integration tests                          |
| Cross-tenant isolation (vendor, team, project) | Met    | `full-workflow.int-spec.ts` step 7 (Vendor B sees nothing of Vendor A); out-of-scope ids return 404                    |
| Separation of duties                           | Met    | Requester cannot resolve own approval (database trigger); Chart Allocation Manager-only; only Manager resolves reviews |
| Audit trail cannot be altered                  | Met    | `audit_logs` append-only trigger; `db:verify`                                                                          |

### V5 Validation, sanitisation, encoding

| Requirement                      | Status | Evidence                                                               |
| -------------------------------- | ------ | ---------------------------------------------------------------------- |
| Schema validation on every input | Met    | Zod pipes on all bodies, queries and ids (`UuidParamPipe`)             |
| SQL injection                    | Met    | Prisma parameterised queries; the few raw queries use bound parameters |
| CSV formula injection in exports | Met    | Export service escapes leading `= + - @` cells                         |
| Output encoding / XSS            | Met    | React escaping; strict CSP in `apps/web/next.config.ts`                |
| File upload limits               | Met    | CSV payload size limit in `csvUploadSchema`                            |

### V7 Error handling and logging

| Requirement                               | Status | Evidence                                                                            |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| No stack traces or internals in responses | Met    | Problem+JSON error responses; smoke check                                           |
| Security events logged                    | Met    | Auth failures, lockouts, approvals, deallocations in audit log                      |
| No secrets or PHI in logs                 | Met    | Audit-log redaction (`core/audit/redact.spec.ts`); test charts are synthetic (D-05) |

### V8 Data protection

| Requirement                       | Status       | Evidence                                                          |
| --------------------------------- | ------------ | ----------------------------------------------------------------- |
| Encryption in transit             | Met (config) | HTTPS-only API Gateway/ALB; HSTS on web                           |
| Encryption at rest                | Met (config) | RDS and S3 encrypted with KMS (CDK `data-stack`, `storage-stack`) |
| Backups and restore               | Met (config) | RDS automated backups (35 days in production); restore runbook    |
| Chart content (PHI) is not stored | Met          | The system stores chart references and counts only (docs/01)      |

### V9 Communications and V14 Configuration

| Requirement                                                 | Status       | Evidence                                                                         |
| ----------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Security headers (CSP, HSTS, nosniff, frame deny, referrer) | Met          | `next.config.ts`, Helmet in `app.factory.ts`; smoke check                        |
| No framework version disclosure                             | Met          | `poweredByHeader: false`; Helmet                                                 |
| Least-privilege infrastructure                              | Met (config) | Task role limited to its secrets, bucket and queue; private subnets for database |
| Secrets not in source                                       | Met          | Secrets Manager; gitleaks + `secrets:check`                                      |
| Dependencies kept current                                   | Met          | Audit job + Dependabot                                                           |

## 3. Open items before go-live

1. Independent penetration test of the production-like environment (cannot be done from the build environment).
2. Decide on multi-factor authentication for Manager and HR accounts.
3. Confirm the production AWS region meets the client's data-residency requirement.
4. Enable AWS WAF managed rule groups on the production edge (rate-based rule for the login route).
5. Review GuardDuty and Security Hub findings after the first week in production.
