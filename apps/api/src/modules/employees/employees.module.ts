import { Module } from '@nestjs/common';
import { EmployeeImportService, LoginNameImportService } from './csv-import.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { LoginNamesController } from './login-names.controller';
import { LoginNamesService } from './login-names.service';

@Module({
  controllers: [EmployeesController, LoginNamesController],
  providers: [EmployeesService, LoginNamesService, EmployeeImportService, LoginNameImportService],
  exports: [EmployeesService, LoginNamesService],
})
export class EmployeesModule {}
