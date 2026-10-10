-- Collaboration: channels, direct messages and team channels with their messages. Additive only.

-- CreateEnum
CREATE TYPE "channel_kind" AS ENUM ('PUBLIC', 'PRIVATE', 'DIRECT', 'TEAM');

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "vendor_id" UUID,
    "kind" "channel_kind" NOT NULL,
    "name" VARCHAR(80),
    "topic" VARCHAR(200),
    "team_id" UUID,
    "direct_key" VARCHAR(80),
    "created_by_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_members" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "last_read_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_messages" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channels_team_id_key" ON "channels"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "channels_direct_key_key" ON "channels"("direct_key");

-- CreateIndex
CREATE INDEX "channels_organization_id_kind_archived_at_idx" ON "channels"("organization_id", "kind", "archived_at");

-- CreateIndex
CREATE INDEX "channels_vendor_id_idx" ON "channels"("vendor_id");

-- CreateIndex
CREATE INDEX "channels_created_by_id_idx" ON "channels"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_members_channel_id_employee_id_key" ON "channel_members"("channel_id", "employee_id");

-- CreateIndex
CREATE INDEX "channel_members_employee_id_idx" ON "channel_members"("employee_id");

-- CreateIndex
CREATE INDEX "channel_messages_channel_id_created_at_idx" ON "channel_messages"("channel_id", "created_at");

-- CreateIndex
CREATE INDEX "channel_messages_author_id_idx" ON "channel_messages"("author_id");

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the application also enforces: a channel name is unique within its organization and vendor boundary.
CREATE UNIQUE INDEX "channels_name_unique" ON "channels" ("organization_id", COALESCE("vendor_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"))
  WHERE "kind" IN ('PUBLIC', 'PRIVATE') AND "archived_at" IS NULL;
ALTER TABLE "channels" ADD CONSTRAINT "channels_shape_chk" CHECK (
  ("kind" = 'DIRECT' AND "direct_key" IS NOT NULL AND "team_id" IS NULL)
  OR ("kind" = 'TEAM' AND "team_id" IS NOT NULL AND "direct_key" IS NULL)
  OR ("kind" IN ('PUBLIC', 'PRIVATE') AND "name" IS NOT NULL AND "team_id" IS NULL AND "direct_key" IS NULL)
);
