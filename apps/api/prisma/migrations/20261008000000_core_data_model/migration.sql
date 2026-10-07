-- Phase 2 — core data model: enums, tables, indexes and foreign keys (Prisma-managed structure).
-- Constraints Prisma cannot express are in the two migrations that follow this one:
--   20261008000100_integrity_constraints   partial / expression unique indexes, CHECK constraints, reference data
--   20261008000200_integrity_triggers      status transitions, append-only history, Manager-only resolution, totals

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('MANAGER', 'HR', 'GROUP_COACH', 'TEAM_LEAD', 'AUDITOR', 'CODER', 'VENDOR_ADMIN');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "active_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "allocation_type" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "project_role" AS ENUM ('TEAM_LEAD', 'AUDITOR', 'CODER', 'GROUP_COACH');

-- CreateEnum
CREATE TYPE "auth_token_type" AS ENUM ('ACTIVATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "login_name_end_reason" AS ENUM ('REASSIGNED', 'DEACTIVATED', 'EMPLOYEE_INACTIVE');

-- CreateEnum
CREATE TYPE "chart_status" AS ENUM ('PENDING_ALLOCATION', 'ALLOCATED', 'IN_PRODUCTION', 'CODED', 'PENDING_AUDIT', 'REVIEW_REQUIRED', 'REWORK', 'RE_AUDIT', 'AUDITED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "allocation_source" AS ENUM ('MANUAL', 'CSV', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "allocation_status" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "assignment_end_reason" AS ENUM ('REALLOCATED', 'DEALLOCATED', 'EMPLOYEE_INACTIVE');

-- CreateEnum
CREATE TYPE "production_status" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('PASS', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "audit_status" AS ENUM ('IN_PROGRESS', 'PASSED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "resolution_decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "rework_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_code" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "role" NOT NULL,
    "status" "employee_status" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "vendor_id" UUID,
    "created_by_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "auth_token_type" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "issued_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "family_id" UUID NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "active_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "status" "active_status" NOT NULL DEFAULT 'ACTIVE',
    "team_lead_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_names" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "status" "active_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_name_assignments" (
    "id" UUID NOT NULL,
    "login_name_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "login_name_end_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_name_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "active_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "allocation_type" "allocation_type" NOT NULL DEFAULT 'MANUAL',
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "vendor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_assignments" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "project_role" "project_role" NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chart_ref" VARCHAR(128) NOT NULL,
    "status" "chart_status" NOT NULL DEFAULT 'PENDING_ALLOCATION',
    "allocated_at" TIMESTAMPTZ(3),
    "coded_at" TIMESTAMPTZ(3),
    "audited_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "rework_cycle" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_status_transitions" (
    "from_status" "chart_status" NOT NULL,
    "to_status" "chart_status" NOT NULL,

    CONSTRAINT "chart_status_transitions_pkey" PRIMARY KEY ("from_status","to_status")
);

-- CreateTable
CREATE TABLE "chart_status_events" (
    "id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "from_status" "chart_status",
    "to_status" "chart_status" NOT NULL,
    "actor_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chart_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_allocations" (
    "id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "login_name_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "allocated_by_id" UUID NOT NULL,
    "source" "allocation_source" NOT NULL,
    "status" "allocation_status" NOT NULL DEFAULT 'ACTIVE',
    "allocated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "assignment_end_reason",
    "ended_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chart_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_entries" (
    "id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "status" "production_status" NOT NULL DEFAULT 'DRAFT',
    "coder_id" UUID NOT NULL,
    "login_name_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "page_count" INTEGER NOT NULL,
    "icds" INTEGER NOT NULL,
    "dos" INTEGER NOT NULL,
    "coded_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "remarks" TEXT,
    "rework_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "production_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "production_entry_id" UUID NOT NULL,
    "auditor_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "is_re_audit" BOOLEAN NOT NULL DEFAULT false,
    "previous_audit_id" UUID,
    "audited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audit_errors" INTEGER NOT NULL,
    "error_exceptions" INTEGER NOT NULL,
    "total_errors" INTEGER NOT NULL DEFAULT 0,
    "result" "audit_result",
    "status" "audit_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_resolutions" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "decision" "resolution_decision" NOT NULL,
    "reason" TEXT,
    "resolved_by_id" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approval_request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reworks" (
    "id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "production_entry_id" UUID NOT NULL,
    "assigned_coder_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "status" "rework_status" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "message" TEXT,
    "entity_type" VARCHAR(64),
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "decision" "resolution_decision",
    "comments" TEXT,
    "decision_comments" TEXT,
    "payload" JSONB,
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_id" UUID,
    "approver_role" "role",
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "decided_by_id" UUID,
    "comments" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" "role",
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" UUID,
    "outcome" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "before_data" JSONB,
    "after_data" JSONB,
    "ip_address" VARCHAR(64),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_organization_id_role_status_idx" ON "employees"("organization_id", "role", "status");

-- CreateIndex
CREATE INDEX "employees_vendor_id_status_idx" ON "employees"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "employees_created_by_id_idx" ON "employees"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_employee_code_key" ON "employees"("organization_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_employee_id_key" ON "credentials"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_employee_id_type_idx" ON "auth_tokens"("employee_id", "type");

-- CreateIndex
CREATE INDEX "auth_tokens_issued_by_id_idx" ON "auth_tokens"("issued_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_employee_id_idx" ON "sessions"("employee_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "vendors_organization_id_status_idx" ON "vendors"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organization_id_code_key" ON "vendors"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_organization_id_id_key" ON "vendors"("organization_id", "id");

-- CreateIndex
CREATE INDEX "teams_organization_id_status_idx" ON "teams"("organization_id", "status");

-- CreateIndex
CREATE INDEX "teams_vendor_id_status_idx" ON "teams"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "teams_team_lead_id_idx" ON "teams"("team_lead_id");

-- CreateIndex
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships"("team_id");

-- CreateIndex
CREATE INDEX "team_memberships_employee_id_idx" ON "team_memberships"("employee_id");

-- CreateIndex
CREATE INDEX "team_memberships_created_by_id_idx" ON "team_memberships"("created_by_id");

-- CreateIndex
CREATE INDEX "login_names_organization_id_status_idx" ON "login_names"("organization_id", "status");

-- CreateIndex
CREATE INDEX "login_names_created_by_id_idx" ON "login_names"("created_by_id");

-- CreateIndex
CREATE INDEX "login_name_assignments_login_name_id_idx" ON "login_name_assignments"("login_name_id");

-- CreateIndex
CREATE INDEX "login_name_assignments_employee_id_idx" ON "login_name_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "login_name_assignments_assigned_by_id_idx" ON "login_name_assignments"("assigned_by_id");

-- CreateIndex
CREATE INDEX "clients_organization_id_status_idx" ON "clients"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_id_key" ON "clients"("organization_id", "id");

-- CreateIndex
CREATE INDEX "projects_client_id_idx" ON "projects"("client_id");

-- CreateIndex
CREATE INDEX "projects_vendor_id_status_idx" ON "projects"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_id_key" ON "projects"("organization_id", "id");

-- CreateIndex
CREATE INDEX "project_assignments_project_id_idx" ON "project_assignments"("project_id");

-- CreateIndex
CREATE INDEX "project_assignments_employee_id_idx" ON "project_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "project_assignments_assigned_by_id_idx" ON "project_assignments"("assigned_by_id");

-- CreateIndex
CREATE INDEX "charts_project_id_status_idx" ON "charts"("project_id", "status");

-- CreateIndex
CREATE INDEX "charts_status_updated_at_idx" ON "charts"("status", "updated_at");

-- CreateIndex
CREATE INDEX "charts_organization_id_idx" ON "charts"("organization_id");

-- CreateIndex
CREATE INDEX "charts_created_by_id_idx" ON "charts"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "charts_project_id_chart_ref_key" ON "charts"("project_id", "chart_ref");

-- CreateIndex
CREATE INDEX "chart_status_events_chart_id_created_at_idx" ON "chart_status_events"("chart_id", "created_at");

-- CreateIndex
CREATE INDEX "chart_status_events_actor_id_idx" ON "chart_status_events"("actor_id");

-- CreateIndex
CREATE INDEX "chart_allocations_chart_id_idx" ON "chart_allocations"("chart_id");

-- CreateIndex
CREATE INDEX "chart_allocations_login_name_id_idx" ON "chart_allocations"("login_name_id");

-- CreateIndex
CREATE INDEX "chart_allocations_employee_id_idx" ON "chart_allocations"("employee_id");

-- CreateIndex
CREATE INDEX "chart_allocations_allocated_by_id_idx" ON "chart_allocations"("allocated_by_id");

-- CreateIndex
CREATE INDEX "chart_allocations_ended_by_id_idx" ON "chart_allocations"("ended_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_entries_rework_id_key" ON "production_entries"("rework_id");

-- CreateIndex
CREATE INDEX "production_entries_chart_id_idx" ON "production_entries"("chart_id");

-- CreateIndex
CREATE INDEX "production_entries_coder_id_idx" ON "production_entries"("coder_id");

-- CreateIndex
CREATE INDEX "production_entries_login_name_id_idx" ON "production_entries"("login_name_id");

-- CreateIndex
CREATE INDEX "production_entries_allocation_id_idx" ON "production_entries"("allocation_id");

-- CreateIndex
CREATE INDEX "production_entries_submitted_at_idx" ON "production_entries"("submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_entries_chart_id_version_key" ON "production_entries"("chart_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "audits_production_entry_id_key" ON "audits"("production_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "audits_previous_audit_id_key" ON "audits"("previous_audit_id");

-- CreateIndex
CREATE INDEX "audits_chart_id_idx" ON "audits"("chart_id");

-- CreateIndex
CREATE INDEX "audits_auditor_id_idx" ON "audits"("auditor_id");

-- CreateIndex
CREATE INDEX "audits_status_created_at_idx" ON "audits"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audits_chart_id_sequence_key" ON "audits"("chart_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "audit_resolutions_audit_id_key" ON "audit_resolutions"("audit_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_resolutions_approval_request_id_key" ON "audit_resolutions"("approval_request_id");

-- CreateIndex
CREATE INDEX "audit_resolutions_resolved_by_id_idx" ON "audit_resolutions"("resolved_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "reworks_audit_id_key" ON "reworks"("audit_id");

-- CreateIndex
CREATE INDEX "reworks_chart_id_idx" ON "reworks"("chart_id");

-- CreateIndex
CREATE INDEX "reworks_production_entry_id_idx" ON "reworks"("production_entry_id");

-- CreateIndex
CREATE INDEX "reworks_assigned_coder_id_idx" ON "reworks"("assigned_coder_id");

-- CreateIndex
CREATE INDEX "reworks_created_by_id_idx" ON "reworks"("created_by_id");

-- CreateIndex
CREATE INDEX "reworks_status_idx" ON "reworks"("status");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_idx" ON "approval_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_entity_type_entity_id_idx" ON "approval_requests"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "approval_requests_requester_id_idx" ON "approval_requests"("requester_id");

-- CreateIndex
CREATE INDEX "approval_requests_resolved_by_id_idx" ON "approval_requests"("resolved_by_id");

-- CreateIndex
CREATE INDEX "approval_steps_approver_id_idx" ON "approval_steps"("approver_id");

-- CreateIndex
CREATE INDEX "approval_steps_decided_by_id_idx" ON "approval_steps"("decided_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_request_id_step_order_key" ON "approval_steps"("request_id", "step_order");

-- CreateIndex
CREATE INDEX "activity_logs_organization_id_created_at_idx" ON "activity_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_idx" ON "activity_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_actor_id_created_at_idx" ON "activity_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_vendor_id_fkey" FOREIGN KEY ("organization_id", "vendor_id") REFERENCES "vendors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_vendor_id_fkey" FOREIGN KEY ("organization_id", "vendor_id") REFERENCES "vendors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_team_lead_id_fkey" FOREIGN KEY ("team_lead_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_names" ADD CONSTRAINT "login_names_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_names" ADD CONSTRAINT "login_names_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_name_assignments" ADD CONSTRAINT "login_name_assignments_login_name_id_fkey" FOREIGN KEY ("login_name_id") REFERENCES "login_names"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_name_assignments" ADD CONSTRAINT "login_name_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_name_assignments" ADD CONSTRAINT "login_name_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_vendor_id_fkey" FOREIGN KEY ("organization_id", "vendor_id") REFERENCES "vendors"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts" ADD CONSTRAINT "charts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts" ADD CONSTRAINT "charts_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charts" ADD CONSTRAINT "charts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_status_events" ADD CONSTRAINT "chart_status_events_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_status_events" ADD CONSTRAINT "chart_status_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_allocations" ADD CONSTRAINT "chart_allocations_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_allocations" ADD CONSTRAINT "chart_allocations_login_name_id_fkey" FOREIGN KEY ("login_name_id") REFERENCES "login_names"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_allocations" ADD CONSTRAINT "chart_allocations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_allocations" ADD CONSTRAINT "chart_allocations_allocated_by_id_fkey" FOREIGN KEY ("allocated_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_allocations" ADD CONSTRAINT "chart_allocations_ended_by_id_fkey" FOREIGN KEY ("ended_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_coder_id_fkey" FOREIGN KEY ("coder_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_login_name_id_fkey" FOREIGN KEY ("login_name_id") REFERENCES "login_names"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "chart_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_entries" ADD CONSTRAINT "production_entries_rework_id_fkey" FOREIGN KEY ("rework_id") REFERENCES "reworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_production_entry_id_fkey" FOREIGN KEY ("production_entry_id") REFERENCES "production_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_auditor_id_fkey" FOREIGN KEY ("auditor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_previous_audit_id_fkey" FOREIGN KEY ("previous_audit_id") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_resolutions" ADD CONSTRAINT "audit_resolutions_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_resolutions" ADD CONSTRAINT "audit_resolutions_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_resolutions" ADD CONSTRAINT "audit_resolutions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_production_entry_id_fkey" FOREIGN KEY ("production_entry_id") REFERENCES "production_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_assigned_coder_id_fkey" FOREIGN KEY ("assigned_coder_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reworks" ADD CONSTRAINT "reworks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
