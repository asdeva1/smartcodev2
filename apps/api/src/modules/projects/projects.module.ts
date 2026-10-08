import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ProjectAllocationService } from './project-allocation.service';
import { ProjectReportsService } from './project-reports.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [EmployeesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAllocationService, ProjectReportsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
