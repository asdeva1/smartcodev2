import { describe, expect, it } from 'vitest';
import {
  CHART_AUTOMATIC_FOLLOW_UPS,
  CHART_STATUSES,
  CHART_TRANSITIONS,
  ROLES,
  WorkflowError,
  assertCanResolveReview,
  assertChartTransition,
  auditStatusForResult,
  availableChartActions,
  totalErrors,
  type ChartAction,
  type ChartActor,
  type ChartStatus,
} from '../src/index.js';

const ACTORS: ChartActor[] = [...ROLES, 'SYSTEM'];

function run(path: [ChartAction, ChartActor][], start: ChartStatus = 'PENDING_ALLOCATION'): ChartStatus {
  let status = start;
  for (const [action, actor] of path) {
    status = assertChartTransition(status, action, actor);
    const followUp = CHART_AUTOMATIC_FOLLOW_UPS[status];
    if (followUp) status = assertChartTransition(status, followUp, 'SYSTEM');
  }
  return status;
}

describe('chart workflow', () => {
  it('every transition uses known statuses', () => {
    for (const t of CHART_TRANSITIONS) {
      expect(CHART_STATUSES).toContain(t.from);
      expect(CHART_STATUSES).toContain(t.to);
    }
  });

  it('every status except COMPLETED has a way forward and COMPLETED is terminal', () => {
    for (const s of CHART_STATUSES) {
      const outgoing = CHART_TRANSITIONS.filter((t) => t.from === s);
      if (s === 'COMPLETED') expect(outgoing).toHaveLength(0);
      else expect(outgoing.length, s).toBeGreaterThan(0);
    }
  });

  it('happy path: PASS → AUDITED → COMPLETED', () => {
    expect(
      run([
        ['ALLOCATE', 'MANAGER'],
        ['START_PRODUCTION', 'CODER'],
        ['SUBMIT_PRODUCTION', 'CODER'],
        ['AUDIT_PASS', 'AUDITOR'],
      ]),
    ).toBe('COMPLETED');
  });

  it('D-02: submitting production always enters the audit queue', () => {
    expect(run([['SUBMIT_PRODUCTION', 'CODER']], 'IN_PRODUCTION')).toBe('PENDING_AUDIT');
  });

  it('review → Manager approves → COMPLETED', () => {
    expect(
      run(
        [
          ['AUDIT_REVIEW_REQUIRED', 'AUDITOR'],
          ['MANAGER_APPROVE', 'MANAGER'],
        ],
        'PENDING_AUDIT',
      ),
    ).toBe('COMPLETED');
  });

  it('full loop: review → reject → rework → re-audit → review → reject → rework → re-audit → PASS', () => {
    expect(
      run(
        [
          ['AUDIT_REVIEW_REQUIRED', 'AUDITOR'],
          ['MANAGER_REJECT', 'MANAGER'],
          ['SUBMIT_REWORK', 'CODER'],
          ['AUDIT_REVIEW_REQUIRED', 'AUDITOR'],
          ['MANAGER_REJECT', 'MANAGER'],
          ['SUBMIT_REWORK', 'CODER'],
          ['AUDIT_PASS', 'AUDITOR'],
        ],
        'PENDING_AUDIT',
      ),
    ).toBe('COMPLETED');
  });

  it.each(ACTORS.filter((a) => a !== 'MANAGER'))('D-01: %s cannot approve or reject a review', (actor) => {
    for (const action of ['MANAGER_APPROVE', 'MANAGER_REJECT'] as const) {
      expect(() => assertChartTransition('REVIEW_REQUIRED', action, actor)).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    }
  });

  it('D-01: Team Lead has no action at all on a chart in review', () => {
    expect(availableChartActions('REVIEW_REQUIRED', 'TEAM_LEAD')).toEqual([]);
    expect(availableChartActions('REVIEW_REQUIRED', 'MANAGER').sort()).toEqual([
      'MANAGER_APPROVE',
      'MANAGER_REJECT',
    ]);
  });

  it('D-01: nobody can send an audit straight to rework from the audit queue', () => {
    for (const actor of ACTORS) {
      expect(() => assertChartTransition('PENDING_AUDIT', 'MANAGER_REJECT', actor)).toThrow(
        expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      );
    }
  });

  it.each(ACTORS.filter((a) => a !== 'MANAGER'))('only Manager allocates (%s denied)', (actor) => {
    expect(() => assertChartTransition('PENDING_ALLOCATION', 'ALLOCATE', actor)).toThrow(WorkflowError);
  });

  it('rejects transitions that do not exist', () => {
    expect(() => assertChartTransition('COMPLETED', 'ALLOCATE', 'MANAGER')).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
    expect(() => assertChartTransition('PENDING_ALLOCATION', 'SUBMIT_PRODUCTION', 'CODER')).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });
});

describe('audit review resolution (D-01)', () => {
  const base = {
    actorRole: 'MANAGER' as const,
    actorEmployeeId: 'mgr-1',
    auditorEmployeeId: 'aud-1',
    auditStatus: 'REVIEW_REQUIRED' as const,
  };

  it('maps auditor results', () => {
    expect(auditStatusForResult('PASS')).toBe('PASSED');
    expect(auditStatusForResult('REVIEW_REQUIRED')).toBe('REVIEW_REQUIRED');
  });

  it('Manager can approve and reject (with reason)', () => {
    expect(assertCanResolveReview({ ...base, decision: 'APPROVED' })).toBe('APPROVED');
    expect(assertCanResolveReview({ ...base, decision: 'REJECTED', reason: 'Sequencing error' })).toBe(
      'REJECTED',
    );
  });

  it.each(ROLES.filter((r) => r !== 'MANAGER'))('%s is forbidden', (role) => {
    expect(() => assertCanResolveReview({ ...base, actorRole: role, decision: 'APPROVED' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('the auditor who raised the review cannot resolve it', () => {
    expect(() => assertCanResolveReview({ ...base, actorEmployeeId: 'aud-1', decision: 'APPROVED' })).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejecting requires a reason', () => {
    expect(() => assertCanResolveReview({ ...base, decision: 'REJECTED', reason: '  ' })).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('cannot resolve twice or resolve a non-review audit', () => {
    for (const auditStatus of ['APPROVED', 'REJECTED'] as const) {
      expect(() => assertCanResolveReview({ ...base, auditStatus, decision: 'APPROVED' })).toThrow(
        expect.objectContaining({ code: 'AUDIT_ALREADY_RESOLVED' }),
      );
    }
    for (const auditStatus of ['IN_PROGRESS', 'PASSED'] as const) {
      expect(() => assertCanResolveReview({ ...base, auditStatus, decision: 'APPROVED' })).toThrow(
        expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      );
    }
  });
});

describe('total errors (D-11)', () => {
  it('is the sum of audit errors and error exceptions', () => {
    expect(totalErrors(3, 2)).toBe(5);
    expect(totalErrors(0, 0)).toBe(0);
  });
  it('rejects negative or fractional values', () => {
    expect(() => totalErrors(-1, 0)).toThrow(RangeError);
    expect(() => totalErrors(1, 0.5)).toThrow(RangeError);
  });
});
