import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkflowError, loginRequestSchema } from '@smartcode/shared';
import { ZodValidationPipe } from '../validation/zod-validation.pipe';
import { ProblemException } from './problem';
import { ProblemDetailsFilter } from './problem-details.filter';

describe('ProblemDetailsFilter', () => {
  const filter = new ProblemDetailsFilter();

  it('maps ProblemException with code and field errors', () => {
    const p = filter.toProblem(new ProblemException(409, 'CHART_ALREADY_ALLOCATED', 'Already allocated'));
    expect(p).toMatchObject({
      status: 409,
      code: 'CHART_ALREADY_ALLOCATED',
      detail: 'Already allocated',
      title: 'Conflict',
    });
  });

  it('maps workflow errors: forbidden actor → 403, invalid transition → 409', () => {
    expect(
      filter.toProblem(new WorkflowError('FORBIDDEN', 'Only a Manager can resolve a review')),
    ).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(filter.toProblem(new WorkflowError('INVALID_TRANSITION', 'nope'))).toMatchObject({ status: 409 });
    expect(filter.toProblem(new WorkflowError('AUDIT_ALREADY_RESOLVED', 'x'))).toMatchObject({
      status: 409,
      code: 'AUDIT_ALREADY_RESOLVED',
    });
  });

  it('maps database business-rule violations: Manager-only resolution → 403, immutable history → 409', () => {
    expect(
      filter.toProblem(
        new Error(
          'Database error. Code: `SC403`. Message: `SC403: only an active Manager can resolve a REVIEW_REQUIRED audit`',
        ),
      ),
    ).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      detail: 'only an active Manager can resolve a REVIEW_REQUIRED audit',
    });
    expect(filter.toProblem(new Error('SC409: allocation history is immutable'))).toMatchObject({
      status: 409,
    });
    expect(filter.toProblem(new Error('SC422: the coder is not assigned to this project'))).toMatchObject({
      status: 422,
    });
  });

  it('maps Nest HTTP exceptions', () => {
    expect(filter.toProblem(new NotFoundException())).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(filter.toProblem(new ForbiddenException('no'))).toMatchObject({ status: 403, detail: 'no' });
    expect(filter.toProblem(new BadRequestException(['a', 'b']))).toMatchObject({
      status: 400,
      detail: 'a; b',
    });
  });

  it('maps Prisma unique and not-found errors without leaking details', () => {
    const unique = Object.assign(new Error('Unique constraint failed on employees_email_key'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    const p = filter.toProblem(unique);
    expect(p).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(JSON.stringify(p)).not.toContain('employees_email_key');
    const missing = Object.assign(new Error('x'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
    expect(filter.toProblem(missing)).toMatchObject({ status: 404 });
  });

  it('hides unexpected errors', () => {
    const p = filter.toProblem(
      new Error('database refused login for user synthetic-user with secret s3cr3t-value'),
    );
    expect(p).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', detail: 'An unexpected error occurred' });
    expect(JSON.stringify(p)).not.toContain('s3cr3t-value');
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(loginRequestSchema);

  it('returns normalised data', () => {
    expect(pipe.transform({ email: ' A@Example.TEST ', password: 'x', extra: 1 })).toEqual({
      email: 'a@example.test',
      password: 'x',
    });
  });

  it('returns 422 with field errors', () => {
    try {
      pipe.transform({ email: 'nope' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProblemException);
      const problem = new ProblemDetailsFilter().toProblem(e);
      expect(problem.status).toBe(422);
      expect(problem.code).toBe('VALIDATION_FAILED');
      expect(problem.errors?.map((x) => x.field).sort()).toEqual(['email', 'password']);
    }
  });
});
