import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ProjectAllocationService } from './project-allocation.service';
import { ProjectReportsService } from './project-reports.service';
import { ReportExportService } from './report-export.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [EmployeesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAllocationService, ProjectReportsService, ReportExportService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
