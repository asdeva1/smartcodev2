import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { type ErrorCode, type ProblemDetails, WorkflowError } from '@smartcode/shared';
import type { Request, Response } from 'express';
import { parseDatabaseRuleViolation } from '../database/rule-errors';
import { DEFAULT_CODES, ProblemException, STATUS_TITLES } from './problem';

interface PrismaLikeError {
  code: string;
  name: string;
}

function isPrismaKnownError(e: unknown): e is PrismaLikeError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as PrismaLikeError).name === 'PrismaClientKnownRequestError' &&
    typeof (e as PrismaLikeError).code === 'string'
  );
}

/**
 * Converts every error into `application/problem+json` (RFC 7807) with a stable `code` and the request id.
 * Unexpected errors are logged with their stack but never leak internals (or data) to the client.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception);
    problem.requestId = typeof req.id === 'string' ? req.id : undefined;
    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled error');
    }
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemException) {
      return this.build(exception.getStatus(), exception.code, exception.message, exception.fieldErrors);
    }
    if (exception instanceof WorkflowError) {
      const status = exception.code === 'FORBIDDEN' ? 403 : 409;
      return this.build(status, exception.code, exception.message);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? (body as { message: string[] }).message.join('; ')
            : ((body as { message?: string }).message ?? exception.message);
      return this.build(
        status,
        DEFAULT_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
        detail,
      );
    }
    // Business rules enforced by PostgreSQL triggers (Manager-only resolution, immutable history, eligibility …).
    const rule = parseDatabaseRuleViolation(exception);
    if (rule) return this.build(rule.status, rule.code, rule.detail);
    if (isPrismaKnownError(exception)) {
      if (exception.code === 'P2002')
        return this.build(409, 'CONFLICT', 'A record with these unique values already exists');
      if (exception.code === 'P2025') return this.build(404, 'NOT_FOUND', 'Record not found');
    }
    return this.build(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  private build(
    status: number,
    code: ErrorCode,
    detail?: string,
    errors?: ProblemDetails['errors'],
  ): ProblemDetails {
    return {
      type: `https://smartcode.docs/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title: STATUS_TITLES[status] ?? 'Error',
      status,
      code,
      ...(detail ? { detail } : {}),
      ...(errors?.length ? { errors } : {}),
    };
  }
}
