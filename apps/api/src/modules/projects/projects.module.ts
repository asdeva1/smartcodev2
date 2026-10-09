import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ChartRepositoryService } from './chart-repository.service';
import { ChartsController } from './charts.controller';
import { ProjectAllocationService } from './project-allocation.service';
import { ProjectReportsService } from './project-reports.service';
import { ReportExportService } from './report-export.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [EmployeesModule],
  controllers: [ProjectsController, ChartsController],
  providers: [
    ProjectsService,
    ProjectAllocationService,
    ProjectReportsService,
    ReportExportService,
    ChartRepositoryService,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
