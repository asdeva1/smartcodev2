/** Stable error codes returned in RFC 7807 problem responses (`code` field). */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_TRANSITION',
  'AUDIT_ALREADY_RESOLVED',
  'CHART_ALREADY_ALLOCATED',
  'RATE_LIMITED',
  'ACCOUNT_NOT_ACTIVATED',
  'ACCOUNT_UNAVAILABLE',
  'TOKEN_INVALID',
  'CSRF_FAILED',
  'LOGIN_NAME_INELIGIBLE',
  'LOGIN_NAME_TAKEN',
  'PROJECT_STAFF_INELIGIBLE',
  'AUTOMATIC_PROJECT',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId?: string;
  errors?: { field: string; message: string }[];
}

/** Thrown by workflow rules; the API maps it to 409 (transition) or 403 (actor). */
export class WorkflowError extends Error {
  constructor(
    readonly code: Extract<ErrorCode, 'INVALID_TRANSITION' | 'FORBIDDEN' | 'AUDIT_ALREADY_RESOLVED'>,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}
