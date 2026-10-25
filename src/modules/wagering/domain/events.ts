import type { MoneyProps } from '../../../shared/domain/money';
import { IntegrationEvent, type EventContext } from '../../../shared/domain/integration-event';
import type { LedgerDirection } from '../../wallet/domain/ledger-direction';
import type { Wallet } from '../../wallet/domain/wallet';
import type { WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import type { FailureCode } from './failure-code';
import type { WagerTransaction } from './wager-transaction';
import type { WagerTransactionKind, WagerTransactionStatus } from './wager-transaction-status';

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  status: WagerTransactionStatus;
  money: MoneyProps;
  observedBalance: MoneyProps;
  referenceTransactionId: string | null;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        kind: transaction.kind,
        status: transaction.status,
        money: transaction.money.toJSON(),
        observedBalance: transaction.observedBalance.toJSON(),
        referenceTransactionId: transaction.referenceTransactionId ?? null
      }
    });
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  playerId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  failureCode: FailureCode;
  money: MoneyProps;
  observedBalance: MoneyProps;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    if (transaction.failureCode === undefined) {
      throw new Error('cannot emit rejection event without a failure code');
    }
    return new WagerTransactionRejected({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        kind: transaction.kind,
        failureCode: transaction.failureCode,
        money: transaction.money.toJSON(),
        observedBalance: transaction.observedBalance.toJSON()
      }
    });
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: WagerTransactionKind;
  referenceExternalTransactionId: string;
  attempts: number;
  nextAttemptAt: string;
  money: MoneyProps;
  observedBalance: MoneyProps;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    if (transaction.referenceExternalTransactionId === undefined || transaction.nextReferenceAttemptAt === undefined) {
      throw new Error('cannot emit pending-reference event without reference data');
    }
    return new WagerTransactionPendingReference({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        kind: transaction.kind,
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
        attempts: transaction.referenceAttempts,
        nextAttemptAt: transaction.nextReferenceAttemptAt.toISOString(),
        money: transaction.money.toJSON(),
        observedBalance: transaction.observedBalance.toJSON()
      }
    });
  }
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(wallet: Wallet, entry: WalletLedgerEntry, ctx: EventContext): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: ctx.eventId,
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version
      }
    });
  }
}
