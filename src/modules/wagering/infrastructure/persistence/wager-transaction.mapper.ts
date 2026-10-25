import { Money } from '../../../../shared/domain/money';
import { WagerTransaction } from '../../domain/wager-transaction';
import { WagerTransactionRecord } from './wager-transaction.record';

export class WagerTransactionMapper {
  static toDomain(record: WagerTransactionRecord): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: record.id,
      providerId: record.providerId,
      externalTransactionId: record.externalTransactionId,
      idempotencyKey: record.idempotencyKey,
      payloadHash: record.payloadHash,
      walletId: record.walletId,
      playerId: record.playerId,
      roundId: record.roundId,
      gameId: record.gameId,
      kind: record.kind,
      money: Money.rehydrate({ amount: record.moneyAmount, currency: record.moneyCurrency }),
      referenceExternalTransactionId: record.referenceExternalTransactionId ?? undefined,
      createdAt: record.createdAt,
      status: record.status,
      referenceTransactionId: record.referenceTransactionId ?? undefined,
      failureCode: record.failureCode as never,
      processedAt: record.processedAt ?? undefined,
      observedBalance: Money.rehydrate({ amount: record.observedBalance, currency: record.observedBalanceCurrency }),
      referenceAttempts: record.referenceAttempts,
      nextReferenceAttemptAt: record.nextReferenceAttemptAt ?? undefined
    });
  }

  static toRecord(transaction: WagerTransaction): WagerTransactionRecord {
    const record = Object.create(WagerTransactionRecord.prototype) as WagerTransactionRecord;
    record.id = transaction.id;
    record.providerId = transaction.providerId;
    record.externalTransactionId = transaction.externalTransactionId;
    record.idempotencyKey = transaction.idempotencyKey;
    record.payloadHash = transaction.payloadHash;
    record.walletId = transaction.walletId;
    record.playerId = transaction.playerId;
    record.roundId = transaction.roundId;
    record.gameId = transaction.gameId;
    record.kind = transaction.kind;
    record.moneyAmount = transaction.money.toJSON().amount;
    record.moneyCurrency = transaction.money.currency;
    record.referenceExternalTransactionId = transaction.referenceExternalTransactionId ?? null;
    record.status = transaction.status;
    record.referenceTransactionId = transaction.referenceTransactionId ?? null;
    record.failureCode = transaction.failureCode ?? null;
    record.createdAt = transaction.createdAt;
    record.processedAt = transaction.processedAt ?? null;
    record.observedBalance = transaction.observedBalance.toJSON().amount;
    record.observedBalanceCurrency = transaction.observedBalance.currency;
    record.referenceAttempts = transaction.referenceAttempts;
    record.nextReferenceAttemptAt = transaction.nextReferenceAttemptAt ?? null;
    return record;
  }
}
