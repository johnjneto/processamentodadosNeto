import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  BusinessRuleViolationError,
  DomainError,
  IdempotencyConflictError,
  InvalidMoneyError,
} from '../../domain';

/**
 * HTTP status mapping (consistent across endpoints):
 * - 400 INVALID_PAYLOAD / INVALID_MONEY
 * - 409 IDEMPOTENCY_PAYLOAD_CONFLICT / DUPLICATE_WALLET
 * - 422 business rule rejection (insufficient balance, reference errors, …)
 * - 202 accepted but pending (PENDING / PENDING_REFERENCE)
 * - 503 transient infrastructure
 * - 500 unexpected
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json(exception.getResponse());
      return;
    }

    if (exception instanceof IdempotencyConflictError) {
      res.status(HttpStatus.CONFLICT).json({
        error: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof InvalidMoneyError) {
      res.status(HttpStatus.BAD_REQUEST).json({
        error: 'INVALID_MONEY',
        message: exception.message,
      });
      return;
    }

    if (exception instanceof BusinessRuleViolationError) {
      const code = exception.failureCode;
      const status =
        code === 'DUPLICATE_WALLET'
          ? HttpStatus.CONFLICT
          : code === 'WALLET_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.UNPROCESSABLE_ENTITY;
      res.status(status).json({
        error: code,
        message: exception.message,
      });
      return;
    }

    if (exception instanceof DomainError) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        error: exception.code ?? 'DOMAIN_ERROR',
        message: exception.message,
      });
      return;
    }

    this.logger.error(
      JSON.stringify({
        msg: 'unhandled_error',
        error: (exception as Error)?.message,
      }),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'INTERNAL_ERROR',
      message: 'unexpected error',
    });
  }
}
