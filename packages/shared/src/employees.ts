import { z } from 'zod';
import { ROLES } from './roles.js';
import { EMPLOYEE_STATUSES } from './statuses.js';
import {
  emailSchema,
  employeeCodeSchema,
  loginNameSchema,
  passwordSchema,
  personNameSchema,
} from './validation.js';

/** Request/response contracts for authentication and the Employee Directory (Phase 3). */

const uuid = z.uuid();
const roleSchema = z.enum(ROLES);

// ───────── Authentication ─────────

const tokenSchema = z.string().trim().min(20, 'The link is not valid').max(200, 'The link is not valid');

export const activationRequestSchema = z.object({ token: tokenSchema, password: passwordSchema });
export type ActivationRequest = z.infer<typeof activationRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({ token: tokenSchema, password: passwordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const tokenCheckRequestSchema = z.object({
  type: z.enum(['ACTIVATION', 'PASSWORD_RESET']),
  token: tokenSchema,
});
export type TokenCheckRequest = z.infer<typeof tokenCheckRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// ───────── Employee Directory ─────────

/** Manager chooses the role; vendor rules (which roles carry a vendor) are enforced by the API and database. */
export const employeeCreateSchema = z.object({
  employeeCode: employeeCodeSchema,
  fullName: personNameSchema,
  email: emailSchema,
  role: roleSchema,
  teamId: uuid.optional(),
  vendorId: uuid.optional(),
  /** Email the activation link straight away (otherwise send it later from the directory). */
  sendActivation: z.boolean().default(false),
});
export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;

/** Fields that may be edited in place. Role, Employee ID and vendor have their own controlled operations. */
export const employeeUpdateSchema = z
  .object({
    fullName: personNameSchema.optional(),
    /** Only while PENDING_ACTIVATION — email is the sign-in identity of an active account. */
    email: emailSchema.optional(),
    /** null removes the employee from their current team. */
    teamId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;

export const roleChangeSchema = z.object({
  role: roleSchema,
  reason: z.string().trim().min(3, 'Give a reason for the role change').max(500),
});
export type RoleChange = z.infer<typeof roleChangeSchema>;

export const deactivateSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(500),
  /** Required when the person still holds allocated charts or open rework (docs/07 rule 6). */
  confirmOpenWork: z.boolean().default(false),
});
export type DeactivateRequest = z.infer<typeof deactivateSchema>;

export const EMPLOYEE_SORT_FIELDS = [
  'employeeCode',
  'fullName',
  'email',
  'role',
  'status',
  'createdAt',
  'activatedAt',
] as const;

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Searches Employee ID, name, email and Login Name. */
  q: optionalText,
  role: roleSchema.optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  vendorId: uuid.optional(),
  teamId: uuid.optional(),
  projectId: uuid.optional(),
  /** Login Name contains… */
  loginName: optionalText,
  sort: z.enum(EMPLOYEE_SORT_FIELDS).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

export interface EmployeeRecord {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  role: (typeof ROLES)[number];
  status: (typeof EMPLOYEE_STATUSES)[number];
  vendor: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  teamLead: { id: string; fullName: string } | null;
  projects: { id: string; name: string }[];
  loginName: string | null;
  loginNameEligible: boolean;
  createdAt: string;
  activatedAt: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ───────── Login Names ─────────

/** Assign by the employee's email (what the Manager types) or, for internal callers, by id — exactly one. */
export const loginNameAssignSchema = z
  .object({ employeeId: uuid.optional(), email: emailSchema.optional(), loginName: loginNameSchema })
  .refine((v) => (v.employeeId === undefined) !== (v.email === undefined), {
    message: 'Enter the email address of the employee',
    path: ['email'],
  });
export type LoginNameAssign = z.infer<typeof loginNameAssignSchema>;

export const loginNameReleaseSchema = z.object({ employeeId: uuid });
export type LoginNameRelease = z.infer<typeof loginNameReleaseSchema>;

// ───────── CSV ─────────

export const csvUploadSchema = z.object({ csv: z.string().min(1, 'Choose a CSV file').max(3_000_000) });
export type CsvUpload = z.infer<typeof csvUploadSchema>;

export const csvCommitSchema = csvUploadSchema.extend({
  /** valid-only: create the valid rows and report the rest. all-or-nothing: create nothing unless every row is valid. */
  mode: z.enum(['valid-only', 'all-or-nothing']).default('valid-only'),
});
export type CsvCommit = z.infer<typeof csvCommitSchema>;

export const bulkActivationSchema = z.object({ employeeIds: z.array(uuid).min(1).max(500) });
export type BulkActivation = z.infer<typeof bulkActivationSchema>;

export type CsvRowStatus = 'VALID' | 'INVALID' | 'DUPLICATE';

export interface CsvPreviewRow {
  line: number;
  status: CsvRowStatus;
  values: Record<string, string>;
  errors: string[];
  /** Allowed, but worth a look (e.g. replaces the employee's current Login Name). */
  warnings: string[];
}

export interface CsvPreview {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  warnings: number;
  rows: CsvPreviewRow[];
  /** Header problems that make the whole file unusable. */
  fileErrors: string[];
}

export interface CsvResult {
  committed: boolean;
  /** Employees created / Login Names assigned. */
  created: number;
  skipped: number;
  /** Ids of the employees created (employee import) so the next step can send their activation links. */
  createdIds: string[];
  preview: CsvPreview;
}

export const EMPLOYEE_CSV_COLUMNS = ['Employee Name', 'Employee ID', 'Email', 'Role'] as const;
export const LOGIN_NAME_CSV_COLUMNS = ['Login Name', 'Email'] as const;

/** One entry in a person's history (from the audit trail): who did what to this employee, and when. */
export interface EmployeeTimelineEntry {
  id: string;
  action: string;
  actor: { id: string; fullName: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
}
