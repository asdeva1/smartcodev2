import { type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ProblemException } from '../errors/problem';

/**
 * Validates and normalises input with a shared zod schema (packages/shared/validation).
 * Unknown properties are stripped by zod objects; failures return 422 VALIDATION_FAILED with per-field messages.
 *
 *   @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ProblemException(
      422,
      'VALIDATION_FAILED',
      'The request contains invalid fields',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
}
