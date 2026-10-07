# 03 — RBAC Matrix

Status: **Approved (Phase 0)** — final decisions applied

## 1. Roles

| Role                              | Level                                           | Description                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MANAGER`                         | Organization                                    | Full operational authority across the organization (all projects, all vendors). **Not** project-restricted. Sole authority for chart allocation, login-name assignment and REVIEW_REQUIRED audit resolution. |
| `HR`                              | Organization                                    | People data, HR integration, visitor management. No chart/production/audit data.                                                                                                                             |
| `GROUP_COACH` (Group Coach / SME) | Organization, scoped to assigned projects/teams | Quality coaching: reads production and audit results of assigned projects, adds coaching feedback. **No allocation, no audit resolution.** (D-07)                                                            |
| `TEAM_LEAD`                       | Team                                            | Monitors own team(s): members, production, audit results, rework progress. **Cannot allocate charts. Cannot resolve or approve/reject audits.**                                                              |
| `AUDITOR`                         | Project                                         | Audits coded charts of assigned projects; performs re-audits.                                                                                                                                                |
| `CODER`                           | Self                                            | Codes charts allocated to them (through their login name); performs rework.                                                                                                                                  |
| `VENDOR_ADMIN`                    | Vendor                                          | The vendor account created by the Manager. Manages own vendor's employees (TL/Auditor/Coder) and teams; sees only own-vendor data.                                                                           |

Vendor staff use the normal `TEAM_LEAD` / `AUDITOR` / `CODER` roles with `vendor_id` set. Their scope is **intersected** with their vendor: a vendor Team Lead sees only their own team inside their own vendor.

## 2. Scope legend

`O` organization-wide · `V` own vendor only · `T` own team(s) · `P` assigned projects · `S` self only · `—` denied

Scopes are enforced in the API's repository layer from the authenticated principal — **never** from query parameters sent by the browser.

## 3. Permission matrix

| Permission                                                            | MANAGER                             | HR            | GROUP_COACH    | TEAM_LEAD                 | AUDITOR                | CODER          | VENDOR_ADMIN           |
| --------------------------------------------------------------------- | ----------------------------------- | ------------- | -------------- | ------------------------- | ---------------------- | -------------- | ---------------------- |
| **Employees**                                                         |                                     |               |                |                           |                        |                |                        |
| `employee.read`                                                       | O                                   | O             | P              | T                         | —                      | S              | V                      |
| `employee.create` (Manager/TL/Auditor/Coder/HR/GC)                    | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `employee.create` (vendor TL/Auditor/Coder)                           | O                                   | —             | —              | —                         | —                      | —              | V                      |
| `employee.update`                                                     | O                                   | O (HR fields) | —              | —                         | —                      | S (profile)    | V                      |
| `employee.deactivate`                                                 | O                                   | —             | —              | —                         | —                      | —              | V                      |
| `employee.sendActivation`                                             | O                                   | —             | —              | —                         | —                      | —              | V                      |
| `employee.triggerPasswordReset`                                       | O                                   | —             | —              | —                         | —                      | —              | V                      |
| **Login names**                                                       |                                     |               |                |                           |                        |                |                        |
| `loginName.read`                                                      | O                                   | —             | P              | T                         | P                      | S              | V (read)               |
| `loginName.assign` / bulk CSV                                         | O                                   | —             | —              | —                         | —                      | —              | —                      |
| **Vendors & teams**                                                   |                                     |               |                |                           |                        |                |                        |
| `vendor.manage` (create vendor + vendor account)                      | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `vendor.read`                                                         | O                                   | —             | —              | —                         | —                      | —              | own                    |
| `team.manage`                                                         | O                                   | —             | —              | —                         | —                      | —              | V                      |
| `team.read`                                                           | O                                   | O             | P              | T                         | —                      | own            | V                      |
| **Clients & projects**                                                |                                     |               |                |                           |                        |                |                        |
| `client.manage` / `project.manage`                                    | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `project.read`                                                        | O                                   | —             | P              | P                         | P                      | P              | V (assigned to vendor) |
| `project.assignStaff` (incl. TL/Auditor to vendor projects)           | O                                   | —             | —              | —                         | —                      | —              | —                      |
| **Charts**                                                            |                                     |               |                |                           |                        |                |                        |
| `chart.import` (CSV)                                                  | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `chart.read` / tracking                                               | O                                   | —             | P              | T                         | P (auditable)          | S              | V                      |
| `chart.allocate` / reallocate / deallocate (manual + CSV + automatic) | **O**                               | —             | —              | —                         | —                      | —              | —                      |
| **Production**                                                        |                                     |               |                |                           |                        |                |                        |
| `production.submit`                                                   | —                                   | —             | —              | —                         | —                      | S              | —                      |
| `production.read`                                                     | O                                   | —             | P              | T                         | P                      | S              | V                      |
| **Audit**                                                             |                                     |               |                |                           |                        |                |                        |
| `audit.perform` / `audit.reAudit`                                     | —                                   | —             | —              | —                         | P                      | —              | —                      |
| `audit.read`                                                          | O                                   | —             | P              | T                         | P (own + project)      | S (own charts) | V                      |
| `audit.resolveReview` (REVIEW_REQUIRED → APPROVE/REJECT)              | **O — Manager only**                | —             | **— (denied)** | **— (explicitly denied)** | — (incl. own decision) | —              | —                      |
| **Rework**                                                            |                                     |               |                |                           |                        |                |                        |
| `rework.read`                                                         | O                                   | —             | P              | T                         | P                      | S              | V                      |
| `rework.perform`                                                      | —                                   | —             | —              | —                         | —                      | S              | —                      |
| **Dashboards & reports**                                              |                                     |               |                |                           |                        |                |                        |
| Manager dashboard / org reports (in-house + vendor)                   | O                                   | —             | —              | —                         | —                      | —              | —                      |
| Vendor dashboard / vendor reports                                     | O (any vendor)                      | —             | —              | —                         | —                      | —              | V                      |
| Team / project reports                                                | O                                   | —             | P              | T                         | P                      | S              | V                      |
| HR reports                                                            | O                                   | O             | —              | —                         | —                      | —              | —                      |
| **Platform**                                                          |                                     |               |                |                           |                        |                |                        |
| `approval.decide`                                                     | per approval rule (default Manager) |               |                |                           |                        |                |                        |
| `notification.read`                                                   | S                                   | S             | S              | S                         | S                      | S              | S                      |
| `auditLog.read`                                                       | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `activityLog.read`                                                    | O                                   | O (HR events) | P              | T                         | S                      | S              | V                      |
| `settings.manage` / system administration                             | O                                   | —             | —              | —                         | —                      | —              | —                      |
| `visitor.manage`                                                      | O                                   | O             | —              | —                         | —                      | —              | —                      |
| `internalAudit.*`                                                     | O                                   | (D-07)        | (D-07)         | —                         | —                      | —              | —                      |

## 4. Critical rules (tested explicitly)

1. **Only MANAGER resolves `REVIEW_REQUIRED` audits.** TEAM_LEAD gets `403` on `POST /audits/:id/resolution` even for their own team's chart. Enforced by permission guard + service check + DB trigger.
2. **Only MANAGER allocates charts and assigns login names** — single, manual and CSV paths all go through the same `ChartAllocationService` / `LoginNameService`.
3. **Vendor isolation**: a principal with `vendor_id = A` can never read or change rows belonging to vendor B — employees, teams, projects, charts, production, audits, reworks, reports, notifications, files. Cross-vendor IDs return `404` (not `403`) to avoid leaking existence.
4. **Identity comes from the session**: coder and auditor identity on production/audit records is taken from the principal, never from the request body.
5. **Manager never sees passwords or token values** — activation/reset links are emailed directly; the API never returns them.
6. Deny by default: a route with no `@RequirePermission` fails CI.

## 5. How it is tested

- `packages/shared/rbac/matrix.ts` is the single definition; a generated test iterates **every route × every role** and asserts allowed / `403` / `404`.
- Vendor isolation integration suite: seeds two vendors and asserts zero cross-visibility across every list and detail endpoint.
- Audit-resolution suite: Manager succeeds; Team Lead, Auditor, Coder, Vendor Admin, Group Coach, HR all receive `403`; DB trigger rejects a direct insert with a non-manager resolver.

## Phase 3 additions

New permissions: `employee.sendActivation`, `employee.triggerPasswordReset`, `employee.changeRole` (Manager only), `loginName.read`, `loginName.assign` (Manager only). HR holds `employee.read` and `employee.update` organization-wide and nothing that creates, deactivates, resets or assigns. Vendor Admin holds the employee permissions at `VENDOR` scope only (never role change, never Login Names). Team Lead, Auditor and Coder cannot create employees. `apps/api/test/employee-directory.int-spec.ts` exercises every Phase 3 endpoint against all seven roles and asserts 401 / 403 / allowed exactly as `RBAC_MATRIX` says.
