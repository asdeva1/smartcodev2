import { HttpException } from '@nestjs/common';
import type { ErrorCode, ProblemDetails } from '@smartcode/shared';

/** Throw from services/controllers to return an RFC 7807 problem with a stable `code`. */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    detail?: string,
    readonly fieldErrors?: ProblemDetails['errors'],
  ) {
    super(detail ?? code, status);
  }
}

export const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export const DEFAULT_CODES: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};
