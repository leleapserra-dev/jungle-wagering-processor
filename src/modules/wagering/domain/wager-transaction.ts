import { InvalidTransactionStateError, InvalidWagerTransactionError } from '../../../shared/domain/errors';
import type { Money } from '../../../shared/domain/money';
import { LedgerDirection } from '../../wallet/domain/ledger-direction';
import type { FailureCode } from './failure-code';
import { WagerTransactionKind, WagerTransactionStatus } from './wager-transaction-status';

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  observedBalance: Money;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  observedBalance: Money;
  referenceAttempts: number;
  nextReferenceAttemptAt: Date | undefined;
}

const TERMINAL_STATUSES: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed
]);

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
    private _observedBalance: Money,
    private _referenceAttempts: number,
    private _nextReferenceAttemptAt: Date | undefined
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (
      props.id.length === 0 ||
      props.providerId.length === 0 ||
      props.externalTransactionId.length === 0 ||
      props.idempotencyKey.length === 0 ||
      props.walletId.length === 0 ||
      props.playerId.length === 0
    ) {
      throw new InvalidWagerTransactionError('transaction identifiers must not be empty');
    }
    if (props.referenceExternalTransactionId !== undefined && props.referenceExternalTransactionId.length === 0) {
      throw new InvalidWagerTransactionError('reference external transaction id must not be blank');
    }

    const requiresReference =
      props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback;
    if (requiresReference && props.referenceExternalTransactionId === undefined) {
      throw new InvalidWagerTransactionError(`${props.kind} requires referenceExternalTransactionId`, {
        kind: props.kind
      });
    }
    if (props.kind === WagerTransactionKind.Loss) {
      if (props.money.isNegative()) {
        throw new InvalidWagerTransactionError('LOSS amount cannot be negative');
      }
    } else if (!props.money.isPositive()) {
      throw new InvalidWagerTransactionError(`${props.kind} amount must be positive`, { kind: props.kind });
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
      props.observedBalance,
      0,
      undefined
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.observedBalance,
      state.referenceAttempts,
      state.nextReferenceAttemptAt
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get observedBalance(): Money {
    return this._observedBalance;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date, observedBalance: Money): void {
    this.assertTransitionable();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._observedBalance = observedBalance;
    this._nextReferenceAttemptAt = undefined;
  }

  markPendingReference(at: Date, nextAttemptAt: Date, observedBalance: Money): void {
    this.assertTransitionable();
    this._status = WagerTransactionStatus.PendingReference;
    this._processedAt = at;
    this._observedBalance = observedBalance;
    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
  }

  rescheduleReference(nextAttemptAt: Date, observedBalance: Money): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError('only PENDING_REFERENCE transactions can be rescheduled', {
        transactionId: this.id,
        status: this._status
      });
    }
    this._observedBalance = observedBalance;
    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
  }

  reject(code: FailureCode, at: Date, observedBalance: Money): void {
    this.assertTransitionable();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
    this._observedBalance = observedBalance;
    this._nextReferenceAttemptAt = undefined;
  }

  fail(code: FailureCode, at: Date, observedBalance: Money): void {
    this.assertTransitionable();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
    this._observedBalance = observedBalance;
    this._nextReferenceAttemptAt = undefined;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  hasExhaustedReferenceAttempts(maxAttempts: number): boolean {
    return this._referenceAttempts >= maxAttempts;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        return undefined;
      case WagerTransactionKind.Rollback:
        if (reference === undefined) {
          throw new InvalidWagerTransactionError('ROLLBACK direction requires a reference transaction');
        }
        return this.inverseDirectionOf(reference.kind);
    }
  }

  private inverseDirectionOf(kind: WagerTransactionKind): LedgerDirection {
    switch (kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Loss:
      case WagerTransactionKind.Rollback:
        throw new InvalidWagerTransactionError(`cannot inverse a ${kind} transaction`, { kind });
    }
  }

  private assertTransitionable(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError('terminal transactions cannot change state', {
        transactionId: this.id,
        status: this._status
      });
    }
  }
}
