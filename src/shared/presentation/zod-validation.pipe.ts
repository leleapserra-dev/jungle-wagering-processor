import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from './exception-filter';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('BAD_REQUEST', 'validation failed', HttpStatus.BAD_REQUEST, {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }
    return result.data;
  }
}
