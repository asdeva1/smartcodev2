import { z } from 'zod';
import { ACTIVE_STATUSES } from './statuses.js';
import { emailSchema, employeeCodeSchema, personNameSchema } from './validation.js';

/** Request/response contracts for Organization, Vendors, Teams and base Settings (Phase 4). */

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

// ───────── Organization & settings ─────────

/** IANA time zone names only; validated with the runtime's own tz database. */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, 'Time zone is required')
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone, for example Asia/Kolkata');

const terminologyLabel = z.string().trim().min(1).max(40);

/** Labels shown instead of the defaults (D-16). Only known keys are accepted. */
export const terminologySchema = z
  .object({
    SPC: terminologyLabel,
    VENDOR: terminologyLabel,
    LOGIN_NAME: terminologyLabel,
    EMPLOYEE_ID: terminologyLabel,
    CHART_ID: terminologyLabel,
  })
  .partial()
  .strict();

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(200).optional(),
    timeZone: timeZoneSchema.optional(),
    /** Replaces the whole override map; send {} to go back to the default labels. */
    terminology: terminologySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type OrganizationUpdate = z.infer<typeof organizationUpdateSchema>;

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  status: string;
  terminology: Partial<Record<'SPC' | 'VENDOR' | 'LOGIN_NAME' | 'EMPLOYEE_ID' | 'CHART_ID', string>>;
  counts: { employees: number; vendors: number; teams: number };
}

// ───────── Vendors ─────────

export const vendorCodeSchema = z
  .string()
  .trim()
  .min(2, 'Vendor code must be at least 2 characters')
  .max(32, 'Vendor code must be at most 32 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Vendor code may contain letters, digits, ".", "_" and "-"');

export const vendorNameSchema = z.string().trim().min(2, 'Vendor name is required').max(200);

/** The Vendor Admin is created together with the vendor and activates through the normal activation link. */
export const vendorCreateSchema = z.object({
  code: vendorCodeSchema,
  name: vendorNameSchema,
  admin: z.object({
    employeeCode: employeeCodeSchema,
    fullName: personNameSchema,
    email: emailSchema,
  }),
  sendActivation: z.boolean().default(true),
});
export type VendorCreate = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = z
  .object({ name: vendorNameSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;

export const vendorListQuerySchema = z.object({
  ...pagination,
  q: optionalText,
  status: z.enum(ACTIVE_STATUSES).optional(),
});
export type VendorListQuery = z.infer<typeof vendorListQuerySchema>;

export interface VendorRecord {
  id: string;
  code: string;
  name: string;
  status: (typeof ACTIVE_STATUSES)[number];
  employeeCount: number;
  teamCount: number;
  admins: { id: string; fullName: string; email: string; status: string }[];
  createdAt: string;
}

// ───────── Teams ─────────

export const teamNameSchema = z.string().trim().min(2, 'Team name is required').max(200);

export const teamCreateSchema = z.object({
  name: teamNameSchema,
  /** Manager only: which vendor the team belongs to. Omit for an in-house team. A Vendor Admin always uses their own. */
  vendorId: uuid.optional(),
  teamLeadId: uuid.optional(),
});
export type TeamCreate = z.infer<typeof teamCreateSchema>;

export const teamUpdateSchema = z
  .object({
    name: teamNameSchema.optional(),
    /** null removes the Team Lead. */
    teamLeadId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type TeamUpdate = z.infer<typeof teamUpdateSchema>;

export const teamMemberAddSchema = z.object({ employeeId: uuid });
export type TeamMemberAdd = z.infer<typeof teamMemberAddSchema>;

export const teamListQuerySchema = z.object({
  ...pagination,
  q: optionalText,
  status: z.enum(ACTIVE_STATUSES).optional(),
  vendorId: uuid.optional(),
});
export type TeamListQuery = z.infer<typeof teamListQuerySchema>;

export interface TeamMemberRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  status: (typeof ACTIVE_STATUSES)[number];
  vendor: { id: string; name: string } | null;
  teamLead: { id: string; fullName: string } | null;
  memberCount: number;
  createdAt: string;
}

export interface TeamDetail extends TeamRecord {
  members: TeamMemberRecord[];
}

// ───────── Chart allocation lookup (Manager) ─────────

export const chartLookupQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter a Chart ID').max(128),
});
export type ChartLookupQuery = z.infer<typeof chartLookupQuerySchema>;

/** What the Manager sees after searching a Chart ID: who holds it, who allocated it and when. */
export interface ChartLookupRecord {
  chartId: string;
  project: { id: string; name: string; client: string };
  status: string;
  allocation: {
    loginName: string;
    assignedTo: { id: string; fullName: string; email: string };
    allocatedBy: { id: string; fullName: string };
    allocatedAt: string;
  } | null;
}
