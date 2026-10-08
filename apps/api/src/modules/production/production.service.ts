import { Injectable } from '@nestjs/common';
import type { ChartWorkspace, ProductionSubmit, ProductionSubmitted } from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { ProblemException } from '../../core/errors/problem';
import type { Tx } from '../../core/prisma/actor-transaction';
import { PrismaService } from '../../core/prisma/prisma.service';
import { logEntityChange } from '../organization/entity-log';

const notYours = () => new ProblemException(404, 'NOT_FOUND', 'Chart not found');

/**
 * The coder's chart workspace. A chart is opened (ALLOCATED → IN_PRODUCTION) and submitted with ICDs and DOS;
 * Pages come from the allocation file. Submitting records an immutable production version, sends the chart to the
 * audit queue (CODED → PENDING_AUDIT) and so removes it from the coder's allotment and the Manager's open allocation
 * counts, which only count charts still ALLOCATED or IN_PRODUCTION.
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
  ) {}

  /** The coder's own active allocation of this chart, or 404 (another coder's chart looks like a missing one). */
  private async mine(tx: Tx, principal: Principal, chartId: string) {
    const allocation = await tx.chartAllocation.findFirst({
      where: { chartId, status: 'ACTIVE', employeeId: principal.employeeId },
      include: {
        loginName: { select: { value: true } },
        chart: {
          include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
        },
      },
    });
    if (!allocation) throw notYours();
    return allocation;
  }

  private toWorkspace(a: Awaited<ReturnType<ProductionService['mine']>>): ChartWorkspace {
    return {
      id: a.chart.id,
      chartId: a.chart.chartRef,
      status: a.chart.status,
      pages: a.chart.pages,
      pageBucket: a.chart.pageBucket,
      remarks: a.chart.remarks,
      loginName: a.loginName.value,
      project: { id: a.chart.project.id, name: a.chart.project.name, client: a.chart.project.client.name },
    };
  }

  /** Opens the chart: the first open moves it to IN_PRODUCTION. Repeated opens change nothing. */
  async open(principal: Principal, chartId: string): Promise<ChartWorkspace> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Coder opened chart' },
      async (tx) => {
        const a = await this.mine(tx, principal, chartId);
        if (a.chart.status === 'ALLOCATED') {
          await tx.chart.update({ where: { id: chartId }, data: { status: 'IN_PRODUCTION' } });
          a.chart.status = 'IN_PRODUCTION';
        }
        return this.toWorkspace(a);
      },
    );
  }

  async submit(
    principal: Principal,
    chartId: string,
    input: ProductionSubmit,
    meta: RequestMeta,
  ): Promise<ProductionSubmitted> {
    return this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'Coder submitted chart' },
      async (tx) => {
        const a = await this.mine(tx, principal, chartId);
        if (a.chart.status !== 'ALLOCATED' && a.chart.status !== 'IN_PRODUCTION') {
          throw new ProblemException(409, 'INVALID_TRANSITION', 'This chart has already been submitted');
        }
        if (a.chart.status === 'ALLOCATED') {
          await tx.chart.update({ where: { id: chartId }, data: { status: 'IN_PRODUCTION' } });
        }
        const pages = a.chart.pages ?? 0;
        const entry = await tx.productionEntry.create({
          data: {
            chartId,
            coderId: principal.employeeId,
            loginNameId: a.loginNameId,
            allocationId: a.id,
            pageCount: pages,
            icds: input.icds,
            dos: input.dos,
          },
          select: { id: true },
        });
        const now = new Date();
        await tx.productionEntry.update({
          where: { id: entry.id },
          data: { status: 'SUBMITTED', submittedAt: now, codedAt: now },
        });
        await tx.chart.update({ where: { id: chartId }, data: { status: 'CODED', codedAt: now } });
        // 100 % audit coverage (D-02): every coded chart enters the audit queue in the same transaction.
        await tx.chart.update({ where: { id: chartId }, data: { status: 'PENDING_AUDIT' } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'PRODUCTION.SUBMITTED',
          { type: 'Chart', id: chartId },
          { after: { pages, icds: input.icds, dos: input.dos } },
        );
        return {
          chartId: a.chart.chartRef,
          status: 'PENDING_AUDIT',
          icds: input.icds,
          dos: input.dos,
          pages,
        };
      },
    );
  }
}
