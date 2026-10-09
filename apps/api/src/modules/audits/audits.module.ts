import { Module } from '@nestjs/common';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { ReworkService } from './rework.service';

@Module({ controllers: [AuditsController], providers: [AuditsService, ReworkService] })
export class AuditsModule {}
