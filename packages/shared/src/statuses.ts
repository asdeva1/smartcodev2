/**
 * Status definitions (docs/02-database-architecture.md §3, decisions D-01..D-04).
 * Mirrors the PostgreSQL enums created in Phase 2 — a database test fails if the two ever differ.
 */
export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** Vendors, teams, clients and login names. */
export const ACTIVE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD', 'CLOSED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ALLOCATION_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const LOGIN_NAME_END_REASONS = ['REASSIGNED', 'DEACTIVATED', 'EMPLOYEE_INACTIVE'] as const;
export type LoginNameEndReason = (typeof LOGIN_NAME_END_REASONS)[number];

export const EMPLOYEE_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE', 'LOCKED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const AUTH_TOKEN_TYPES = ['ACTIVATION', 'PASSWORD_RESET'] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

export const ALLOCATION_TYPES = ['MANUAL', 'AUTOMATIC'] as const;
export type AllocationType = (typeof ALLOCATION_TYPES)[number];

/** Entry point that produced an allocation — all go through the single Chart Allocation Engine (D-03). */
export const ALLOCATION_SOURCES = ['MANUAL', 'CSV', 'AUTOMATIC'] as const;
export type AllocationSource = (typeof ALLOCATION_SOURCES)[number];

export const PROJECT_ROLES = ['TEAM_LEAD', 'AUDITOR', 'CODER', 'GROUP_COACH'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const CHART_STATUSES = [
  'PENDING_ALLOCATION',
  'ALLOCATED',
  'IN_PRODUCTION',
  'CODED',
  'PENDING_AUDIT',
  'REVIEW_REQUIRED',
  'REWORK',
  'RE_AUDIT',
  'AUDITED',
  'COMPLETED',
] as const;
export type ChartStatus = (typeof CHART_STATUSES)[number];

export const CHART_STATUS_LABELS: Readonly<Record<ChartStatus, string>> = {
  PENDING_ALLOCATION: 'Pending Allocation',
  ALLOCATED: 'Allocated',
  IN_PRODUCTION: 'In Production',
  CODED: 'Coded',
  PENDING_AUDIT: 'Pending Audit',
  REVIEW_REQUIRED: 'Review Required',
  REWORK: 'Rework',
  RE_AUDIT: 'Re-Audit',
  AUDITED: 'Audited',
  COMPLETED: 'Completed',
};

export const PRODUCTION_STATUSES = ['DRAFT', 'SUBMITTED', 'SUPERSEDED'] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

/** What the auditor decides. */
export const AUDIT_RESULTS = ['PASS', 'REVIEW_REQUIRED'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/** State of an audit record. */
export const AUDIT_STATUSES = ['IN_PROGRESS', 'PASSED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** Manager decision on a REVIEW_REQUIRED audit. */
export const RESOLUTION_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

export const REWORK_STATUSES = ['OPEN', 'IN_PROGRESS', 'SUBMITTED', 'CLOSED'] as const;
export type ReworkStatus = (typeof REWORK_STATUSES)[number];

export const ASSIGNMENT_END_REASONS = ['REALLOCATED', 'DEALLOCATED', 'EMPLOYEE_INACTIVE'] as const;
export type AssignmentEndReason = (typeof ASSIGNMENT_END_REASONS)[number];

export const IMPORT_TYPES = [
  'CHART_IMPORT',
  'LOGIN_NAME_ASSIGNMENT',
  'CHART_ALLOCATION',
  'EMPLOYEE_IMPORT',
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_STATUSES = [
  'UPLOADED',
  'PARSED',
  'VALIDATED',
  'CONFIRMED',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
