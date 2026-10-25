import { EntityManager } from '@mikro-orm/postgresql';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { WalletMapper } from './wallet.mapper';
import { WalletRecord } from './wallet.record';
import type { WalletRepository } from '../../domain/wallet.repository';
import type { Wallet } from '../../domain/wallet';
import { LockMode } from '@mikro-orm/core';

@Injectable()
export class MikroOrmWalletRepository implements WalletRepository {
  private readonly repo: EntityRepository<WalletRecord>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    this.repo = this.em.getRepository(WalletRecord);
  }

  async findById(id: string): Promise<Wallet | null> {
    const record = await this.repo.findOne({ id });
    return record === null ? null : WalletMapper.toDomain(record);
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const record = await this.repo.findOne({ id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return record === null ? null : WalletMapper.toDomain(record);
  }

  async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const record = await this.repo.findOne({ playerId, currency });
    return record === null ? null : WalletMapper.toDomain(record);
  }

  async insert(wallet: Wallet): Promise<void> {
    const record = WalletMapper.toRecord(wallet);
    await this.em.persistAndFlush(record);
  }

  async update(wallet: Wallet): Promise<void> {
    const existing = await this.repo.findOne({ id: wallet.id });
    if (existing === null) {
      throw new Error('cannot update non-existent wallet');
    }
    existing.balance = wallet.balance.toJSON().amount;
    existing.version = wallet.version;
    existing.updatedAt = wallet.updatedAt;
    await this.em.flush();
  }
}
