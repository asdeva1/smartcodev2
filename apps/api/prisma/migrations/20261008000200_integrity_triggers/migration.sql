-- Phase 2 — integrity triggers. Critical rules live in PostgreSQL, not only in application code, so no code path
-- (API, worker, script, future module) can break them. SQLSTATE classes used by these rules:
--   SC403  the actor's role is not allowed (e.g. a non-Manager resolving a review)   → API maps to HTTP 403
--   SC409  the row is in the wrong state / history is immutable                     → API maps to HTTP 409
--   SC422  a reference or eligibility rule is violated                              → API maps to HTTP 422
--
-- Order-of-operations recipes for services (all inside ONE transaction) are in docs/02-database-architecture.md §9.

-- ───────────────────────── Helpers ─────────────────────────

-- The acting employee, set per transaction by the API: SELECT set_config('app.actor_id', '<uuid>', true).
CREATE FUNCTION "sc_actor_id"() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.actor_id', true), '')::uuid
$$;

CREATE FUNCTION "sc_forbid_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SC409: rows in % are never deleted (use a status change)', TG_TABLE_NAME USING ERRCODE = 'SC409';
END $$;

CREATE FUNCTION "sc_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SC409: % is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'SC409';
END $$;

CREATE FUNCTION "sc_forbid_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SC409: % cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'SC409';
END $$;

-- True when NEW and OLD differ in any column other than the allowed ones.
CREATE FUNCTION "sc_changed_outside"(old_row jsonb, new_row jsonb, allowed text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (old_row - allowed) IS DISTINCT FROM (new_row - allowed)
$$;

-- An ACTIVE employee holding the given role inside the organization (used for Manager-only rules).
CREATE FUNCTION "sc_is_active_role"(emp_id uuid, wanted "role", org_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "employees" e
    WHERE e."id" = emp_id AND e."role" = wanted AND e."status" = 'ACTIVE' AND e."organization_id" = org_id
  )
$$;

-- ───────────────────────── Employees ─────────────────────────

CREATE FUNCTION "sc_employees_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Employees are created by a Manager / Vendor Admin WITHOUT a password and activate themselves later.
    IF NEW."status" <> 'PENDING_ACTIVATION' THEN
      RAISE EXCEPTION 'SC409: a new employee must start as PENDING_ACTIVATION' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."organization_id" <> OLD."organization_id" OR NEW."employee_code" IS DISTINCT FROM OLD."employee_code"
     OR NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id" OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'SC409: Employee ID, organization, vendor and creator of an employee are immutable' USING ERRCODE = 'SC409';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'PENDING_ACTIVATION' AND NEW."status" IN ('ACTIVE', 'INACTIVE'))
    OR (OLD."status" = 'ACTIVE'             AND NEW."status" IN ('LOCKED', 'INACTIVE'))
    OR (OLD."status" = 'LOCKED'             AND NEW."status" IN ('ACTIVE', 'INACTIVE'))
    OR (OLD."status" = 'INACTIVE'           AND NEW."status" = 'PENDING_ACTIVATION')
  ) THEN
    RAISE EXCEPTION 'SC409: employee status cannot change from % to %', OLD."status", NEW."status" USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "employees_guard" BEFORE INSERT OR UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION "sc_employees_guard"();

-- A deactivated employee releases their SmartClues Login Name immediately.
CREATE FUNCTION "sc_employee_deactivated"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "login_name_assignments"
     SET "ended_at" = now(), "end_reason" = 'EMPLOYEE_INACTIVE'
   WHERE "employee_id" = NEW."id" AND "ended_at" IS NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER "employees_deactivated" AFTER UPDATE OF "status" ON "employees"
  FOR EACH ROW WHEN (NEW."status" = 'INACTIVE' AND OLD."status" <> 'INACTIVE')
  EXECUTE FUNCTION "sc_employee_deactivated"();

-- ───────────────────────── Vendor isolation: teams & memberships ─────────────────────────

CREATE FUNCTION "sc_teams_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lead "employees"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."organization_id" <> OLD."organization_id" OR NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id") THEN
    RAISE EXCEPTION 'SC409: a team cannot move between vendors' USING ERRCODE = 'SC409';
  END IF;
  IF NEW."team_lead_id" IS NOT NULL THEN
    SELECT * INTO lead FROM "employees" WHERE "id" = NEW."team_lead_id";
    IF lead."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it
    IF lead."role" <> 'TEAM_LEAD' OR lead."status" = 'INACTIVE' THEN
      RAISE EXCEPTION 'SC422: a team lead must be an active employee with the TEAM_LEAD role' USING ERRCODE = 'SC422';
    END IF;
    IF lead."vendor_id" IS DISTINCT FROM NEW."vendor_id" THEN
      RAISE EXCEPTION 'SC422: the team lead must belong to the same vendor scope as the team' USING ERRCODE = 'SC422';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "teams_guard" BEFORE INSERT OR UPDATE ON "teams"
  FOR EACH ROW EXECUTE FUNCTION "sc_teams_guard"();

CREATE FUNCTION "sc_team_memberships_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp "employees"%ROWTYPE; tm "teams"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['ended_at']) OR OLD."ended_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SC409: membership history is immutable (only an open membership can be ended)' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO emp FROM "employees" WHERE "id" = NEW."employee_id";
  SELECT * INTO tm FROM "teams" WHERE "id" = NEW."team_id";
  IF emp."id" IS NULL OR tm."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it
  IF emp."status" = 'INACTIVE' THEN
    RAISE EXCEPTION 'SC422: an inactive employee cannot join a team' USING ERRCODE = 'SC422';
  END IF;
  IF emp."organization_id" <> tm."organization_id" OR emp."vendor_id" IS DISTINCT FROM tm."vendor_id" THEN
    RAISE EXCEPTION 'SC422: employee and team must belong to the same vendor scope' USING ERRCODE = 'SC422';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "team_memberships_guard" BEFORE INSERT OR UPDATE ON "team_memberships"
  FOR EACH ROW EXECUTE FUNCTION "sc_team_memberships_guard"();

-- ───────────────────────── Login Names ─────────────────────────

CREATE FUNCTION "sc_login_name_assignments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp "employees"%ROWTYPE; ln "login_names"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['ended_at', 'end_reason']) OR OLD."ended_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SC409: login name assignment history is immutable (only an open assignment can be ended)' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO emp FROM "employees" WHERE "id" = NEW."employee_id";
  SELECT * INTO ln FROM "login_names" WHERE "id" = NEW."login_name_id";
  IF emp."id" IS NULL OR ln."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it
  IF ln."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SC422: the login name is not active' USING ERRCODE = 'SC422';
  END IF;
  IF emp."status" = 'INACTIVE' OR emp."organization_id" <> ln."organization_id" THEN
    RAISE EXCEPTION 'SC422: the employee is not eligible for a login name' USING ERRCODE = 'SC422';
  END IF;
  -- Manager controls assignment.
  IF NOT sc_is_active_role(NEW."assigned_by_id", 'MANAGER', ln."organization_id") THEN
    RAISE EXCEPTION 'SC403: only an active Manager can assign a login name' USING ERRCODE = 'SC403';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "login_name_assignments_guard" BEFORE INSERT OR UPDATE ON "login_name_assignments"
  FOR EACH ROW EXECUTE FUNCTION "sc_login_name_assignments_guard"();

-- ───────────────────────── Projects & staffing ─────────────────────────

CREATE FUNCTION "sc_projects_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."vendor_id" IS DISTINCT FROM OLD."vendor_id" OR NEW."client_id" <> OLD."client_id")
     AND EXISTS (SELECT 1 FROM "charts" c WHERE c."project_id" = OLD."id") THEN
    RAISE EXCEPTION 'SC409: the client or vendor of a project with charts cannot change' USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "projects_guard" BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION "sc_projects_guard"();

-- A project assignment links an EXISTING employee; it never creates one.
CREATE FUNCTION "sc_project_assignments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp "employees"%ROWTYPE; prj "projects"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['ended_at']) OR OLD."ended_at" IS NOT NULL THEN
      RAISE EXCEPTION 'SC409: project assignment history is immutable (only an open assignment can be ended)' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO emp FROM "employees" WHERE "id" = NEW."employee_id";
  SELECT * INTO prj FROM "projects" WHERE "id" = NEW."project_id";
  IF emp."id" IS NULL OR prj."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it
  IF emp."status" = 'INACTIVE' OR emp."organization_id" <> prj."organization_id" THEN
    RAISE EXCEPTION 'SC422: the employee is not eligible for this project' USING ERRCODE = 'SC422';
  END IF;
  IF emp."role"::text <> NEW."project_role"::text THEN
    RAISE EXCEPTION 'SC422: the employee role % does not match the project role %', emp."role", NEW."project_role" USING ERRCODE = 'SC422';
  END IF;
  -- Vendor isolation: vendor staff can only work on their own vendor's projects.
  IF emp."vendor_id" IS NOT NULL AND prj."vendor_id" IS DISTINCT FROM emp."vendor_id" THEN
    RAISE EXCEPTION 'SC422: vendor staff can only be assigned to projects of their own vendor' USING ERRCODE = 'SC422';
  END IF;
  IF NOT sc_is_active_role(NEW."assigned_by_id", 'MANAGER', prj."organization_id") THEN
    RAISE EXCEPTION 'SC403: only an active Manager can assign project staff' USING ERRCODE = 'SC403';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "project_assignments_guard" BEFORE INSERT OR UPDATE ON "project_assignments"
  FOR EACH ROW EXECUTE FUNCTION "sc_project_assignments_guard"();

-- ───────────────────────── Charts: lifecycle ─────────────────────────

CREATE FUNCTION "sc_charts_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cur "production_entries"%ROWTYPE; last_audit "audits"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING_ALLOCATION' THEN
      RAISE EXCEPTION 'SC409: a new chart starts as PENDING_ALLOCATION' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."project_id" <> OLD."project_id" OR NEW."chart_ref" <> OLD."chart_ref" OR NEW."organization_id" <> OLD."organization_id" THEN
    RAISE EXCEPTION 'SC409: the project and Chart ID of a chart are immutable' USING ERRCODE = 'SC409';
  END IF;
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;

  -- 1. The transition must exist in the lifecycle (chart_status_transitions mirrors the shared workflow).
  IF NOT EXISTS (SELECT 1 FROM "chart_status_transitions" t WHERE t."from_status" = OLD."status" AND t."to_status" = NEW."status") THEN
    RAISE EXCEPTION 'SC409: chart status cannot change from % to %', OLD."status", NEW."status" USING ERRCODE = 'SC409';
  END IF;

  SELECT * INTO cur FROM "production_entries" p WHERE p."chart_id" = NEW."id" AND p."is_current";
  SELECT * INTO last_audit FROM "audits" a WHERE a."chart_id" = NEW."id" ORDER BY a."sequence" DESC LIMIT 1;

  -- 2. The facts that justify the new status must exist (valid status relationships).
  CASE NEW."status"
    WHEN 'ALLOCATED' THEN
      IF NOT EXISTS (SELECT 1 FROM "chart_allocations" a WHERE a."chart_id" = NEW."id" AND a."status" = 'ACTIVE') THEN
        RAISE EXCEPTION 'SC422: a chart can be ALLOCATED only with an active allocation' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'PENDING_ALLOCATION' THEN
      IF EXISTS (SELECT 1 FROM "chart_allocations" a WHERE a."chart_id" = NEW."id" AND a."status" = 'ACTIVE') THEN
        RAISE EXCEPTION 'SC422: end the active allocation before returning a chart to PENDING_ALLOCATION' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'CODED' THEN
      IF cur."id" IS NULL OR cur."status" <> 'SUBMITTED' THEN
        RAISE EXCEPTION 'SC422: a chart is CODED only with a submitted production version' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'PENDING_AUDIT' THEN
      IF cur."id" IS NULL OR cur."status" <> 'SUBMITTED' THEN
        RAISE EXCEPTION 'SC422: a chart enters the audit queue only with a submitted production version' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'AUDITED' THEN
      IF last_audit."id" IS NULL OR last_audit."status" <> 'PASSED' OR last_audit."production_entry_id" <> cur."id" THEN
        RAISE EXCEPTION 'SC422: a chart is AUDITED only after a PASSED audit of its current production version' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'REVIEW_REQUIRED' THEN
      IF last_audit."id" IS NULL OR last_audit."status" <> 'REVIEW_REQUIRED' OR last_audit."production_entry_id" <> cur."id" THEN
        RAISE EXCEPTION 'SC422: a chart is REVIEW_REQUIRED only after a REVIEW_REQUIRED audit of its current production version' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'REWORK' THEN
      IF last_audit."id" IS NULL OR last_audit."status" <> 'REJECTED'
         OR NOT EXISTS (SELECT 1 FROM "reworks" r WHERE r."audit_id" = last_audit."id" AND r."status" <> 'CLOSED') THEN
        RAISE EXCEPTION 'SC422: a chart enters REWORK only after the Manager rejected an audit and a rework exists' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'RE_AUDIT' THEN
      IF cur."id" IS NULL OR cur."status" <> 'SUBMITTED' OR cur."rework_id" IS NULL THEN
        RAISE EXCEPTION 'SC422: re-audit requires a new submitted production version created by the rework' USING ERRCODE = 'SC422';
      END IF;
    WHEN 'COMPLETED' THEN
      IF last_audit."id" IS NULL OR last_audit."status" NOT IN ('PASSED', 'APPROVED') OR last_audit."production_entry_id" <> cur."id" THEN
        RAISE EXCEPTION 'SC422: a chart is COMPLETED only after a PASSED audit or a Manager APPROVAL of its current version' USING ERRCODE = 'SC422';
      END IF;
    ELSE NULL;
  END CASE;
  RETURN NEW;
END $$;

CREATE TRIGGER "charts_guard" BEFORE INSERT OR UPDATE ON "charts"
  FOR EACH ROW EXECUTE FUNCTION "sc_charts_guard"();

-- Every status change writes the append-only timeline. Actor/reason come from the transaction settings
-- app.actor_id / app.reason (set by the API); both may be empty for system actions.
CREATE FUNCTION "sc_charts_status_event"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "chart_status_events" ("id", "chart_id", "from_status", "to_status", "actor_id", "reason")
  VALUES (gen_random_uuid(), NEW."id", CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."status" END, NEW."status",
          sc_actor_id(), nullif(current_setting('app.reason', true), ''));
  RETURN NULL;
END $$;

CREATE TRIGGER "charts_status_event_insert" AFTER INSERT ON "charts"
  FOR EACH ROW EXECUTE FUNCTION "sc_charts_status_event"();
CREATE TRIGGER "charts_status_event_update" AFTER UPDATE OF "status" ON "charts"
  FOR EACH ROW WHEN (NEW."status" <> OLD."status") EXECUTE FUNCTION "sc_charts_status_event"();

-- ───────────────────────── Chart allocation (one engine; the database is its last line of defence) ─────────────────────────

CREATE FUNCTION "sc_chart_allocations_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "charts"%ROWTYPE; prj "projects"%ROWTYPE; emp "employees"%ROWTYPE; ln "login_names"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only ACTIVE → ENDED, once. Everything else about an allocation is history.
    IF OLD."status" <> 'ACTIVE' OR sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW),
         ARRAY['status', 'ended_at', 'end_reason', 'ended_by_id', 'updated_at']) THEN
      RAISE EXCEPTION 'SC409: allocation history is immutable (an active allocation can only be ended)' USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO c FROM "charts" WHERE "id" = NEW."chart_id";
  SELECT * INTO prj FROM "projects" WHERE "id" = c."project_id";
  SELECT * INTO emp FROM "employees" WHERE "id" = NEW."employee_id";
  SELECT * INTO ln FROM "login_names" WHERE "id" = NEW."login_name_id";
  IF c."id" IS NULL OR emp."id" IS NULL OR ln."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it

  IF c."status" NOT IN ('PENDING_ALLOCATION', 'ALLOCATED', 'IN_PRODUCTION') THEN
    RAISE EXCEPTION 'SC409: a chart in status % cannot be allocated', c."status" USING ERRCODE = 'SC409';
  END IF;
  IF NOT sc_is_active_role(NEW."allocated_by_id", 'MANAGER', c."organization_id") THEN
    RAISE EXCEPTION 'SC403: only an active Manager can allocate charts' USING ERRCODE = 'SC403';
  END IF;
  -- Eligibility (D-03): ACTIVE employee, role CODER, valid active login name belonging to them.
  IF emp."role" <> 'CODER' OR emp."status" <> 'ACTIVE' OR emp."organization_id" <> c."organization_id" THEN
    RAISE EXCEPTION 'SC422: charts can only be allocated to an ACTIVE employee with the CODER role' USING ERRCODE = 'SC422';
  END IF;
  IF ln."status" <> 'ACTIVE' OR ln."organization_id" <> c."organization_id"
     OR NOT EXISTS (SELECT 1 FROM "login_name_assignments" a
                    WHERE a."login_name_id" = NEW."login_name_id" AND a."employee_id" = NEW."employee_id" AND a."ended_at" IS NULL) THEN
    RAISE EXCEPTION 'SC422: the login name is not an active login name of that employee' USING ERRCODE = 'SC422';
  END IF;
  -- Project scope: a vendor coder only works on their own vendor's projects; in-house coders need a project assignment.
  IF emp."vendor_id" IS NOT NULL THEN
    IF prj."vendor_id" IS DISTINCT FROM emp."vendor_id" THEN
      RAISE EXCEPTION 'SC422: vendor staff cannot receive charts of another vendor or in-house projects' USING ERRCODE = 'SC422';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "project_assignments" pa
                    WHERE pa."project_id" = prj."id" AND pa."employee_id" = emp."id" AND pa."project_role" = 'CODER' AND pa."ended_at" IS NULL) THEN
    RAISE EXCEPTION 'SC422: the coder is not assigned to this project' USING ERRCODE = 'SC422';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "chart_allocations_guard" BEFORE INSERT OR UPDATE ON "chart_allocations"
  FOR EACH ROW EXECUTE FUNCTION "sc_chart_allocations_guard"();

-- ───────────────────────── Production (versioned) ─────────────────────────

CREATE FUNCTION "sc_production_entries_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE alloc "chart_allocations"%ROWTYPE; coder "employees"%ROWTYPE; rw "reworks"%ROWTYPE; prev "production_entries"%ROWTYPE; next_version integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'DRAFT' THEN
      IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['page_count', 'icds', 'dos', 'coded_at', 'submitted_at', 'remarks', 'status', 'updated_at']) THEN
        RAISE EXCEPTION 'SC409: only the production figures of a draft can change' USING ERRCODE = 'SC409';
      END IF;
      IF NEW."status" = 'SUPERSEDED' THEN
        RAISE EXCEPTION 'SC409: a draft is submitted before it can be superseded' USING ERRCODE = 'SC409';
      END IF;
    ELSIF OLD."status" = 'SUBMITTED' AND NEW."status" = 'SUPERSEDED' THEN
      -- Submitted work is never edited; a newer version only marks the old one superseded.
      IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'is_current', 'updated_at']) THEN
        RAISE EXCEPTION 'SC409: a submitted production version is immutable' USING ERRCODE = 'SC409';
      END IF;
    ELSE
      RAISE EXCEPTION 'SC409: a % production version is immutable', OLD."status" USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: the version number is assigned here, never trusted from the client.
  SELECT coalesce(max(p."version"), 0) + 1 INTO next_version FROM "production_entries" p WHERE p."chart_id" = NEW."chart_id";
  NEW."version" := next_version;

  SELECT * INTO coder FROM "employees" WHERE "id" = NEW."coder_id";
  SELECT * INTO alloc FROM "chart_allocations" WHERE "id" = NEW."allocation_id";
  IF coder."id" IS NULL OR alloc."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it
  IF coder."role" <> 'CODER' THEN
    RAISE EXCEPTION 'SC422: production is submitted by a CODER' USING ERRCODE = 'SC422';
  END IF;
  IF alloc."chart_id" <> NEW."chart_id" OR alloc."employee_id" <> NEW."coder_id" OR alloc."login_name_id" <> NEW."login_name_id" THEN
    RAISE EXCEPTION 'SC422: production must match the allocation (chart, coder and login name)' USING ERRCODE = 'SC422';
  END IF;

  IF next_version = 1 THEN
    IF NEW."rework_id" IS NOT NULL THEN
      RAISE EXCEPTION 'SC422: the first production version cannot belong to a rework' USING ERRCODE = 'SC422';
    END IF;
    IF alloc."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'SC422: production requires an active allocation' USING ERRCODE = 'SC422';
    END IF;
  ELSE
    -- A correction is a NEW version produced by a rework; the previous version stays as history.
    IF NEW."rework_id" IS NULL THEN
      RAISE EXCEPTION 'SC422: a new production version after the first must come from a rework' USING ERRCODE = 'SC422';
    END IF;
    SELECT * INTO rw FROM "reworks" WHERE "id" = NEW."rework_id";
    SELECT * INTO prev FROM "production_entries" p WHERE p."chart_id" = NEW."chart_id" AND p."version" = next_version - 1;
    IF rw."chart_id" <> NEW."chart_id" OR rw."production_entry_id" <> prev."id" OR rw."status" NOT IN ('OPEN', 'IN_PROGRESS') THEN
      RAISE EXCEPTION 'SC422: the rework does not correspond to the previous production version' USING ERRCODE = 'SC422';
    END IF;
    IF rw."assigned_coder_id" <> NEW."coder_id" THEN
      RAISE EXCEPTION 'SC422: the rework is assigned to a different coder' USING ERRCODE = 'SC422';
    END IF;
    IF prev."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'SC409: the previous version was never submitted' USING ERRCODE = 'SC409';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "production_entries_guard" BEFORE INSERT OR UPDATE ON "production_entries"
  FOR EACH ROW EXECUTE FUNCTION "sc_production_entries_guard"();

CREATE FUNCTION "sc_production_entries_delete_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'SC409: submitted production history is never deleted' USING ERRCODE = 'SC409';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "production_entries_no_delete" BEFORE DELETE ON "production_entries"
  FOR EACH ROW EXECUTE FUNCTION "sc_production_entries_delete_guard"();

-- ───────────────────────── Audits ─────────────────────────

CREATE FUNCTION "sc_audits_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pe "production_entries"%ROWTYPE; c "charts"%ROWTYPE; prj "projects"%ROWTYPE; aud "employees"%ROWTYPE; prev "audits"%ROWTYPE; next_seq integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW),
         ARRAY['audit_errors', 'error_exceptions', 'total_errors', 'result', 'status', 'remarks', 'audited_at', 'updated_at']) THEN
      RAISE EXCEPTION 'SC409: the chart, production version, auditor and sequence of an audit are immutable' USING ERRCODE = 'SC409';
    END IF;
    IF OLD."status" = 'IN_PROGRESS' THEN
      -- Still being entered by the auditor: figures may change; the server recomputes the total.
      NEW."total_errors" := NEW."audit_errors" + NEW."error_exceptions";
      IF NEW."status" IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'SC403: only a Manager resolution can approve or reject an audit' USING ERRCODE = 'SC403';
      END IF;
    ELSIF OLD."status" = 'REVIEW_REQUIRED' THEN
      -- Submitted: figures are frozen; the only change is the Manager's resolution.
      IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'updated_at']) THEN
        RAISE EXCEPTION 'SC409: a submitted audit is immutable' USING ERRCODE = 'SC409';
      END IF;
      IF NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'SC409: a REVIEW_REQUIRED audit can only be approved or rejected' USING ERRCODE = 'SC409';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM "audit_resolutions" r WHERE r."audit_id" = OLD."id" AND r."decision"::text = NEW."status"::text) THEN
        RAISE EXCEPTION 'SC403: an audit is approved or rejected only through a Manager resolution' USING ERRCODE = 'SC403';
      END IF;
    ELSE
      RAISE EXCEPTION 'SC409: a % audit is immutable', OLD."status" USING ERRCODE = 'SC409';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: sequence, re-audit link and total are computed here, never trusted from the client.
  SELECT * INTO pe FROM "production_entries" WHERE "id" = NEW."production_entry_id";
  SELECT * INTO c FROM "charts" WHERE "id" = NEW."chart_id";
  SELECT * INTO prj FROM "projects" WHERE "id" = c."project_id";
  SELECT * INTO aud FROM "employees" WHERE "id" = NEW."auditor_id";
  IF pe."id" IS NULL OR c."id" IS NULL OR aud."id" IS NULL THEN RETURN NEW; END IF; -- missing row: the foreign key reports it

  IF pe."chart_id" <> NEW."chart_id" OR pe."status" <> 'SUBMITTED' OR NOT pe."is_current" THEN
    RAISE EXCEPTION 'SC422: only the current submitted production version of the chart can be audited' USING ERRCODE = 'SC422';
  END IF;
  IF aud."role" <> 'AUDITOR' OR aud."status" <> 'ACTIVE' OR aud."organization_id" <> c."organization_id" THEN
    RAISE EXCEPTION 'SC422: audits are performed by an ACTIVE employee with the AUDITOR role' USING ERRCODE = 'SC422';
  END IF;
  IF aud."id" = pe."coder_id" THEN
    RAISE EXCEPTION 'SC403: an auditor cannot audit their own production' USING ERRCODE = 'SC403';
  END IF;
  IF aud."vendor_id" IS NOT NULL AND prj."vendor_id" IS DISTINCT FROM aud."vendor_id" THEN
    RAISE EXCEPTION 'SC422: vendor auditors can only audit their own vendor''s projects' USING ERRCODE = 'SC422';
  END IF;

  SELECT * INTO prev FROM "audits" a WHERE a."chart_id" = NEW."chart_id" ORDER BY a."sequence" DESC LIMIT 1;
  next_seq := coalesce(prev."sequence", 0) + 1;
  NEW."sequence" := next_seq;
  NEW."is_re_audit" := next_seq > 1;
  NEW."previous_audit_id" := prev."id";
  NEW."total_errors" := NEW."audit_errors" + NEW."error_exceptions";

  IF next_seq = 1 THEN
    IF c."status" <> 'PENDING_AUDIT' THEN
      RAISE EXCEPTION 'SC409: the chart is not waiting for audit (status %)', c."status" USING ERRCODE = 'SC409';
    END IF;
  ELSE
    -- Re-audit: only after the Manager rejected the previous audit AND the rework produced a new version.
    IF c."status" <> 'RE_AUDIT' THEN
      RAISE EXCEPTION 'SC409: the chart is not waiting for re-audit (status %)', c."status" USING ERRCODE = 'SC409';
    END IF;
    IF prev."status" <> 'REJECTED' OR pe."rework_id" IS NULL
       OR NOT EXISTS (SELECT 1 FROM "reworks" r WHERE r."id" = pe."rework_id" AND r."audit_id" = prev."id") THEN
      RAISE EXCEPTION 'SC422: a re-audit must follow a rejected audit and the rework it caused' USING ERRCODE = 'SC422';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "audits_guard" BEFORE INSERT OR UPDATE ON "audits"
  FOR EACH ROW EXECUTE FUNCTION "sc_audits_guard"();

-- ───────────────────────── Manager resolution (D-01) ─────────────────────────

CREATE FUNCTION "sc_audit_resolutions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "audits"%ROWTYPE; c "charts"%ROWTYPE;
BEGIN
  SELECT * INTO a FROM "audits" WHERE "id" = NEW."audit_id";
  SELECT * INTO c FROM "charts" WHERE "id" = a."chart_id";
  IF a."id" IS NULL THEN RETURN NEW; END IF; -- missing audit: the foreign key reports it

  -- Only an ACTIVE MANAGER resolves a review — Team Lead, Group Coach/SME, Auditor, Coder, Vendor Admin and HR cannot.
  IF NOT sc_is_active_role(NEW."resolved_by_id", 'MANAGER', c."organization_id") THEN
    RAISE EXCEPTION 'SC403: only an active Manager can resolve a REVIEW_REQUIRED audit' USING ERRCODE = 'SC403';
  END IF;
  IF NEW."resolved_by_id" = a."auditor_id" THEN
    RAISE EXCEPTION 'SC403: an auditor cannot resolve their own review decision' USING ERRCODE = 'SC403';
  END IF;
  IF a."status" IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'SC409: this audit has already been resolved' USING ERRCODE = 'SC409';
  END IF;
  IF a."status" <> 'REVIEW_REQUIRED' THEN
    RAISE EXCEPTION 'SC409: only REVIEW_REQUIRED audits can be resolved (was %)', a."status" USING ERRCODE = 'SC409';
  END IF;
  IF c."status" <> 'REVIEW_REQUIRED' THEN
    RAISE EXCEPTION 'SC409: the chart is not in REVIEW_REQUIRED (status %)', c."status" USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "audit_resolutions_guard" BEFORE INSERT ON "audit_resolutions"
  FOR EACH ROW EXECUTE FUNCTION "sc_audit_resolutions_guard"();

-- The resolution and the audit's new status are one atomic fact.
CREATE FUNCTION "sc_audit_resolutions_apply"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "audits" SET "status" = NEW."decision"::text::"audit_status", "updated_at" = now() WHERE "id" = NEW."audit_id";
  RETURN NULL;
END $$;

CREATE TRIGGER "audit_resolutions_apply" AFTER INSERT ON "audit_resolutions"
  FOR EACH ROW EXECUTE FUNCTION "sc_audit_resolutions_apply"();

CREATE TRIGGER "audit_resolutions_append_only" BEFORE UPDATE OR DELETE ON "audit_resolutions"
  FOR EACH ROW EXECUTE FUNCTION "sc_append_only"();

-- ───────────────────────── Rework ─────────────────────────

CREATE FUNCTION "sc_reworks_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "audits"%ROWTYPE; c "charts"%ROWTYPE; coder "employees"%ROWTYPE; prj "projects"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'assigned_coder_id', 'remarks', 'completed_at', 'updated_at']) THEN
      RAISE EXCEPTION 'SC409: the chart, audit and reworked version of a rework are immutable' USING ERRCODE = 'SC409';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (
         (OLD."status" = 'OPEN' AND NEW."status" IN ('IN_PROGRESS', 'SUBMITTED'))
      OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'SUBMITTED')
      OR (OLD."status" = 'SUBMITTED' AND NEW."status" = 'CLOSED')
    ) THEN
      RAISE EXCEPTION 'SC409: rework status cannot change from % to %', OLD."status", NEW."status" USING ERRCODE = 'SC409';
    END IF;
    -- A rework is completed by a NEW production version, never by overwriting the old one.
    IF NEW."status" IN ('SUBMITTED', 'CLOSED') AND NOT EXISTS (
         SELECT 1 FROM "production_entries" p WHERE p."rework_id" = NEW."id" AND p."status" = 'SUBMITTED') THEN
      RAISE EXCEPTION 'SC422: a rework is submitted only with the corrected production version it created' USING ERRCODE = 'SC422';
    END IF;
    IF NEW."assigned_coder_id" <> OLD."assigned_coder_id" AND OLD."status" NOT IN ('OPEN', 'IN_PROGRESS') THEN
      RAISE EXCEPTION 'SC409: a finished rework cannot be reassigned' USING ERRCODE = 'SC409';
    END IF;
  ELSE
    SELECT * INTO a FROM "audits" WHERE "id" = NEW."audit_id";
    IF a."id" IS NULL THEN RETURN NEW; END IF; -- missing audit: the foreign key reports it
    IF a."status" <> 'REJECTED' THEN
      RAISE EXCEPTION 'SC409: a rework references an audit the Manager rejected (audit is %)', a."status" USING ERRCODE = 'SC409';
    END IF;
    IF a."chart_id" <> NEW."chart_id" OR a."production_entry_id" <> NEW."production_entry_id" THEN
      RAISE EXCEPTION 'SC422: the rework must reference the chart and production version of the audit that caused it' USING ERRCODE = 'SC422';
    END IF;
    SELECT * INTO c FROM "charts" WHERE "id" = NEW."chart_id";
    IF c."status" NOT IN ('REVIEW_REQUIRED', 'REWORK') THEN
      RAISE EXCEPTION 'SC409: the chart is not awaiting rework (status %)', c."status" USING ERRCODE = 'SC409';
    END IF;
    IF NOT sc_is_active_role(NEW."created_by_id", 'MANAGER', c."organization_id") THEN
      RAISE EXCEPTION 'SC403: only an active Manager creates a rework' USING ERRCODE = 'SC403';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW."assigned_coder_id" <> OLD."assigned_coder_id" THEN
    SELECT * INTO coder FROM "employees" WHERE "id" = NEW."assigned_coder_id";
    SELECT * INTO c FROM "charts" WHERE "id" = NEW."chart_id";
    SELECT * INTO prj FROM "projects" WHERE "id" = c."project_id";
    IF coder."role" <> 'CODER' OR coder."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'SC422: rework is assigned to an ACTIVE CODER' USING ERRCODE = 'SC422';
    END IF;
    IF coder."vendor_id" IS NOT NULL AND prj."vendor_id" IS DISTINCT FROM coder."vendor_id" THEN
      RAISE EXCEPTION 'SC422: vendor coders can only rework their own vendor''s projects' USING ERRCODE = 'SC422';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "reworks_guard" BEFORE INSERT OR UPDATE ON "reworks"
  FOR EACH ROW EXECUTE FUNCTION "sc_reworks_guard"();

-- ───────────────────────── Notifications & approvals ─────────────────────────

CREATE FUNCTION "sc_notifications_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['read_at']) OR OLD."read_at" IS NOT NULL THEN
    RAISE EXCEPTION 'SC409: a notification can only be marked read, once' USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "notifications_guard" BEFORE UPDATE ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "sc_notifications_guard"();

CREATE FUNCTION "sc_approval_requests_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING'
     OR sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'decision', 'decision_comments', 'resolved_by_id', 'resolved_at', 'updated_at']) THEN
    RAISE EXCEPTION 'SC409: only a pending approval request can be resolved, and its subject never changes' USING ERRCODE = 'SC409';
  END IF;
  -- Separation of duties: nobody approves their own request.
  IF NEW."resolved_by_id" IS NOT NULL AND NEW."resolved_by_id" = OLD."requester_id" THEN
    RAISE EXCEPTION 'SC403: a request cannot be resolved by its requester' USING ERRCODE = 'SC403';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "approval_requests_guard" BEFORE UPDATE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION "sc_approval_requests_guard"();

CREATE FUNCTION "sc_approval_steps_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'PENDING'
     OR sc_changed_outside(to_jsonb(OLD), to_jsonb(NEW), ARRAY['status', 'decided_by_id', 'comments', 'decided_at']) THEN
    RAISE EXCEPTION 'SC409: only a pending approval step can be decided' USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "approval_steps_guard" BEFORE UPDATE ON "approval_steps"
  FOR EACH ROW EXECUTE FUNCTION "sc_approval_steps_guard"();

-- ───────────────────────── Append-only history and logs ─────────────────────────

CREATE TRIGGER "activity_logs_append_only" BEFORE UPDATE OR DELETE ON "activity_logs" FOR EACH ROW EXECUTE FUNCTION "sc_append_only"();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "sc_append_only"();
CREATE TRIGGER "chart_status_events_append_only" BEFORE UPDATE OR DELETE ON "chart_status_events" FOR EACH ROW EXECUTE FUNCTION "sc_append_only"();

-- ───────────────────────── Soft-delete strategy: business rows are never deleted ─────────────────────────
-- Deactivate with a status instead. (Credentials, tokens, sessions and notifications remain purgeable for retention.)

CREATE TRIGGER "employees_no_delete" BEFORE DELETE ON "employees" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "vendors_no_delete" BEFORE DELETE ON "vendors" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "teams_no_delete" BEFORE DELETE ON "teams" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "team_memberships_no_delete" BEFORE DELETE ON "team_memberships" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "login_names_no_delete" BEFORE DELETE ON "login_names" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "login_name_assignments_no_delete" BEFORE DELETE ON "login_name_assignments" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "clients_no_delete" BEFORE DELETE ON "clients" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "projects_no_delete" BEFORE DELETE ON "projects" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "project_assignments_no_delete" BEFORE DELETE ON "project_assignments" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "charts_no_delete" BEFORE DELETE ON "charts" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "chart_allocations_no_delete" BEFORE DELETE ON "chart_allocations" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "audits_no_delete" BEFORE DELETE ON "audits" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "reworks_no_delete" BEFORE DELETE ON "reworks" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "approval_requests_no_delete" BEFORE DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();
CREATE TRIGGER "approval_steps_no_delete" BEFORE DELETE ON "approval_steps" FOR EACH ROW EXECUTE FUNCTION "sc_forbid_delete"();

-- History and log tables cannot be emptied either (TRUNCATE bypasses row triggers).
CREATE TRIGGER "activity_logs_no_truncate" BEFORE TRUNCATE ON "activity_logs" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "chart_status_events_no_truncate" BEFORE TRUNCATE ON "chart_status_events" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "chart_allocations_no_truncate" BEFORE TRUNCATE ON "chart_allocations" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "production_entries_no_truncate" BEFORE TRUNCATE ON "production_entries" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "audits_no_truncate" BEFORE TRUNCATE ON "audits" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "audit_resolutions_no_truncate" BEFORE TRUNCATE ON "audit_resolutions" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
CREATE TRIGGER "login_name_assignments_no_truncate" BEFORE TRUNCATE ON "login_name_assignments" FOR EACH STATEMENT EXECUTE FUNCTION "sc_forbid_truncate"();
