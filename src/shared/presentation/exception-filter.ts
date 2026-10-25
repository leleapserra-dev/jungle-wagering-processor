import { Catch, Logger, type ArgumentsHost, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../domain/errors';

const logger = new Logger('GlobalExceptionFilter');

export class AppException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: HttpStatus,
    public readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = 'AppException';
  }
}

function statusToCode(status: number): string {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'BUSINESS_REJECTION';
  if (status === 404) return 'NOT_FOUND';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 202) return 'ACCEPTED';
  return 'INTERNAL_ERROR';
}

function domainStatus(code: string): HttpStatus {
  switch (code) {
    case 'INVALID_MONEY':
    case 'INVALID_WAGER_TRANSACTION':
    case 'INVALID_LEDGER_ENTRY':
    case 'INVALID_INBOX_STATE':
    case 'INVALID_OUTBOX_STATE':
      return HttpStatus.BAD_REQUEST;
    case 'WALLET_NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'WALLET_ALREADY_EXISTS':
    case 'IDEMPOTENCY_KEY_CONFLICT':
    case 'EXTERNAL_TRANSACTION_CONFLICT':
    case 'PERSISTENCE_CONFLICT':
      return HttpStatus.CONFLICT;
    case 'INFRASTRUCTURE_UNAVAILABLE':
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.UNPROCESSABLE_ENTITY;
  }
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'internal server error';
    let details: Readonly<Record<string, unknown>> | undefined;

    if (exception instanceof AppException) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof DomainError) {
      status = domainStatus(exception.code);
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = statusToCode(status);
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : ((res as { message?: string }).message ?? message);
    } else if (exception instanceof Error) {
      logger.error(exception.message, exception.stack);
      message = 'internal server error';
    }

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['X-Correlation-Id'] as string | undefined) ??
      undefined;
    if (correlationId) {
      response.setHeader('X-Correlation-Id', correlationId);
    }
    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      response.setHeader('Retry-After', '5');
    }
    if (
      code === 'BUSINESS_REJECTION' &&
      details &&
      typeof details === 'object' &&
      'transactionId' in details &&
      'status' in details
    ) {
      response.status(status).json(details);
      return;
    }
    response.status(status).json({
      code,
      message,
      details,
      correlationId
    });
  }
}
