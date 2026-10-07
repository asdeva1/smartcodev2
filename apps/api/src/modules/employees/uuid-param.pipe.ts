import { type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ProblemException } from '../../core/errors/problem';

const uuid = z.uuid();

/** A malformed id can never match a record, so it is a 404 (not a 500 from the database driver). */
export class UuidParamPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!uuid.safeParse(value).success) throw new ProblemException(404, 'NOT_FOUND', 'Not found');
    return value;
  }
}
