# 16 — Security Architecture

Status: **Approved (Phase 0)** — final decisions applied

| Requirement | Implementation |
|---|---|
| RBAC | Permission matrix in `packages/shared/rbac`; `@RequirePermission` on every route; deny by default (CI check) |
| Backend authorization | Guards + service-level checks; UI hiding is cosmetic only |
| Vendor isolation | Scope applied in repository layer from the principal; cross-vendor IDs → 404; dedicated test suite |
| Project access control | Project-scoped roles see only assigned projects (`project_assignments`) |
| Password hashing | Argon2id |
| Secure tokens | 256-bit random; SHA-256 hashed at rest; single-use; expiring; revoked on re-issue |
| Sessions | Short-lived ES256 access JWT + rotating refresh tokens with reuse detection; immediate revocation via session/status check |
| Rate limiting | NestJS throttler (Redis store) + WAF rate rules; strict limits on auth endpoints; account lockout |
| Input validation | Global `ValidationPipe` (whitelist, forbid unknown) + shared zod schemas; CSV formula-injection neutralisation |
| SQL injection | Prisma parameterised queries; raw SQL only via tagged templates (`$queryRaw\`…\``), never string concatenation (lint rule) |
| CORS | Explicit origin allow-list from env; credentials only for allowed origins |
| Security headers | Helmet on API; CSP, HSTS, X-Frame-Options/frame-ancestors, Referrer-Policy, Permissions-Policy on web |
| CSRF | SameSite=Lax cookies + double-submit token + Origin check |
| Audit logging | Append-only `audit_logs` (DB trigger + role grants) for auth events, data changes, allocations, resolutions, exports |
| Sensitive data | Passwords/tokens never logged or returned; log redaction list; PII minimised in logs; encrypted at rest (RDS, S3, Redis) and in transit (TLS everywhere) |
| Files | Private S3; short-lived presigned URLs; content-type + size limits; access checked by API before issuing URLs |
| Secrets | AWS Secrets Manager (API) and Vercel env (web, non-secret); gitleaks pre-commit + CI; nothing in images |
| Dependencies / images | Dependabot, `pnpm audit`, container image scanning (ECR), pinned base images |
| Infrastructure | Private subnets for compute and data; least-privilege IAM per task; GitHub OIDC (no static AWS keys); separate AWS accounts per environment |
| Backups / DR | RDS PITR + automated snapshots; S3 versioning on reports; documented restore runbook tested in Phase 13 |

**Healthcare data (D-05 — final):** SmartCode is designed as a healthcare application that may handle identifiable US medical information. Controls: encryption in transit and at rest, RBAC, least privilege, append-only audit logging, private encrypted object storage, Secrets Manager, protected backups, access monitoring (CloudTrail + CloudWatch alarms), retention controls (S3 lifecycle, import-row purge). Development and testing use **synthetic data only** — never real patient data in Git, code, fixtures, screenshots, logs, sample CSVs or development databases. The software does **not** claim "HIPAA compliant"; the production AWS environment (BAA, HIPAA-eligible services) and the Vercel plan (the web tier must not receive PHI beyond what the browser renders, or must be covered by an appropriate agreement) must be reviewed before real PHI is introduced.
