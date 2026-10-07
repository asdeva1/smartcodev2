-- Phase 3 — Login Name eligibility, role-change handling and last-Manager protection.
--
-- Decision (Phase 3): a SmartClues Login Name is an operational identifier for people who take part in
-- production/audit work. Eligible roles: CODER, AUDITOR, TEAM_LEAD, GROUP_COACH. MANAGER, HR and VENDOR_ADMIN
-- never hold one. Only an ACTIVE employee can receive one. Authentication stays EMAIL + PASSWORD.

-- ───────── Login Name assignment: ACTIVE employee + eligible role + Manager ─────────

CREATE OR REPLACE FUNCTION "sc_login_name_assignments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF emp."organization_id" <> ln."organization_id" THEN
    RAISE EXCEPTION 'SC422: the employee is not eligible for a login name' USING ERRCODE = 'SC422';
  END IF;
  IF emp."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'SC422: only an ACTIVE employee can receive a login name (this employee is %)', emp."status" USING ERRCODE = 'SC422';
  END IF;
  IF emp."role" NOT IN ('CODER', 'AUDITOR', 'TEAM_LEAD', 'GROUP_COACH') THEN
    RAISE EXCEPTION 'SC422: the % role is not eligible for a SmartClues login name', emp."role" USING ERRCODE = 'SC422';
  END IF;
  -- Manager controls assignment.
  IF NOT sc_is_active_role(NEW."assigned_by_id", 'MANAGER', ln."organization_id") THEN
    RAISE EXCEPTION 'SC403: only an active Manager can assign a login name' USING ERRCODE = 'SC403';
  END IF;
  RETURN NEW;
END $$;

-- ───────── Last active Manager is protected ─────────

CREATE FUNCTION "sc_last_manager_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."role" = 'MANAGER' AND OLD."status" = 'ACTIVE' AND (NEW."role" <> 'MANAGER' OR NEW."status" <> 'ACTIVE') THEN
    -- Serialise concurrent demotions/deactivations within the organization.
    PERFORM pg_advisory_xact_lock(hashtext('sc_last_manager:' || OLD."organization_id"::text));
    IF NOT EXISTS (
      SELECT 1 FROM "employees" e
      WHERE e."organization_id" = OLD."organization_id" AND e."role" = 'MANAGER' AND e."status" = 'ACTIVE' AND e."id" <> OLD."id"
    ) THEN
      RAISE EXCEPTION 'SC409: the last active Manager cannot be deactivated or changed to another role' USING ERRCODE = 'SC409';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "employees_last_manager_guard" BEFORE UPDATE OF "role", "status" ON "employees"
  FOR EACH ROW EXECUTE FUNCTION "sc_last_manager_guard"();

-- ───────── Role change: explicit handling of everything the old role owned ─────────
-- Refuses while the person still owns work that the new role could not own (SC409, "reallocate first"), and
-- otherwise ends the open Login Name / project-staff rows with an explicit reason. History is never deleted.

CREATE FUNCTION "sc_employee_role_changed_before"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" = OLD."role" THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM "chart_allocations" a WHERE a."employee_id" = OLD."id" AND a."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'SC409: this employee still holds allocated charts — reallocate them before changing the role' USING ERRCODE = 'SC409';
  END IF;
  IF EXISTS (SELECT 1 FROM "reworks" r WHERE r."assigned_coder_id" = OLD."id" AND r."status" IN ('OPEN', 'IN_PROGRESS')) THEN
    RAISE EXCEPTION 'SC409: this employee still has open rework — complete or reassign it before changing the role' USING ERRCODE = 'SC409';
  END IF;
  IF OLD."role" = 'TEAM_LEAD' AND EXISTS (SELECT 1 FROM "teams" t WHERE t."team_lead_id" = OLD."id" AND t."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'SC409: this employee leads an active team — assign another Team Lead before changing the role' USING ERRCODE = 'SC409';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "employees_role_changed_before" BEFORE UPDATE OF "role" ON "employees"
  FOR EACH ROW WHEN (NEW."role" IS DISTINCT FROM OLD."role")
  EXECUTE FUNCTION "sc_employee_role_changed_before"();

CREATE FUNCTION "sc_employee_role_changed_after"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A role that cannot hold a Login Name must not leave one silently usable.
  IF NEW."role" NOT IN ('CODER', 'AUDITOR', 'TEAM_LEAD', 'GROUP_COACH') THEN
    UPDATE "login_name_assignments"
       SET "ended_at" = now(), "end_reason" = 'ROLE_CHANGED'
     WHERE "employee_id" = NEW."id" AND "ended_at" IS NULL;
  END IF;
  -- Open project staffing was recorded for the old role.
  UPDATE "project_assignments"
     SET "ended_at" = now()
   WHERE "employee_id" = NEW."id" AND "ended_at" IS NULL AND "project_role"::text <> NEW."role"::text;
  RETURN NULL;
END $$;

CREATE TRIGGER "employees_role_changed_after" AFTER UPDATE OF "role" ON "employees"
  FOR EACH ROW WHEN (NEW."role" IS DISTINCT FROM OLD."role")
  EXECUTE FUNCTION "sc_employee_role_changed_after"();
