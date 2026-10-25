import { EntityManager } from '@mikro-orm/postgresql';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import type { WalletLedgerRepository, LedgerCursor, LedgerPage } from '../../domain/wallet-ledger.repository';
import { LedgerRecord } from './ledger-entry.record';
import { LedgerMapper } from './wallet.mapper';
import { Money } from '../../../../shared/domain/money';

@Injectable()
export class MikroOrmLedgerRepository implements WalletLedgerRepository {
  private readonly repo: EntityRepository<LedgerRecord>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    this.repo = this.em.getRepository(LedgerRecord);
  }

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const record = LedgerMapper.toRecord(entry);
    await this.em.persistAndFlush(record);
  }

  async findPage(walletId: string, cursor: LedgerCursor | null, limit: number): Promise<LedgerPage> {
    const qb = this.repo.createQueryBuilder('e').where({ walletId }).orderBy({ createdAt: 'desc', id: 'desc' }).limit(limit + 1);
    if (cursor !== null) {
      qb.andWhere('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))', [
        cursor.createdAt,
        cursor.createdAt,
        cursor.id
      ]);
    }
    const records = await qb.getResultList();
    const hasMore = records.length > limit;
    const slice = hasMore ? records.slice(0, limit) : records;
    const entries = slice.map((record) => LedgerMapper.toDomain(record));
    const last = slice.at(-1);
    const nextCursor = hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null;
    return { entries, nextCursor };
  }

  async calculateBalance(walletId: string, currency: string): Promise<Money> {
    const result = await this.em.execute(
      `select coalesce(sum(case when direction = 'CREDIT' then amount else -amount end), 0) as total from wallet_ledger_entries where wallet_id = ?`,
      [walletId]
    );
    const total =
      Array.isArray(result) && result.length > 0 ? ((result[0] as { total: string }).total ?? '0.00') : '0.00';
    return Money.rehydrate({ amount: total, currency });
  }

  async count(walletId: string): Promise<number> {
    return this.repo.count({ walletId });
  }
}
