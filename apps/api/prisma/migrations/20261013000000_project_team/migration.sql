-- A project is worked by one team. The team's Team Lead, Coders and Group Coaches become the project's staff;
-- staff rows created from the team are marked with via_team_id. Additive only.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "team_id" UUID,
ADD COLUMN "team_assigned_by_id" UUID;

-- AlterTable
ALTER TABLE "project_assignments" ADD COLUMN "via_team_id" UUID;

-- CreateIndex
CREATE INDEX "projects_team_id_idx" ON "projects"("team_id");

-- CreateIndex
CREATE INDEX "projects_team_assigned_by_id_idx" ON "projects"("team_assigned_by_id");

-- CreateIndex
CREATE INDEX "project_assignments_via_team_id_idx" ON "project_assignments"("via_team_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_assigned_by_id_fkey" FOREIGN KEY ("team_assigned_by_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_via_team_id_fkey" FOREIGN KEY ("via_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
