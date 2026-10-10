import { z } from 'zod';
import type { Page } from './employees.js';
import { emailSchema } from './validation.js';

/** Visitor Management (D-07 as drafted): register a visit, name the host, check in and out, print a badge. */

export const VISIT_STATUSES = ['EXPECTED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS: Readonly<Record<VisitStatus, string>> = {
  EXPECTED: 'Expected',
  CHECKED_IN: 'In the office',
  CHECKED_OUT: 'Left',
  CANCELLED: 'Cancelled',
};

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const visitCreateSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the visitor’s name').max(200),
  company: text(200),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\-\s]{6,32}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  hostId: z.uuid({ error: 'Choose who they are visiting' }),
  purpose: z.string().trim().min(3, 'Say why they are visiting').max(300),
  /** When they are expected. Leave out for a walk-in. */
  expectedAt: z.iso.datetime({ offset: true }).optional(),
  /** Start the visit as checked in (a walk-in at the desk). */
  checkIn: z.boolean().default(false),
  notes: text(500),
});
export type VisitCreate = z.infer<typeof visitCreateSchema>;

export const visitListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(VISIT_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** A day, in the organisation's time zone: visits created, expected or checked in that day. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type VisitListQuery = z.infer<typeof visitListQuerySchema>;

export const visitCancelSchema = z.object({ reason: text(200) });

export interface VisitRecord {
  id: string;
  status: VisitStatus;
  visitor: { id: string; fullName: string; company: string | null; phone: string | null; email: string | null };
  host: { id: string; fullName: string };
  purpose: string;
  expectedAt: string | null;
  badgeNumber: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface VisitPage extends Page<VisitRecord> {
  /** People in the office right now. */
  insideNow: number;
}

/** What is printed on the visitor badge. */
export interface VisitBadge {
  badgeNumber: string;
  visitorName: string;
  company: string | null;
  hostName: string;
  date: string;
  checkedInAt: string;
}
