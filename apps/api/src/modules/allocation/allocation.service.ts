import { Injectable } from '@nestjs/common';
import type { ChartLookupRecord, MyAllotment } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Chart Allocation (Manager). This step: look a Chart ID up and show who holds it. The allocation engine itself
 * (manual / CSV / automatic) arrives in Phase 7 and writes the same `chart_allocations` rows this reads.
 */
@Injectable()
export class AllocationService {
  constructor(private readonly prisma: PrismaService) {}

  async searchCharts(principal: Principal, q: string): Promise<ChartLookupRecord[]> {
    const rows = await this.prisma.client.chart.findMany({
      where: {
        organizationId: principal.organizationId,
        chartRef: { contains: q, mode: 'insensitive' },
      },
      include: {
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        allocations: {
          where: { status: 'ACTIVE' },
          take: 1,
          include: {
            loginName: { select: { value: true } },
            employee: { select: { id: true, fullName: true, email: true } },
            allocatedBy: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: [{ chartRef: 'asc' }],
      take: 50,
    });
    const exact = q.toLowerCase();
    return rows
      .sort((a, b) => Number(b.chartRef.toLowerCase() === exact) - Number(a.chartRef.toLowerCase() === exact))
      .map((chart) => {
        const a = chart.allocations[0];
        return {
          chartId: chart.chartRef,
          project: { id: chart.project.id, name: chart.project.name, client: chart.project.client.name },
          status: chart.status,
          allocation: a
            ? {
                loginName: a.loginName.value,
                assignedTo: a.employee,
                allocatedBy: a.allocatedBy,
                allocatedAt: a.allocatedAt.toISOString(),
              }
            : null,
        };
      });
  }

  /** Charts the signed-in coder currently holds (ALLOCATED or IN_PRODUCTION), newest allocation first. */
  async myAllotment(principal: Principal): Promise<MyAllotment> {
    if (principal.role !== 'CODER') return { loginName: null, total: 0, charts: [] };
    const [name, rows] = await Promise.all([
      this.prisma.client.loginNameAssignment.findFirst({
        where: { employeeId: principal.employeeId, endedAt: null },
        select: { loginName: { select: { value: true } } },
      }),
      this.prisma.client.chartAllocation.findMany({
        where: {
          employeeId: principal.employeeId,
          status: 'ACTIVE',
          chart: { status: { in: ['ALLOCATED', 'IN_PRODUCTION'] } },
        },
        orderBy: [{ allocatedAt: 'desc' }, { id: 'asc' }],
        take: 500,
        include: {
          loginName: { select: { value: true } },
          chart: {
            include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
          },
        },
      }),
    ]);
    return {
      loginName: name?.loginName.value ?? null,
      total: rows.length,
      charts: rows.map((a) => ({
        id: a.chart.id,
        chartId: a.chart.chartRef,
        status: a.chart.status,
        pages: a.chart.pages,
        pageBucket: a.chart.pageBucket,
        remarks: a.chart.remarks,
        loginName: a.loginName.value,
        allocatedAt: a.allocatedAt.toISOString(),
        project: { id: a.chart.project.id, name: a.chart.project.name, client: a.chart.project.client.name },
      })),
    };
  }
}
