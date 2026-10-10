import { Injectable } from '@nestjs/common';
import type { VendorDashboard } from '@smartcode/shared';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import { coderRows } from './coder-rows';
import { ManagerDashboardService } from './manager-dashboard.service';

/**
 * The Vendor Admin's dashboard. Everything is limited to the caller's own vendor (taken from the session; only the Manager may choose one) and the coder table lists only that vendor's coders.
 */
@Injectable()
export class VendorDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ManagerDashboardService,
  ) {}

  async dashboard(principal: Principal, requestedVendorId?: string): Promise<VendorDashboard> {
    // A Vendor Admin is always limited to their own vendor. Only the Manager (organization-wide) may choose one.
    const vendorId = principal.role === 'MANAGER' ? requestedVendorId : (principal.vendorId ?? undefined);
    if (!vendorId) {
      if (principal.role === 'MANAGER')
        throw new ProblemException(422, 'VALIDATION_FAILED', 'Choose a vendor to view.');
      throw new ProblemException(404, 'NOT_FOUND', 'Vendor not found');
    }
    const base = await this.manager.dashboard(principal, { vendorId });
    const coders = await this.prisma.client.employee.findMany({
      where: { vendorId, role: 'CODER', status: 'ACTIVE' },
      select: { id: true },
    });
    return {
      ...base,
      vendor: { id: vendorId, name: base.filter?.name ?? '' },
      coders: await coderRows(
        this.prisma,
        coders.map((c) => c.id),
        base.timeZone,
      ),
    };
  }
}
