-- Phase 5: Projects. Allocation-file columns on charts, "submitted to client" and the client pull-back marker.

ALTER TABLE "charts"
  ADD COLUMN "pages" INTEGER,
  ADD COLUMN "page_bucket" VARCHAR(64),
  ADD COLUMN "remarks" TEXT,
  ADD COLUMN "submitted_to_client_at" TIMESTAMPTZ(3),
  ADD COLUMN "submitted_to_client_by_id" UUID;

ALTER TABLE "projects" ADD COLUMN "client_pullback_at" TIMESTAMPTZ(3);

CREATE INDEX "charts_submitted_to_client_by_id_idx" ON "charts"("submitted_to_client_by_id");

ALTER TABLE "charts" ADD CONSTRAINT "charts_submitted_to_client_by_id_fkey"
  FOREIGN KEY ("submitted_to_client_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only a finished chart can be handed back to the client, and page counts are never negative.
ALTER TABLE "charts"
  ADD CONSTRAINT "charts_pages_chk" CHECK ("pages" IS NULL OR "pages" >= 0),
  ADD CONSTRAINT "charts_submitted_to_client_chk" CHECK (
    ("submitted_to_client_at" IS NULL AND "submitted_to_client_by_id" IS NULL)
    OR ("status" = 'COMPLETED' AND "submitted_to_client_at" IS NOT NULL)
  );
