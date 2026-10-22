import type { FailureCode } from '../failure-codes';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code?: FailureCode,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_MONEY');
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(left: string, right: string) {
    super(`currency mismatch: ${left} vs ${right}`, 'WALLET_CURRENCY_MISMATCH');
  }
}

export class InsufficientBalanceError extends DomainError {
  constructor(message = 'insufficient balance') {
    super(message, 'INSUFFICIENT_BALANCE');
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_TRANSITION');
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message = 'idempotency key reused with different payload') {
    super(message, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
  }
}

export class BusinessRuleViolationError extends DomainError {
  constructor(
    public readonly failureCode: FailureCode,
    message: string,
  ) {
    super(message, failureCode);
  }
}
