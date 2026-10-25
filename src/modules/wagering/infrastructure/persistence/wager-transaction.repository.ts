import { EntityManager } from '@mikro-orm/postgresql';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { WagerTransactionRecord } from './wager-transaction.record';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import type { WagerTransactionRepository } from '../../domain/wager-transaction.repository';
import type { WagerTransaction } from '../../domain/wager-transaction';
import type { WagerTransactionKind } from '../../domain/wager-transaction-status';
import { WagerTransactionStatus } from '../../domain/wager-transaction-status';
import { LockMode } from '@mikro-orm/core';

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  private readonly repo: EntityRepository<WagerTransactionRecord>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    this.repo = this.em.getRepository(WagerTransactionRecord);
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const record = await this.repo.findOne({ id });
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }

  async findByIdForUpdate(id: string): Promise<WagerTransaction | null> {
    const record = await this.repo.findOne({ id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const record = await this.repo.findOne({ idempotencyKey });
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }

  async findByProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    const record = await this.repo.findOne({ providerId, externalTransactionId });
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }

  async findProcessedReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind
  ): Promise<WagerTransaction | null> {
    const record = await this.repo.findOne({
      referenceTransactionId,
      kind,
      status: WagerTransactionStatus.Processed
    });
    return record === null ? null : WagerTransactionMapper.toDomain(record);
  }

  async findDuePendingReferenceIds(now: Date, limit: number): Promise<string[]> {
    const qb = this.repo
      .createQueryBuilder('t')
      .select('t.id')
      .where({ status: WagerTransactionStatus.PendingReference })
      .andWhere('(t.next_reference_attempt_at IS NULL OR t.next_reference_attempt_at <= ?)', [now])
      .orderBy({ nextReferenceAttemptAt: 'asc', createdAt: 'asc' })
      .limit(limit);
    const rows = await qb.execute('all');
    return (rows as Array<{ id: string }>).map((row) => row.id);
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    const record = WagerTransactionMapper.toRecord(transaction);
    await this.em.persistAndFlush(record);
  }

  async insertIfAbsent(transaction: WagerTransaction): Promise<boolean> {
    const record = WagerTransactionMapper.toRecord(transaction);
    const result = await this.em.execute(
      `insert into "wager_transactions"
        ("id", "provider_id", "external_transaction_id", "idempotency_key", "payload_hash", "wallet_id",
         "player_id", "round_id", "game_id", "kind", "money_amount", "money_currency",
         "reference_external_transaction_id", "status", "reference_transaction_id", "failure_code",
         "created_at", "processed_at", "observed_balance", "observed_balance_currency",
         "reference_attempts", "next_reference_attempt_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict do nothing
       returning "id"`,
      [
        record.id,
        record.providerId,
        record.externalTransactionId,
        record.idempotencyKey,
        record.payloadHash,
        record.walletId,
        record.playerId,
        record.roundId,
        record.gameId,
        record.kind,
        record.moneyAmount,
        record.moneyCurrency,
        record.referenceExternalTransactionId,
        record.status,
        record.referenceTransactionId,
        record.failureCode,
        record.createdAt,
        record.processedAt,
        record.observedBalance,
        record.observedBalanceCurrency,
        record.referenceAttempts,
        record.nextReferenceAttemptAt
      ]
    );
    return Array.isArray(result) && result.length > 0;
  }

  async update(transaction: WagerTransaction): Promise<void> {
    const existing = await this.repo.findOne({ id: transaction.id });
    if (existing === null) {
      throw new Error('cannot update non-existent wager transaction');
    }
    existing.status = transaction.status;
    existing.referenceTransactionId = transaction.referenceTransactionId ?? null;
    existing.failureCode = transaction.failureCode ?? null;
    existing.processedAt = transaction.processedAt ?? null;
    existing.observedBalance = transaction.observedBalance.toJSON().amount;
    existing.observedBalanceCurrency = transaction.observedBalance.currency;
    existing.referenceAttempts = transaction.referenceAttempts;
    existing.nextReferenceAttemptAt = transaction.nextReferenceAttemptAt ?? null;
    await this.em.flush();
  }
}
