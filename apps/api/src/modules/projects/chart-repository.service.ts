import { Injectable } from '@nestjs/common';
import type { ChartRepositoryPage, ChartRepositoryQuery, ChartTimeline } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { projectScopeWhere } from './project-scope';

/**
 * The chart repository: charts across every project the caller can see (Manager: all, Vendor Admin: own vendor,
 * everyone else: projects they are staffed on). A Coder sees only the charts they hold; a chart outside the scope is
 * "not found", never "forbidden".
 */
@Injectable()
export class ChartRepositoryService {
  constructor(private readonly prisma: PrismaService) {}

  private scope(principal: Principal, history = false): Prisma.ChartWhereInput {
    const filters: Prisma.ChartWhereInput[] = [{ project: { is: projectScopeWhere(principal) } }];
    if (principal.role === 'CODER') {
      filters.push({
        allocations: {
          some: { employeeId: principal.employeeId, ...(history ? {} : { status: 'ACTIVE' as const }) },
        },
      });
    }
    return { AND: filters };
  }

  async list(principal: Principal, query: ChartRepositoryQuery): Promise<ChartRepositoryPage> {
    const db = this.prisma.client;
    const base: Prisma.ChartWhereInput[] = [this.scope(principal)];
    if (query.projectId) base.push({ projectId: query.projectId });
    if (query.q) base.push({ chartRef: { contains: query.q, mode: 'insensitive' } });
    const where: Prisma.ChartWhereInput = {
      AND: [...base, ...(query.status ? [{ status: query.status as never }] : [])],
    };
    const [total, rows, counts] = await db.$transaction([
      db.chart.count({ where }),
      db.chart.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          project: { select: { id: true, name: true, client: { select: { name: true } } } },
          allocations: {
            where: { status: 'ACTIVE' },
            take: 1,
            include: {
              loginName: { select: { value: true } },
              employee: { select: { id: true, fullName: true } },
            },
          },
        },
      }),
      db.chart.groupBy({
        by: ['status'],
        where: { AND: base },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const statusCounts: Record<string, number> = {};
    for (const c of counts) statusCounts[c.status] = (c._count as { _all: number })._all;
    return {
      items: rows.map((c) => {
        const a = c.allocations[0];
        return {
          id: c.id,
          chartId: c.chartRef,
          status: c.status,
          pages: c.pages,
          pageBucket: c.pageBucket,
          project: { id: c.project.id, name: c.project.name, client: c.project.client.name },
          coder: a
            ? { id: a.employee.id, fullName: a.employee.fullName, loginName: a.loginName.value }
            : null,
          updatedAt: c.updatedAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
      statusCounts,
    };
  }

  async timeline(principal: Principal, id: string): Promise<ChartTimeline> {
    const db = this.prisma.client;
    const chart = await db.chart.findFirst({
      where: { AND: [{ id }, this.scope(principal, true)] },
      select: {
        id: true,
        chartRef: true,
        status: true,
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
      },
    });
    if (!chart) throw new ProblemException(404, 'NOT_FOUND', 'Chart not found');
    const events = await db.chartStatusEvent.findMany({
      where: { chartId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        fromStatus: true,
        toStatus: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true } },
      },
    });
    return {
      chart: {
        id: chart.id,
        chartId: chart.chartRef,
        status: chart.status,
        project: { id: chart.project.id, name: chart.project.name, client: chart.project.client.name },
      },
      events: events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: e.actor,
        reason: e.reason,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
