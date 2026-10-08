import { Injectable } from '@nestjs/common';
import type { ChartLookupRecord } from '@smartcode/shared';
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
}
