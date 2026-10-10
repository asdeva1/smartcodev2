import { Module } from '@nestjs/common';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';

@Module({ controllers: [VisitorsController], providers: [VisitorsService] })
export class VisitorsModule {}
