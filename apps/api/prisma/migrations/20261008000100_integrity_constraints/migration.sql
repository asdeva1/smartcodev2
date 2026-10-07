-- Phase 2 — integrity constraints Prisma's schema language cannot express.
-- Everything here is applied by `prisma migrate deploy`; nothing is run by hand. `pnpm db:verify` asserts each object.
--
--   1. case-insensitive (expression) unique indexes
--   2. partial unique indexes   → "one active …", "one current …", "one open …" are PostgreSQL guarantees
--   3. CHECK constraints        → valid status relationships, non-negative counts, canonical formats
--   4. reference data           → the legal chart status transitions
--   5. secret / PHI screening for log payloads

-- ───────────────────────── 1. Case-insensitive unique identities ─────────────────────────

-- Employee ID: unique per organization, regardless of letter case (e.g. EMP100 vs emp100).
CREATE UNIQUE INDEX "employees_org_employee_code_ci_key" ON "employees" ("organization_id", lower("employee_code"));
CREATE UNIQUE INDEX "vendors_org_name_ci_key" ON "vendors" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "login_names_org_value_ci_key" ON "login_names" ("organization_id", lower("value"));
CREATE UNIQUE INDEX "clients_org_name_ci_key" ON "clients" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "projects_client_name_ci_key" ON "projects" ("client_id", lower("name"));

-- Team Name is NOT globally unique: it is unique only inside its scope (one vendor, or the in-house scope).
CREATE UNIQUE INDEX "teams_inhouse_name_ci_key" ON "teams" ("organization_id", lower("name")) WHERE "vendor_id" IS NULL;
CREATE UNIQUE INDEX "teams_vendor_name_ci_key" ON "teams" ("vendor_id", lower("name")) WHERE "vendor_id" IS NOT NULL;

-- ───────────────────────── 2. Partial unique indexes ─────────────────────────

-- One current team per employee.
CREATE UNIQUE INDEX "team_memberships_one_current_key" ON "team_memberships" ("employee_id") WHERE "ended_at" IS NULL;

-- One active login name per employee, and one active employee per login name.
CREATE UNIQUE INDEX "login_name_assignments_one_active_per_employee_key" ON "login_name_assignments" ("employee_id") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "login_name_assignments_one_active_per_login_name_key" ON "login_name_assignments" ("login_name_id") WHERE "ended_at" IS NULL;

-- A person holds a project role once at a time.
CREATE UNIQUE INDEX "project_assignments_one_active_key" ON "project_assignments" ("project_id", "employee_id", "project_role") WHERE "ended_at" IS NULL;

-- At most one live activation / reset token per employee and type.
CREATE UNIQUE INDEX "auth_tokens_one_live_per_type_key" ON "auth_tokens" ("employee_id", "type") WHERE "used_at" IS NULL AND "revoked_at" IS NULL;

-- A chart has at most ONE ACTIVE allocation; ended allocations are history.
CREATE UNIQUE INDEX "chart_allocations_one_active_per_chart_key" ON "chart_allocations" ("chart_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "chart_allocations_active_employee_idx" ON "chart_allocations" ("employee_id") WHERE "status" = 'ACTIVE';

-- One current production version per chart.
CREATE UNIQUE INDEX "production_entries_one_current_per_chart_key" ON "production_entries" ("chart_id") WHERE "is_current";

-- One open rework per chart.
CREATE UNIQUE INDEX "reworks_one_open_per_chart_key" ON "reworks" ("chart_id") WHERE "status" <> 'CLOSED';

-- One pending approval per (type, entity).
CREATE UNIQUE INDEX "approval_requests_one_pending_key" ON "approval_requests" ("organization_id", "type", "entity_type", "entity_id") WHERE "status" = 'PENDING';

-- ───────────────────────── 3. CHECK constraints ─────────────────────────

-- Employees ---------------------------------------------------------------
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_email_canonical_chk" CHECK ("email" = lower(btrim("email")) AND "email" ~ '^[^@\s]+@[^@\s]+$'),
  ADD CONSTRAINT "employees_code_canonical_chk" CHECK ("employee_code" = btrim("employee_code") AND "employee_code" <> ''),
  ADD CONSTRAINT "employees_name_present_chk" CHECK (btrim("full_name") <> ''),
  -- Vendor staff carry a vendor; Manager / HR / Group Coach are organization-level and never carry one.
  ADD CONSTRAINT "employees_role_vendor_chk" CHECK (
    ("role" = 'VENDOR_ADMIN' AND "vendor_id" IS NOT NULL)
    OR "role" IN ('TEAM_LEAD', 'AUDITOR', 'CODER')
    OR ("role" IN ('MANAGER', 'HR', 'GROUP_COACH') AND "vendor_id" IS NULL)
  ),
  ADD CONSTRAINT "employees_status_dates_chk" CHECK (
    ("status" NOT IN ('ACTIVE', 'LOCKED') OR "activated_at" IS NOT NULL)
    AND ("status" <> 'INACTIVE' OR "deactivated_at" IS NOT NULL)
  );

ALTER TABLE "credentials" ADD CONSTRAINT "credentials_attempts_chk" CHECK ("failed_attempts" >= 0);
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_lifecycle_chk" CHECK ("expires_at" > "created_at" AND NOT ("used_at" IS NOT NULL AND "revoked_at" IS NOT NULL));

-- Vendors, teams, clients, projects, login names ---------------------------
ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_code_canonical_chk" CHECK ("code" = btrim("code") AND "code" <> ''),
  ADD CONSTRAINT "vendors_name_present_chk" CHECK (btrim("name") <> '');
ALTER TABLE "teams" ADD CONSTRAINT "teams_name_present_chk" CHECK (btrim("name") <> '');
ALTER TABLE "clients" ADD CONSTRAINT "clients_name_present_chk" CHECK (btrim("name") <> '');
ALTER TABLE "projects" ADD CONSTRAINT "projects_name_present_chk" CHECK (btrim("name") <> '');
ALTER TABLE "login_names" ADD CONSTRAINT "login_names_value_canonical_chk" CHECK ("value" = btrim("value") AND "value" <> '' AND "value" !~ '\s');

ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_dates_chk" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_dates_chk" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
ALTER TABLE "login_name_assignments"
  ADD CONSTRAINT "login_name_assignments_end_chk" CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL)),
  ADD CONSTRAINT "login_name_assignments_dates_chk" CHECK ("ended_at" IS NULL OR "ended_at" >= "assigned_at");

-- Charts & allocation ------------------------------------------------------
ALTER TABLE "charts"
  ADD CONSTRAINT "charts_ref_canonical_chk" CHECK ("chart_ref" = btrim("chart_ref") AND "chart_ref" <> ''),
  ADD CONSTRAINT "charts_rework_cycle_chk" CHECK ("rework_cycle" >= 0);

-- ACTIVE ⇔ not ended; ENDED rows say when, why (and who, when a person ended it).
ALTER TABLE "chart_allocations"
  ADD CONSTRAINT "chart_allocations_status_chk" CHECK (
    ("status" = 'ACTIVE' AND "ended_at" IS NULL AND "end_reason" IS NULL AND "ended_by_id" IS NULL)
    OR ("status" = 'ENDED' AND "ended_at" IS NOT NULL AND "end_reason" IS NOT NULL AND "ended_at" >= "allocated_at")
  );

-- Production (D-11: Page Count, ICDs, DOS — there is no JCD column anywhere) ---
ALTER TABLE "production_entries"
  ADD CONSTRAINT "production_entries_counts_chk" CHECK ("version" >= 0 AND "page_count" >= 0 AND "icds" >= 0 AND "dos" >= 0),
  -- DRAFT ⇔ not submitted; only the latest version is current; a superseded version was once submitted.
  ADD CONSTRAINT "production_entries_status_chk" CHECK (
    ("status" = 'DRAFT') = ("submitted_at" IS NULL)
    AND "is_current" = ("status" <> 'SUPERSEDED')
  );

-- Audits (D-11: Total Errors = Audit Errors + Error Exceptions) --------------
ALTER TABLE "audits"
  ADD CONSTRAINT "audits_counts_chk" CHECK ("audit_errors" >= 0 AND "error_exceptions" >= 0 AND "sequence" >= 0),
  ADD CONSTRAINT "audits_total_errors_chk" CHECK ("total_errors" = "audit_errors" + "error_exceptions"),
  ADD CONSTRAINT "audits_status_result_chk" CHECK (
    ("status" = 'IN_PROGRESS' AND "result" IS NULL)
    OR ("status" = 'PASSED' AND "result" = 'PASS')
    OR ("status" IN ('REVIEW_REQUIRED', 'APPROVED', 'REJECTED') AND "result" = 'REVIEW_REQUIRED')
  ),
  -- Re-audit ⇔ sequence > 1 ⇔ it points at the audit it follows.
  ADD CONSTRAINT "audits_re_audit_chk" CHECK (
    "is_re_audit" = ("sequence" > 1) AND ("previous_audit_id" IS NOT NULL) = ("sequence" > 1)
  );

ALTER TABLE "audit_resolutions" ADD CONSTRAINT "audit_resolutions_reason_chk" CHECK ("decision" <> 'REJECTED' OR btrim(coalesce("reason", '')) <> '');

ALTER TABLE "reworks"
  ADD CONSTRAINT "reworks_reason_present_chk" CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "reworks_completed_chk" CHECK (("status" IN ('SUBMITTED', 'CLOSED')) = ("completed_at" IS NOT NULL));

-- Notifications, approvals ---------------------------------------------------
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_type_format_chk" CHECK ("type" ~ '^[A-Z][A-Z0-9_.]{1,63}$'),
  ADD CONSTRAINT "notifications_subject_present_chk" CHECK (btrim("subject") <> '');

ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_type_format_chk" CHECK ("type" ~ '^[A-Z][A-Z0-9_.]{1,63}$'),
  ADD CONSTRAINT "approval_requests_status_chk" CHECK (
    ("status" = 'PENDING' AND "decision" IS NULL AND "resolved_at" IS NULL AND "resolved_by_id" IS NULL)
    OR ("status" = 'CANCELLED' AND "decision" IS NULL AND "resolved_at" IS NOT NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decision"::text = "status"::text AND "resolved_at" IS NOT NULL AND "resolved_by_id" IS NOT NULL)
  );

ALTER TABLE "approval_steps"
  ADD CONSTRAINT "approval_steps_approver_chk" CHECK ("approver_id" IS NOT NULL OR "approver_role" IS NOT NULL),
  ADD CONSTRAINT "approval_steps_order_chk" CHECK ("step_order" >= 1),
  ADD CONSTRAINT "approval_steps_status_chk" CHECK (
    ("status" = 'PENDING') = ("decided_at" IS NULL)
    AND ("status" IN ('APPROVED', 'REJECTED')) = ("decided_by_id" IS NOT NULL)
  );

-- ───────────────────────── 4. Reference data: legal chart status transitions ─────────────────────────
-- Mirrors packages/shared/src/workflow/chart.ts (a test fails if the two ever differ).
INSERT INTO "chart_status_transitions" ("from_status", "to_status") VALUES
  ('PENDING_ALLOCATION', 'ALLOCATED'),
  ('ALLOCATED', 'PENDING_ALLOCATION'),
  ('IN_PRODUCTION', 'ALLOCATED'),
  ('ALLOCATED', 'IN_PRODUCTION'),
  ('IN_PRODUCTION', 'CODED'),
  ('CODED', 'PENDING_AUDIT'),
  ('PENDING_AUDIT', 'AUDITED'),
  ('RE_AUDIT', 'AUDITED'),
  ('PENDING_AUDIT', 'REVIEW_REQUIRED'),
  ('RE_AUDIT', 'REVIEW_REQUIRED'),
  ('REVIEW_REQUIRED', 'COMPLETED'),
  ('REVIEW_REQUIRED', 'REWORK'),
  ('REWORK', 'RE_AUDIT'),
  ('AUDITED', 'COMPLETED');

-- ───────────────────────── 5. Secret / PHI screening for log payloads ─────────────────────────
-- Activity-log metadata and audit-log before/after documents must never carry credentials, tokens or
-- patient-identifying keys. The database rejects such keys at any depth (defence in depth behind the API's redaction).
CREATE FUNCTION "sc_json_has_forbidden_key"(doc jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH RECURSIVE walk(node) AS (
    SELECT doc WHERE doc IS NOT NULL
    UNION ALL
    SELECT c.child
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT value AS child FROM jsonb_each(CASE WHEN jsonb_typeof(w.node) = 'object' THEN w.node ELSE '{}'::jsonb END)
      UNION ALL
      SELECT value AS child FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.node) = 'array' THEN w.node ELSE '[]'::jsonb END)
    ) c
  ),
  keys AS (
    SELECT regexp_replace(lower(k.key), '[^a-z0-9]', '', 'g') AS nk
    FROM walk w
    CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.node) = 'object' THEN w.node ELSE '{}'::jsonb END) AS k(key)
  )
  SELECT EXISTS (
    SELECT 1 FROM keys
    WHERE nk LIKE ANY (ARRAY['%password%', '%passwd%', '%secret%', '%token%', '%apikey%', '%privatekey%', '%patient%', '%socialsecurity%'])
       OR nk = ANY (ARRAY['authorization', 'cookie', 'setcookie', 'ssn', 'mrn', 'dob', 'dateofbirth', 'birthdate'])
  );
$$;

ALTER TABLE "activity_logs"
  ADD CONSTRAINT "activity_logs_action_format_chk" CHECK ("action" ~ '^[A-Z][A-Z0-9_.]{1,63}$'),
  ADD CONSTRAINT "activity_logs_metadata_safe_chk" CHECK (jsonb_typeof("metadata") = 'object' AND NOT "sc_json_has_forbidden_key"("metadata"));

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_format_chk" CHECK ("action" ~ '^[A-Z][A-Z0-9_.]{1,63}$'),
  ADD CONSTRAINT "audit_logs_outcome_chk" CHECK ("outcome" IN ('SUCCESS', 'DENIED', 'FAILURE')),
  ADD CONSTRAINT "audit_logs_payload_safe_chk" CHECK (
    NOT "sc_json_has_forbidden_key"("before_data") AND NOT "sc_json_has_forbidden_key"("after_data")
  );
