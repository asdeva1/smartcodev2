-- Coder module: hold a chart, time spent on a chart (for CPH). Additive only.

ALTER TABLE "charts"
  ADD COLUMN "work_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "held_at" TIMESTAMPTZ(3),
  ADD COLUMN "hold_reason" VARCHAR(500),
  ADD COLUMN "held_seconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "charts"
  ADD CONSTRAINT "charts_hold_chk" CHECK (
    "held_seconds" >= 0
    AND (("held_at" IS NULL AND "hold_reason" IS NULL) OR ("held_at" IS NOT NULL AND "hold_reason" IS NOT NULL))
  );

ALTER TABLE "production_entries" ADD COLUMN "active_seconds" INTEGER;
ALTER TABLE "production_entries"
  ADD CONSTRAINT "production_entries_active_seconds_chk" CHECK ("active_seconds" IS NULL OR "active_seconds" >= 0);

-- Notifications: the coder's bell lists unread ones first.
CREATE INDEX IF NOT EXISTS "notifications_recipient_unread_idx" ON "notifications"("recipient_id", "created_at") WHERE "read_at" IS NULL;
