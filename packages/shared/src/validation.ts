import { z } from 'zod';

/**
 * Field-level validation shared by web forms, API DTOs and the CSV framework.
 * Business identifiers are validated, trimmed and normalised in exactly one place.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }).max(254));

/** Employee ID — unique per organization. */
export const employeeCodeSchema = z
  .string()
  .trim()
  .min(1, 'Employee ID is required')
  .max(32, 'Employee ID must be at most 32 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Employee ID may contain letters, digits, ".", "_" and "-"');

/** Chart ID from the client file — unique within a project (D-04). */
export const chartRefSchema = z
  .string()
  .trim()
  .min(1, 'Chart ID is required')
  .max(64, 'Chart ID must be at most 64 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, 'Chart ID may contain letters, digits, ".", "_", "-" and "/"');

/** SmartClues Login Name — internal identifier assigned by the Manager. */
export const loginNameSchema = z
  .string()
  .trim()
  .min(2, 'Login Name must be at least 2 characters')
  .max(64, 'Login Name must be at most 64 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/,
    'Login Name may contain letters, digits, "@", ".", "_", "+" and "-" (for example naveen@vlms.com)',
  );

export const personNameSchema = z.string().trim().min(1, 'Name is required').max(120);

/** Password policy (docs/06-authentication.md). Strength scoring is added server-side in Phase 3. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

const nonNegativeInt = (label: string) =>
  z.number().int(`${label} must be a whole number`).min(0, `${label} cannot be negative`);

/** D-11 — production fields. There is no JCD field. */
export const productionCountsSchema = z.object({
  pageCount: nonNegativeInt('Page Count'),
  icds: nonNegativeInt('ICDs'),
  dos: nonNegativeInt('DOS'),
});
export type ProductionCounts = z.infer<typeof productionCountsSchema>;

/** D-11 — audit errors stored separately; Total Errors is computed. */
export const auditErrorCountsSchema = z.object({
  auditErrors: nonNegativeInt('Audit Errors'),
  errorExceptions: nonNegativeInt('Error Exceptions'),
});
export type AuditErrorCounts = z.infer<typeof auditErrorCountsSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
