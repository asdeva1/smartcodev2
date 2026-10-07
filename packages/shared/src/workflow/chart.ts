import { WorkflowError } from '../errors.js';
import type { Role } from '../roles.js';
import type { ChartStatus } from '../statuses.js';

/**
 * Chart lifecycle (docs/08-chart-lifecycle.md, decision D-01, D-02).
 * The only definition of which transitions exist and who may trigger them.
 */
export const CHART_ACTIONS = [
  'ALLOCATE',
  'DEALLOCATE',
  'REALLOCATE',
  'START_PRODUCTION',
  'SUBMIT_PRODUCTION',
  'ENQUEUE_AUDIT',
  'AUDIT_PASS',
  'AUDIT_REVIEW_REQUIRED',
  'MANAGER_APPROVE',
  'MANAGER_REJECT',
  'SUBMIT_REWORK',
  'FINALISE',
] as const;
export type ChartAction = (typeof CHART_ACTIONS)[number];

/** `SYSTEM` = performed automatically inside the transaction of the triggering action. */
export type ChartActor = Role | 'SYSTEM';

export interface ChartTransition {
  action: ChartAction;
  from: ChartStatus;
  to: ChartStatus;
  actors: readonly ChartActor[];
}

export const CHART_TRANSITIONS: readonly ChartTransition[] = [
  { action: 'ALLOCATE', from: 'PENDING_ALLOCATION', to: 'ALLOCATED', actors: ['MANAGER'] },
  { action: 'DEALLOCATE', from: 'ALLOCATED', to: 'PENDING_ALLOCATION', actors: ['MANAGER'] },
  { action: 'REALLOCATE', from: 'ALLOCATED', to: 'ALLOCATED', actors: ['MANAGER'] },
  { action: 'REALLOCATE', from: 'IN_PRODUCTION', to: 'ALLOCATED', actors: ['MANAGER'] },
  { action: 'START_PRODUCTION', from: 'ALLOCATED', to: 'IN_PRODUCTION', actors: ['CODER'] },
  { action: 'SUBMIT_PRODUCTION', from: 'IN_PRODUCTION', to: 'CODED', actors: ['CODER'] },
  // D-02: 100 % audit coverage — every coded chart enters the audit queue.
  { action: 'ENQUEUE_AUDIT', from: 'CODED', to: 'PENDING_AUDIT', actors: ['SYSTEM'] },
  { action: 'AUDIT_PASS', from: 'PENDING_AUDIT', to: 'AUDITED', actors: ['AUDITOR'] },
  { action: 'AUDIT_PASS', from: 'RE_AUDIT', to: 'AUDITED', actors: ['AUDITOR'] },
  { action: 'AUDIT_REVIEW_REQUIRED', from: 'PENDING_AUDIT', to: 'REVIEW_REQUIRED', actors: ['AUDITOR'] },
  { action: 'AUDIT_REVIEW_REQUIRED', from: 'RE_AUDIT', to: 'REVIEW_REQUIRED', actors: ['AUDITOR'] },
  // D-01: only the Manager resolves REVIEW_REQUIRED.
  { action: 'MANAGER_APPROVE', from: 'REVIEW_REQUIRED', to: 'COMPLETED', actors: ['MANAGER'] },
  { action: 'MANAGER_REJECT', from: 'REVIEW_REQUIRED', to: 'REWORK', actors: ['MANAGER'] },
  { action: 'SUBMIT_REWORK', from: 'REWORK', to: 'RE_AUDIT', actors: ['CODER'] },
  { action: 'FINALISE', from: 'AUDITED', to: 'COMPLETED', actors: ['SYSTEM'] },
];

/** Follow-up transitions the system applies in the same transaction. */
export const CHART_AUTOMATIC_FOLLOW_UPS: Readonly<Partial<Record<ChartStatus, ChartAction>>> = {
  CODED: 'ENQUEUE_AUDIT',
  AUDITED: 'FINALISE',
};

export function findChartTransition(from: ChartStatus, action: ChartAction): ChartTransition | undefined {
  return CHART_TRANSITIONS.find((t) => t.from === from && t.action === action);
}

/**
 * Returns the target status or throws:
 *  - INVALID_TRANSITION when the action doesn't exist from this status (API → 409)
 *  - FORBIDDEN when the actor may not perform it (API → 403)
 */
export function assertChartTransition(
  from: ChartStatus,
  action: ChartAction,
  actor: ChartActor,
): ChartStatus {
  const transition = findChartTransition(from, action);
  if (!transition) {
    throw new WorkflowError('INVALID_TRANSITION', `Chart action ${action} is not allowed from ${from}`);
  }
  if (!transition.actors.includes(actor)) {
    throw new WorkflowError('FORBIDDEN', `${actor} cannot perform ${action}`);
  }
  return transition.to;
}

/** Actions an actor could take on a chart in `from` (used by the UI to show buttons). */
export function availableChartActions(from: ChartStatus, actor: ChartActor): ChartAction[] {
  return CHART_TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.action);
}
