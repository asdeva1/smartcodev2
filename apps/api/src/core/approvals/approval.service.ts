import { HttpStatus, Injectable } from '@nestjs/common';
import type { Role } from '@smartcode/shared';
import type { Prisma } from '../../generated/prisma/client';
import { ProblemException } from '../errors/problem';
import { PrismaService } from '../prisma/prisma.service';

export interface ApprovalStepInput {
  /** A named approver … */
  approverId?: string;
  /** … or anyone holding this role. */
  approverRole?: Role;
}

export interface ApprovalRequestInput {
  organizationId: string;
  /** UPPER_SNAKE or dotted type key, e.g. `EMPLOYEE.DEACTIVATION`. */
  type: string;
  entityType: string;
  entityId: string;
  requesterId: string;
  comments?: string;
  /** The requested change — never secrets or PHI. */
  payload?: Prisma.InputJsonObject;
  steps: readonly ApprovalStepInput[];
}

/**
 * Universal Approval Engine (foundation). Generic request → ordered steps → decision. Specific approval workflows
 * (login-name changes, deactivation, project closure …) are configured on top of it in later phases; the audit
 * Manager review (D-01) may adopt it through `audit_resolutions.approval_request_id`. Rules the database enforces
 * regardless of this code: one pending request per subject, resolve once, never by the requester.
 */
@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async request(input: ApprovalRequestInput) {
    if (input.steps.length === 0) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        'An approval needs at least one step',
      );
    }
    return this.prisma.client.$transaction(async (tx) => {
      const { steps, ...rest } = input;
      const request = await tx.approvalRequest.create({ data: rest });
      await tx.approvalStep.createMany({
        data: steps.map((step, index) => ({ requestId: request.id, stepOrder: index + 1, ...step })),
      });
      return request;
    });
  }

  /** Records the decision of the next pending step; the request resolves on rejection or after the last approval. */
  decide(input: {
    requestId: string;
    deciderId: string;
    decision: 'APPROVED' | 'REJECTED';
    comments?: string;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findUnique({
        where: { id: input.requestId },
        include: { steps: { orderBy: { stepOrder: 'asc' } } },
      });
      if (!request)
        throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Approval request not found');
      if (request.status !== 'PENDING') {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This approval request is already resolved',
        );
      }
      const decider = await tx.employee.findUnique({ where: { id: input.deciderId } });
      if (!decider || decider.status !== 'ACTIVE' || decider.organizationId !== request.organizationId) {
        throw new ProblemException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'The approver is not an active employee',
        );
      }
      const step = request.steps.find((s) => s.status === 'PENDING');
      if (!step) throw new ProblemException(HttpStatus.CONFLICT, 'CONFLICT', 'There is no pending step');
      const allowed = step.approverId ? step.approverId === decider.id : step.approverRole === decider.role;
      if (!allowed) {
        throw new ProblemException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You are not an approver of this step');
      }

      const now = new Date();
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: input.decision, decidedById: decider.id, decidedAt: now, comments: input.comments },
      });
      const finished =
        input.decision === 'REJECTED' ||
        request.steps.every((s) => s.id === step.id || s.status === 'APPROVED');
      if (!finished) return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
      return tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: input.decision,
          decision: input.decision,
          decisionComments: input.comments,
          resolvedById: decider.id,
          resolvedAt: now,
        },
      });
    });
  }

  /** The requester withdraws their own pending request. */
  cancel(requestId: string, requesterId: string) {
    return this.prisma.client.$transaction(async (tx) => {
      const request = await tx.approvalRequest.findUnique({ where: { id: requestId } });
      if (!request || request.requesterId !== requesterId) {
        throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Approval request not found');
      }
      if (request.status !== 'PENDING') {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This approval request is already resolved',
        );
      }
      return tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', resolvedAt: new Date() },
      });
    });
  }
}
