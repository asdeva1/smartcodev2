# 05 — API Specification

Status: **Approved (Phase 0)** — final decisions applied. Full request/response schemas are generated as OpenAPI from the NestJS DTOs during implementation (`/api/docs` in non-production environments). This document fixes conventions and the endpoint inventory.

## 1. Conventions

| Topic                      | Convention                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Base URL                   | `${API_URL}/api/v1` — configured per environment (D-06), never hard-coded                                 |
| Format                     | JSON; `Content-Type: application/json`; dates ISO-8601 UTC                                                |
| Auth (web)                 | `httpOnly` cookies set by the API (`sc_at`, `sc_rt`) + CSRF header `X-CSRF-Token` on unsafe methods       |
| Auth (mobile V2 / scripts) | `Authorization: Bearer <access token>`                                                                    |
| Pagination                 | `?page=1&pageSize=25` (max 100) → `{ items, page, pageSize, total }`; cursor variant for very large lists |
| Sorting / filtering        | `?sort=createdAt:desc&status=ACTIVE&q=search` (allow-listed fields per endpoint)                          |
| Errors                     | RFC 7807: `{ type, title, status, code, detail, requestId, errors?: [{ field, message }] }`               |
| Validation                 | `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) + shared zod schemas                        |
| Idempotency                | `Idempotency-Key` header accepted on commit endpoints (CSV commit, bulk allocation)                       |
| Concurrency                | Mutable resources carry `version`; updates send `If-Match` → `412` on conflict                            |
| Not found vs forbidden     | Out-of-scope records (e.g. another vendor's) return `404`                                                 |
| Rate limits                | Global per user/IP; strict on `/auth/*` (e.g. 5 login attempts / 15 min per email+IP)                     |
| Versioning                 | URL major version (`/v1`); additive changes only within a version                                         |

## 2. Endpoint inventory

### Health & realtime

| Method | Path            | Notes                                               |
| ------ | --------------- | --------------------------------------------------- |
| GET    | `/health/live`  | Process up (no auth)                                |
| GET    | `/health/ready` | DB, Redis, migrations (no auth, no details in prod) |
| GET    | `/events`       | SSE stream of scoped invalidation events            |

### Auth (module 1, 4, 5)

| Method     | Path                      | Notes                                      |
| ---------- | ------------------------- | ------------------------------------------ |
| POST       | `/auth/login`             | email, password                            |
| POST       | `/auth/logout`            | revokes current session                    |
| POST       | `/auth/refresh`           | rotates refresh token                      |
| GET        | `/auth/me`                | principal, permissions, branding           |
| GET        | `/auth/activation/:token` | validate token (no side effects)           |
| POST       | `/auth/activation`        | token + password → ACTIVE                  |
| POST       | `/auth/password/forgot`   | always `202` (no account enumeration)      |
| POST       | `/auth/password/reset`    | token + new password; revokes all sessions |
| POST       | `/auth/password/change`   | logged-in change                           |
| GET/DELETE | `/auth/sessions[/:id]`    | list / revoke own sessions                 |

### Employees (3, 4, 5)

| Method    | Path                                        | Permission                           |
| --------- | ------------------------------------------- | ------------------------------------ |
| GET       | `/employees`                                | `employee.read` (scoped)             |
| POST      | `/employees`                                | `employee.create`                    |
| GET/PATCH | `/employees/:id`                            | read / update                        |
| POST      | `/employees/:id/activation-email`           | `employee.sendActivation`            |
| POST      | `/employees/:id/password-reset`             | `employee.triggerPasswordReset`      |
| POST      | `/employees/:id/deactivate` · `/reactivate` | `employee.deactivate`                |
| GET       | `/employees/export`                         | CSV, scoped                          |
| POST      | `/imports/employees` …                      | CSV framework (optional bulk create) |

### Organization, vendors, teams (2, 7, 8)

`GET/PATCH /organization` · `GET/POST /vendors` · `GET/PATCH /vendors/:id` · `POST /vendors/:id/admin-account` · `GET/POST /teams` · `GET/PATCH /teams/:id` · `POST /teams/:id/members` · `DELETE /teams/:id/members/:employeeId`

### Clients & projects (9, 10)

`GET/POST /clients` · `GET/PATCH /clients/:id` · `GET/POST /projects` · `GET/PATCH /projects/:id` · `GET/POST /projects/:id/assignments` · `DELETE /projects/:id/assignments/:assignmentId`

### Charts (11, 12)

| Method | Path                                                   | Notes                                                                                |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| GET    | `/projects/:id/charts`                                 | repository + tracking columns, filters by status/login name/date                     |
| GET    | `/charts/:id`                                          | detail + timeline (status events, assignments, production versions, audits, reworks) |
| GET    | `/charts/lookup?chartRef=`                             | find by Chart ID (scoped)                                                            |
| —      | `/imports/charts` (CSV framework, `projectId` in body) |                                                                                      |

### Login names & allocation (6, 13)

| Method | Path                                      | Notes                                                                  |
| ------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/login-names`                            | with current holder                                                    |
| POST   | `/login-names/assignments`                | manual: `{ loginName, employeeEmail }` — Manager                       |
| POST   | `/login-names/:id/release`                | end assignment — Manager                                               |
| —      | `/imports/login-names`                    | CSV: Employee Email, Login Name                                        |
| POST   | `/allocations`                            | manual: `{ chartIds[], loginName }` — Manager                          |
| POST   | `/allocations/automatic/preview`          | `{ projectId, coderIds[], chartIds?/count }` → balanced plan — Manager |
| POST   | `/allocations/automatic/commit`           | commits the previewed plan (same engine) — Manager                     |
| POST   | `/allocations/reallocate` · `/deallocate` | reason required — Manager                                              |
| —      | `/imports/allocations`                    | CSV: Chart ID, Login Name                                              |

### CSV framework (shared)

`POST /imports/:type` (create batch, returns presigned S3 upload URL) · `POST /imports/:batchId/process` (parse + validate + duplicate detection) · `GET /imports/:batchId` (summary counts) · `GET /imports/:batchId/rows?filter=invalid` (preview) · `GET /imports/:batchId/error-report` (CSV download) · `POST /imports/:batchId/commit` (confirm) · `POST /imports/:batchId/cancel`

### Production (14, 15, 29)

`GET /me/charts` (my queue) · `POST /charts/:id/production/start` · `PUT /charts/:id/production/draft` · `POST /charts/:id/production/submit` · `POST /charts/:id/production/pause` · `GET /productivity?groupBy=coder|team|project|vendor&from&to`

### Audit, review, rework, re-audit (16–19)

| Method | Path                                         | Permission                                                                       |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/audits/queue?type=audit\|re-audit`         | `audit.perform`                                                                  |
| POST   | `/charts/:id/audits`                         | start audit — Auditor                                                            |
| PUT    | `/audits/:id`                                | save draft                                                                       |
| POST   | `/audits/:id/submit`                         | result PASS / REVIEW_REQUIRED                                                    |
| GET    | `/audits/review-queue`                       | Manager                                                                          |
| POST   | `/audits/:id/resolution`                     | **`audit.resolveReview` — MANAGER ONLY** `{ decision: APPROVE\|REJECT, reason }` |
| GET    | `/reworks` · `/reworks/:id`                  | scoped                                                                           |
| POST   | `/reworks/:id/start` · `/reworks/:id/submit` | Coder (assignee)                                                                 |
| POST   | `/reworks/:id/reassign`                      | Manager                                                                          |

### Platform (20–24, 33, 34)

`GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET/POST /approvals` · `POST /approvals/:id/decision` · `GET /activity` · `GET /audit-logs` · `GET /dashboards/manager?vendorId=` · `GET /dashboards/vendor` · `GET /dashboards/team-lead` · `GET /reports/:type` · `POST /reports/:type/export` (async → file) · `GET /files/:id/download` (presigned) · `GET/PATCH /settings` · `GET /admin/system` (queues, email status, batches)

## 3. Example: Manager resolves a review

```http
POST /api/v1/audits/0192f…/resolution
Content-Type: application/json
X-CSRF-Token: …

{ "decision": "REJECT", "reason": "ICD-10 sequencing error on DOS 2" }
```

`200` → `{ audit: { status: "REJECTED" }, chart: { status: "REWORK" }, rework: { id, assigneeId, cycle: 1 } }` (APPROVE → `{ audit: { status: "APPROVED" }, chart: { status: "COMPLETED" } }`)

Team Lead calling the same endpoint → `403 { code: "FORBIDDEN", detail: "Only a Manager can resolve a review" }`.
Second resolution of the same audit → `409 { code: "AUDIT_ALREADY_RESOLVED" }`.

## 4. Phase 3 — implemented endpoints (`/api/v1`)

| Method & path                                        | Permission                      | Notes                                                                                  |
| ---------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /auth/login`                                   | public                          | email + password; sets `sc_at`, `sc_rt`, `sc_csrf`; 200 profile                        |
| `POST /auth/refresh`                                 | public (refresh cookie)         | rotates the refresh token; reuse revokes the family                                    |
| `POST /auth/logout`                                  | public                          | revokes the session; always clears cookies                                             |
| `GET /auth/me`                                       | authenticated                   | `{employee, permissions}`                                                              |
| `POST /auth/tokens/check`                            | public                          | `{type, token}` → `{valid, fullName?}`                                                 |
| `POST /auth/activation`                              | public                          | `{token, password}` → 204; PENDING → ACTIVE                                            |
| `POST /auth/password/forgot`                         | public                          | always 202 `{accepted:true}`                                                           |
| `POST /auth/password/reset`                          | public                          | `{token, password}` → 204; revokes all sessions                                        |
| `POST /auth/password/change`                         | authenticated                   | `{currentPassword, newPassword}`; keeps this session                                   |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id`    | authenticated                   | own sessions only                                                                      |
| `GET /employees`                                     | `employee.read`                 | filters role, status, vendorId, teamId, projectId, loginName; search `q`; sort; paging |
| `GET /employees/options`                             | `employee.read`                 | vendors/teams/projects in the caller’s scope (empty for SELF/TEAM readers)             |
| `POST /employees`                                    | `employee.create`               | creates PENDING_ACTIVATION; `sendActivation` optional                                  |
| `GET /employees/:id`, `PATCH /employees/:id`         | `employee.read` / `.update`     | out-of-scope → 404                                                                     |
| `POST /employees/:id/activation-email`               | `employee.sendActivation`       | PENDING only; revokes the previous link                                                |
| `POST /employees/activation-emails`                  | `employee.sendActivation`       | bulk; reports sent / failed / skipped                                                  |
| `POST /employees/:id/password-reset`                 | `employee.triggerPasswordReset` | ACTIVE only; never for PENDING                                                         |
| `POST /employees/:id/deactivate`, `/reactivate`      | `employee.deactivate`           |                                                                                        |
| `POST /employees/:id/role`                           | `employee.changeRole`           | Manager only                                                                           |
| `POST /employees/import/preview`, `/import/commit`   | `employee.create`               | CSV text in `{csv, mode}`                                                              |
| `GET /login-names`, `GET /employees/:id/login-names` | `loginName.read`                | list / history                                                                         |
| `POST /login-names/assignments`                      | `loginName.assign`              | Manager only; assign or change                                                         |
| `POST /login-names/release`                          | `loginName.assign`              | Manager only                                                                           |
| `POST /login-names/import/preview`, `/import/commit` | `loginName.assign`              | Manager only                                                                           |

Unsafe methods authenticated by cookie must send `X-CSRF-Token` equal to the `sc_csrf` cookie and an allowed `Origin`; otherwise 403 `CSRF_FAILED`.
