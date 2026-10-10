import { Module } from '@nestjs/common';
import { InternalAuditController } from './internal-audit.controller';
import { InternalAuditService } from './internal-audit.service';

@Module({ controllers: [InternalAuditController], providers: [InternalAuditService] })
export class InternalAuditModule {}
