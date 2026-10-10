import { Injectable } from '@nestjs/common';
import type { ReworkList, ReworkSubmit, ReworkSubmitted } from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { logEntityChange } from '../organization/entity-log';

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Rework not found');

/** The coder's rework list. The correction is a NEW production version; the audited version stays as history. */
@Injectable()
export class ReworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  async mine(principal: Principal): Promise<ReworkList> {
    const reworks = await this.prisma.client.rework.findMany({
      where: {
        assignedCoderId: principal.employeeId,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        chart: { organizationId: principal.organizationId },
      },
      include: {
        productionEntry: { select: { icds: true, dos: true } },
        chart: {
          select: {
            chartRef: true,
            pages: true,
            project: { select: { id: true, name: true, client: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const items = reworks.map((r) => ({
      id: r.id,
      chartId: r.chart.chartRef,
      chart: r.chartId,
      status: r.status,
      reason: r.reason,
      project: { id: r.chart.project.id, name: r.chart.project.name, client: r.chart.project.client.name },
      pages: r.chart.pages,
      previousIcds: r.productionEntry.icds,
      previousDos: r.productionEntry.dos,
      assignedAt: r.createdAt.toISOString(),
    }));
    return { total: items.length, items };
  }

  async submit(
    principal: Principal,
    reworkId: string,
    input: ReworkSubmit,
    meta: RequestMeta,
  ): Promise<ReworkSubmitted> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Rework submitted' },
      async (tx) => {
        const rework = await tx.rework.findFirst({
          where: { id: reworkId, assignedCoderId: principal.employeeId },
          include: {
            productionEntry: true,
            chart: { select: { id: true, chartRef: true, status: true, pages: true } },
          },
        });
        if (!rework) throw notFound();
        if (rework.status !== 'OPEN' && rework.status !== 'IN_PROGRESS') {
          throw new ProblemException(409, 'INVALID_TRANSITION', 'This rework has already been submitted');
        }
        if (rework.chart.status !== 'REWORK') {
          throw new ProblemException(409, 'INVALID_TRANSITION', 'This chart is not waiting for rework');
        }
        const previous = rework.productionEntry;
        // The earlier version stays as history; only one version is current.
        await tx.productionEntry.update({
          where: { id: previous.id },
          data: { status: 'SUPERSEDED', isCurrent: false },
        });
        const entry = await tx.productionEntry.create({
          data: {
            chartId: rework.chartId,
            coderId: principal.employeeId,
            loginNameId: previous.loginNameId,
            allocationId: previous.allocationId,
            pageCount: previous.pageCount,
            icds: input.icds,
            dos: input.dos,
            reworkId: rework.id,
          },
          select: { id: true },
        });
        const now = new Date();
        await tx.productionEntry.update({
          where: { id: entry.id },
          data: { status: 'SUBMITTED', submittedAt: now, codedAt: now },
        });
        await tx.rework.update({ where: { id: rework.id }, data: { status: 'SUBMITTED', completedAt: now } });
        await tx.chart.update({ where: { id: rework.chartId }, data: { status: 'RE_AUDIT' } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'REWORK.SUBMITTED',
          { type: 'Chart', id: rework.chartId },
          { after: { icds: input.icds, dos: input.dos } },
        );
        return { chartId: rework.chart.chartRef, status: 'RE_AUDIT', icds: input.icds, dos: input.dos };
      },
    );
  }
}
