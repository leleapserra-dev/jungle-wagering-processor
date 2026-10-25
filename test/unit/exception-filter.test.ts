import { describe, expect, test } from 'bun:test';
import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter, AppException } from '../../src/shared/presentation/exception-filter';
import { InvalidMoneyError } from '../../src/shared/domain/errors';

function capture(exception: unknown) {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body: unknown;

  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status: (status: number) => {
      statusCode = status;
      return response;
    },
    json: (payload: unknown) => {
      body = payload;
    }
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ headers: { 'x-correlation-id': 'corr-1' } })
    })
  } as unknown as ArgumentsHost;

  new GlobalExceptionFilter().catch(exception, host);
  return { headers, statusCode, body };
}

describe('global exception filter', () => {
  test('maps invalid domain input to 400 instead of 500', () => {
    const result = capture(new InvalidMoneyError('bad amount', { amount: 'abc' }));
    expect(result.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(result.body).toMatchObject({
      code: 'INVALID_MONEY',
      message: 'bad amount',
      details: { amount: 'abc' },
      correlationId: 'corr-1'
    });
  });

  test('maps infrastructure failures to 503 with Retry-After', () => {
    const result = capture(
      new AppException('SERVICE_UNAVAILABLE', 'dependencies not ready', HttpStatus.SERVICE_UNAVAILABLE, {
        postgres: 'ok',
        sqs: 'fail'
      })
    );
    expect(result.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result.headers['Retry-After']).toBe('5');
    expect(result.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { sqs: 'fail' } });
  });

  test('returns business rejection details unchanged', () => {
    const details = {
      transactionId: 'tx-1',
      status: 'REJECTED',
      failureCode: 'INSUFFICIENT_FUNDS',
      balance: { amount: '0.00', currency: 'BRL' },
      idempotentReplay: false
    };
    const result = capture(
      new AppException('BUSINESS_REJECTION', 'transaction rejected', HttpStatus.UNPROCESSABLE_ENTITY, details)
    );
    expect(result.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(result.body).toEqual(details);
  });

  test('does not leak unexpected error messages', () => {
    const result = capture(new Error('connection string leaked'));
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.body).toMatchObject({ code: 'INTERNAL_ERROR', message: 'internal server error' });
  });
});
