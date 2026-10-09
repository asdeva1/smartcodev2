-- Visitor Management and Internal Audit (scope D-07 as drafted). Additive only: new enums and tables.

-- CreateEnum
CREATE TYPE "visit_status" AS ENUM ('EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "internal_review_outcome" AS ENUM ('AGREE', 'DISAGREE');

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "company" VARCHAR(200),
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "visitor_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "purpose" VARCHAR(300) NOT NULL,
    "expected_at" TIMESTAMPTZ(3),
    "status" "visit_status" NOT NULL DEFAULT 'EXPECTED',
    "badge_number" VARCHAR(32),
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by_id" UUID,
    "checked_out_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(500),
    "registered_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_audit_reviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "auditor_errors" INTEGER NOT NULL,
    "independent_errors" INTEGER NOT NULL,
    "outcome" "internal_review_outcome" NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "internal_audit_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitors_organization_id_full_name_idx" ON "visitors"("organization_id", "full_name");

-- CreateIndex
CREATE INDEX "visits_organization_id_status_created_at_idx" ON "visits"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "visits_visitor_id_idx" ON "visits"("visitor_id");

-- CreateIndex
CREATE INDEX "visits_host_id_idx" ON "visits"("host_id");

-- CreateIndex
CREATE INDEX "visits_registered_by_id_idx" ON "visits"("registered_by_id");

-- CreateIndex
CREATE INDEX "visits_checked_in_by_id_idx" ON "visits"("checked_in_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "internal_audit_reviews_audit_id_key" ON "internal_audit_reviews"("audit_id");

-- CreateIndex
CREATE INDEX "internal_audit_reviews_organization_id_created_at_idx" ON "internal_audit_reviews"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "internal_audit_reviews_reviewer_id_idx" ON "internal_audit_reviews"("reviewer_id");

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_checked_in_by_id_fkey" FOREIGN KEY ("checked_in_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_reviews" ADD CONSTRAINT "internal_audit_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_reviews" ADD CONSTRAINT "internal_audit_reviews_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_audit_reviews" ADD CONSTRAINT "internal_audit_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity (hand-written, like the other CHECKs): a visit's times and badge must agree with its status.
ALTER TABLE "visits"
  ADD CONSTRAINT "visits_status_chk" CHECK (
    ("status" IN ('EXPECTED', 'CANCELLED') AND "checked_in_at" IS NULL AND "checked_out_at" IS NULL AND "badge_number" IS NULL)
    OR ("status" = 'CHECKED_IN' AND "checked_in_at" IS NOT NULL AND "checked_in_by_id" IS NOT NULL AND "badge_number" IS NOT NULL AND "checked_out_at" IS NULL)
    OR ("status" = 'CHECKED_OUT' AND "checked_in_at" IS NOT NULL AND "badge_number" IS NOT NULL AND "checked_out_at" IS NOT NULL AND "checked_out_at" >= "checked_in_at")
  );
CREATE UNIQUE INDEX "visits_badge_number_unique" ON "visits"("organization_id", "badge_number") WHERE "badge_number" IS NOT NULL;

-- Internal audit: counts are not negative and the outcome follows from them (AGREE exactly when they are equal).
ALTER TABLE "internal_audit_reviews"
  ADD CONSTRAINT "internal_audit_reviews_counts_chk" CHECK ("auditor_errors" >= 0 AND "independent_errors" >= 0),
  ADD CONSTRAINT "internal_audit_reviews_outcome_chk" CHECK (
    ("outcome" = 'AGREE') = ("auditor_errors" = "independent_errors")
  );
