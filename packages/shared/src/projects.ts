import { z } from 'zod';
import {
  ACTIVE_STATUSES,
  ALLOCATION_TYPES,
  PROJECT_STATUSES,
  type AllocationType,
  type ProjectStatus,
} from './statuses.js';

/** Request/response contracts for Clients, Projects, project allocation files, reports and live tracking (Phase 5). */

const uuid = z.uuid();

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** Staff roles that can be placed on a project. The role must equal the employee's own role (database rule). */
export const PROJECT_STAFF_ROLES = ['TEAM_LEAD', 'AUDITOR', 'CODER', 'GROUP_COACH'] as const;
export type ProjectStaffRole = (typeof PROJECT_STAFF_ROLES)[number];

/** Columns of the Manual-project allocation file, in this order. */
export const ALLOCATION_CSV_COLUMNS = [
  'Login Name',
  'Email ID',
  'Chart ID',
  'Pages',
  'Page Bucket',
  'Remarks',
] as const;

export const chartIdSchema = z
  .string()
  .trim()
  .min(1, 'Chart ID is required')
  .max(128, 'Chart ID must be at most 128 characters');

// ───────── Projects ─────────

export const clientNameSchema = z.string().trim().min(2, 'Client name is required').max(200);
export const projectNameSchema = z.string().trim().min(2, 'Project name is required').max(200);

export const projectCreateSchema = z.object({
  /** An existing client is reused (case-insensitive); a new name creates the client. */
  clientName: clientNameSchema,
  name: projectNameSchema,
  allocationType: z.enum(ALLOCATION_TYPES),
  /** Optional: the vendor that executes this project. Leave out for an in-house project. */
  vendorId: uuid.optional(),
  /** Optional Project Lead (a Team Lead). */
  leadId: uuid.optional(),
});
export type ProjectCreate = z.infer<typeof projectCreateSchema>;

export const projectUpdateSchema = z
  .object({
    name: projectNameSchema.optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;

export const projectListQuerySchema = z.object({
  ...pagination,
  q: optionalText,
  allocationType: z.enum(ALLOCATION_TYPES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  clientId: uuid.optional(),
});
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectLeadSchema = z.object({ employeeId: uuid.nullable() });
export type ProjectLeadInput = z.infer<typeof projectLeadSchema>;

export const projectMemberAddSchema = z.object({
  employeeId: uuid,
  /** The Project Lead is set with its own action; members are Auditors, Coders or Group Coaches. */
  projectRole: z.enum(['AUDITOR', 'CODER', 'GROUP_COACH']),
});
export type ProjectMemberAdd = z.infer<typeof projectMemberAddSchema>;

export interface ClientOption {
  id: string;
  name: string;
  status: (typeof ACTIVE_STATUSES)[number];
}

export interface ProjectPerson {
  id: string;
  fullName: string;
}

export interface ProjectListRecord {
  id: string;
  name: string;
  client: { id: string; name: string };
  allocationType: AllocationType;
  status: ProjectStatus;
  vendor: { id: string; name: string } | null;
  lead: ProjectPerson | null;
  memberCount: number;
  chartCount: number;
  createdAt: string;
}

export interface ProjectMemberRecord {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  projectRole: ProjectStaffRole;
  loginName: string | null;
  /** Charts the member currently holds (ALLOCATED or IN_PRODUCTION). */
  openCharts: number;
  startedAt: string;
}

export interface ProjectDetail extends ProjectListRecord {
  members: ProjectMemberRecord[];
  /** Coders who are working on a chart right now (a chart IN_PRODUCTION). */
  workingNow: number;
  chartsByStatus: Record<string, number>;
  submittedToClient: number;
  clientPullbackAt: string | null;
}

// ───────── Project charts / allocation ─────────

export const projectChartsQuerySchema = z.object({
  ...pagination,
  q: optionalText,
  status: z.string().trim().max(32).optional(),
});
export type ProjectChartsQuery = z.infer<typeof projectChartsQuerySchema>;

export interface ProjectChartRecord {
  id: string;
  chartId: string;
  status: string;
  pages: number | null;
  pageBucket: string | null;
  remarks: string | null;
  allocation: {
    loginName: string;
    assignedTo: { id: string; fullName: string; email: string };
    allocatedAt: string;
  } | null;
  submittedToClientAt: string | null;
  /** Set while the coder has the chart on hold; the Manager cannot pull a held chart back. */
  heldAt: string | null;
  holdReason: string | null;
  updatedAt: string;
}

export const chartIdListSchema = z.object({
  chartIds: z.array(uuid).min(1, 'Select at least one chart').max(1000),
  reason: z.string().trim().max(500).optional(),
});
export type ChartIdList = z.infer<typeof chartIdListSchema>;

/** Omit `chartIds` to submit every completed chart that has not been submitted yet. */
export const submitToClientSchema = z.object({
  chartIds: z.array(uuid).min(1).max(1000).optional(),
});
export type SubmitToClient = z.infer<typeof submitToClientSchema>;

export const clientPullbackSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason').max(500),
});
export type ClientPullback = z.infer<typeof clientPullbackSchema>;

export interface PullbackResult {
  pulledBack: number;
  skipped: number;
}

export interface SubmitToClientResult {
  submitted: number;
  skipped: number;
}

// ───────── Reports & live tracking ─────────

export const REPORT_RANGES = ['today', 'month', 'custom'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const reportQuerySchema = z
  .object({
    range: z.enum(REPORT_RANGES).default('today'),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.range !== 'custom') return;
    if (!v.from) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Choose a start date' });
    if (!v.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose an end date' });
    if (v.from && v.to && v.from > v.to)
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The end date must not be before the start date',
      });
    if (v.from && v.to && v.from <= v.to) {
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
      if (days > 366)
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose a range of at most one year' });
    }
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export interface ReportPeriod {
  range: ReportRange;
  /** Inclusive dates in the organization's time zone. */
  from: string;
  to: string;
  timeZone: string;
}

export interface ProductionReportRow {
  coder: { id: string; fullName: string; loginName: string | null };
  charts: number;
  pages: number;
  icds: number;
  dos: number;
}

export interface ProductionReport {
  period: ReportPeriod;
  totals: { charts: number; pages: number; icds: number; dos: number };
  rows: ProductionReportRow[];
}

export interface QualityReportRow {
  coder: { id: string; fullName: string; loginName: string | null };
  audited: number;
  passed: number;
  reviewRequired: number;
  rejected: number;
  auditErrors: number;
  errorExceptions: number;
  totalErrors: number;
}

export interface QualityReport {
  period: ReportPeriod;
  totals: Omit<QualityReportRow, 'coder'>;
  rows: QualityReportRow[];
}

export interface LiveDayCount {
  date: string;
  chartsDone: number;
}

export interface LiveCoderCount {
  coder: { id: string; fullName: string; loginName: string | null };
  doneToday: number;
  inProduction: number;
  allocated: number;
}

/** Live chart tracking: charts the coders finished today and over the last days. */
export interface LiveTracking {
  asOf: string;
  timeZone: string;
  today: string;
  doneToday: number;
  inProduction: number;
  allocated: number;
  pendingAllocation: number;
  days: LiveDayCount[];
  coders: LiveCoderCount[];
}

// ───────── Coder "My allotment" ─────────

export interface AllotmentChart {
  id: string;
  chartId: string;
  status: string;
  pages: number | null;
  pageBucket: string | null;
  remarks: string | null;
  loginName: string;
  allocatedAt: string;
  heldAt: string | null;
  holdReason: string | null;
  project: { id: string; name: string; client: string };
}

export interface MyAllotment {
  loginName: string | null;
  total: number;
  charts: AllotmentChart[];
}

// ───────── Coder chart workspace & production submit (Phase 8, first slice) ─────────

const countSchema = z.coerce
  .number({ error: 'Enter a number' })
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(9999, 'Must be at most 9999');

/** Pages come from the allocation file and cannot be edited by the coder; ICDs, DOS and optional Remarks are entered. */
export const productionSubmitSchema = z.object({
  icds: countSchema,
  dos: countSchema,
  remarks: z
    .string()
    .trim()
    .max(1000, 'Remarks must be at most 1000 characters')
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ProductionSubmit = z.infer<typeof productionSubmitSchema>;

export interface ChartWorkspace {
  id: string;
  chartId: string;
  status: string;
  pages: number | null;
  pageBucket: string | null;
  remarks: string | null;
  loginName: string;
  /** Set while the chart is on hold (it cannot be submitted or pulled back until resumed). */
  heldAt: string | null;
  holdReason: string | null;
  project: { id: string; name: string; client: string };
}

/** Putting a chart on hold needs a reason, which the Manager can see. */
export const holdChartSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Enter the reason for holding this chart')
    .max(500, 'At most 500 characters'),
});
export type HoldChart = z.infer<typeof holdChartSchema>;

export interface ProductionSubmitted {
  chartId: string;
  status: string;
  icds: number;
  dos: number;
  pages: number;
}

// ───────── Coder dashboard & notifications ─────────

export interface CoderDashboard {
  /** Charts this coder has submitted, ever. */
  totalCoded: number;
  /** Charts submitted today (India time). */
  todayCoded: number;
  /** Charts per active hour (hold time excluded); null until at least one chart has been timed. */
  cph: number | null;
  /** Hours of active work behind the CPH figure. */
  activeHours: number;
  /** Error-based accuracy over audited charts: (ICDs + DOS − errors) ÷ (ICDs + DOS) × 100; null until a chart is audited. */
  auditPercentage: number | null;
  auditedCharts: number;
  totalErrors: number;
  onHold: number;
  pendingWork: number;
  /** Projects the coder currently has charts allocated in. */
  projects: { id: string; name: string; client: string }[];
}

export interface NotificationItem {
  id: string;
  type: string;
  subject: string;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  unread: number;
  items: NotificationItem[];
}
