# 17 — Phase 12 modules: Visitor Management, Internal Audit, Smart HRMS boundary, more approvals

Branch `feature/phase-12-modules`. One additive migration: `20261012000000_visitors_internal_audit` (new tables only).

## Visitor Management (D-07 as drafted)

Who: HR and the Manager (`visitor.manage`, organization-wide). Nobody else can see or change visits.

| Step      | What happens                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register  | Visitor name, optional company/phone/email, the host (an active employee), purpose, optional expected time. A returning visitor is matched on email and reused. |
| Check in  | Issues a badge number `V-YYYYMMDD-NNN` (counts up each day, in the organisation's time zone) and notifies the host.                                             |
| Badge     | A printable badge: name, company, host, badge number, date.                                                                                                     |
| Check out | Records the time the visitor left.                                                                                                                              |
| Cancel    | Only for a visit that has not started. Visits are never deleted.                                                                                                |

Not stored: ID proof numbers. Audit-log entries carry identifiers only, never phone or email. The database checks that times and badge agree with the status (`visits_status_chk`) and that a badge number is unique.

## Internal Audit — DRAFT SCOPE, please confirm (D-07)

No scope was supplied, so this is the smallest useful version, for the Manager only (`internalAudit.access`):

1. **Draw a sample**: random finished audits (passed, or approved by the Manager) that have not been reviewed, optionally for one project.
2. **Review**: the Manager counts the errors independently (without seeing the auditor's number), and the system records agree/disagree. Agreement means the same total.
3. **Summary**: agreement rate overall and per auditor, and the average gap (positive = auditor missed errors, negative = auditor stricter).

One review per audit. Questions to settle: should other roles (for example a dedicated Internal Auditor role) have access? Should disagreements trigger rework or coaching notes? What sample size per period?

## Smart HRMS boundary (D-09)

`HrIntegrationPort` (API) with a null adapter, and `GET /hr-integration/status` for HR and the Manager. The screen "Smart HRMS" lists the integration points (employee master data, separations, attendance, account events). Identity is the Employee ID. Nothing is synchronised and no API is invented; methods are added to the port when the real specification arrives.

## More approval types

Added to the approval engine: **Reactivate employee** (HR, Vendor Admin, Team Lead), **Change role** (HR, Vendor Admin, Team Lead; needs the new role and a reason), **Reopen project** (Team Lead, Vendor Admin, Quality Coach). Each is carried out on approval by the same service that does it directly, with the Manager as the actor.
