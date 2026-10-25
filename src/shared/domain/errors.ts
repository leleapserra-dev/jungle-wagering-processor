export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidWalletStateError extends DomainError {
  readonly code = 'INVALID_WALLET_STATE';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class ReversalWouldOverdrawError extends DomainError {
  readonly code = 'REVERSAL_WOULD_OVERDRAW';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidWagerTransactionError extends DomainError {
  readonly code = 'INVALID_WAGER_TRANSACTION';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidLedgerEntryError extends DomainError {
  readonly code = 'INVALID_LEDGER_ENTRY';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidInboxStateError extends DomainError {
  readonly code = 'INVALID_INBOX_STATE';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InvalidOutboxStateError extends DomainError {
  readonly code = 'INVALID_OUTBOX_STATE';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_CONFLICT';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class ExternalTransactionConflictError extends DomainError {
  readonly code = 'EXTERNAL_TRANSACTION_CONFLICT';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class PersistenceConflictError extends DomainError {
  readonly code = 'PERSISTENCE_CONFLICT';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}

export class InfrastructureUnavailableError extends DomainError {
  readonly code = 'INFRASTRUCTURE_UNAVAILABLE';
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(message, details);
  }
}
