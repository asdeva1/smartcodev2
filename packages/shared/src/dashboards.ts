import { z } from 'zod';

/** Dashboards (Phase 11). The Manager sees in-house and vendor work combined, or one vendor / in-house only. */

export const IN_HOUSE_FILTER = 'IN_HOUSE' as const;

export const managerDashboardQuerySchema = z.object({
  /** A vendor id, or "IN_HOUSE" for work done by SmartClues' own staff. Leave out for everything. */
  vendorId: z.union([z.uuid(), z.literal(IN_HOUSE_FILTER)]).optional(),
});
export type ManagerDashboardQuery = z.infer<typeof managerDashboardQuerySchema>;

export interface ProductionFigures {
  charts: number;
  pages: number;
  icds: number;
  dos: number;
}

export interface VendorPerformanceRow {
  /** null = in-house. */
  vendorId: string | null;
  name: string;
  activeCoders: number;
  chartsToday: number;
  chartsMonth: number;
  pagesMonth: number;
  cph: number | null;
  /** Error-based accuracy over this month's audited charts; null until one is audited. */
  auditPercentage: number | null;
  completedCharts: number;
}

export interface ManagerDashboard {
  asOf: string;
  timeZone: string;
  /** The month the production and audit figures cover (YYYY-MM-DD of the first day). */
  monthFrom: string;
  filter: { vendorId: string | null; name: string } | null;
  people: {
    projects: number;
    teams: number;
    activeTeamLeads: number;
    activeAuditors: number;
    activeCoders: number;
  };
  charts: {
    total: number;
    completed: number;
    pendingAllocation: number;
    inProgress: number;
    pendingAudit: number;
    reviewRequired: number;
    pendingRework: number;
    byStatus: Record<string, number>;
  };
  audits: { pending: number; completed: number };
  production: { today: ProductionFigures; month: ProductionFigures };
  performance: {
    cph: number | null;
    activeHours: number;
    auditPercentage: number | null;
    auditedCharts: number;
    totalErrors: number;
  };
  vendors: VendorPerformanceRow[];
}
