import { z } from 'zod';
import type { Page } from './employees.js';
import { APPROVAL_STATUSES, type ApprovalStatus } from './statuses.js';
import { loginNameSchema } from './validation.js';

/** Approval engine: someone asks, the Manager decides, and the change is carried out on approval. */

export const APPROVAL_TYPES = ['EMPLOYEE_DEACTIVATION', 'LOGIN_NAME_CHANGE', 'PROJECT_CLOSURE'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_TYPE_LABELS: Readonly<Record<ApprovalType, string>> = {
  EMPLOYEE_DEACTIVATION: 'Deactivate employee',
  LOGIN_NAME_CHANGE: 'Change client login',
  PROJECT_CLOSURE: 'Close project',
};

const comments = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined));

export const approvalCreateSchema = z
  .object({
    type: z.enum(APPROVAL_TYPES, { error: 'Choose what you are asking for' }),
    /** The employee (deactivation, login name) or the project (closure) the request is about. */
    entityId: z.uuid({ error: 'Choose who or what this is about' }),
    reason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v ? v : undefined)),
    loginName: loginNameSchema.optional(),
    comments,
  })
  .superRefine((v, ctx) => {
    if (v.type === 'EMPLOYEE_DEACTIVATION' && (v.reason?.length ?? 0) < 3) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Give a reason' });
    }
    if (v.type === 'LOGIN_NAME_CHANGE' && !v.loginName) {
      ctx.addIssue({ code: 'custom', path: ['loginName'], message: 'Enter the new client login' });
    }
  });
export type ApprovalCreate = z.infer<typeof approvalCreateSchema>;

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comments,
    /** Deactivation only: confirm when the person still holds allocated charts or open rework. */
    confirmOpenWork: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'REJECTED' && (v.comments?.length ?? 0) < 3) {
      ctx.addIssue({ code: 'custom', path: ['comments'], message: 'Say why you are rejecting this' });
    }
  });
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(APPROVAL_STATUSES).optional(),
  /** "mine" limits a Manager to their own requests; everyone else always sees only their own. */
  scope: z.enum(['mine', 'all']).default('all'),
});
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

export interface ApprovalRecord {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  /** What the request is about, e.g. the employee's or project's name. */
  subject: string;
  entityId: string;
  requester: { id: string; fullName: string; role: string };
  /** What is being asked: the reason, or the new client login. */
  request: { reason: string | null; loginName: string | null };
  comments: string | null;
  decisionComments: string | null;
  resolvedBy: { id: string; fullName: string } | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ApprovalPage extends Page<ApprovalRecord> {
  pendingCount: number;
}
