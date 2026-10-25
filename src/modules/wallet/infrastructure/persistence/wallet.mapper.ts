import { Money } from '../../../../shared/domain/money';
import type { LedgerDirection } from '../../domain/ledger-direction';
import { Wallet } from '../../domain/wallet';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { LedgerRecord } from './ledger-entry.record';
import { WalletRecord } from './wallet.record';

export class WalletMapper {
  static toDomain(record: WalletRecord): Wallet {
    return Wallet.rehydrate({
      id: record.id,
      playerId: record.playerId,
      currency: record.currency,
      balance: Money.rehydrate({ amount: record.balance, currency: record.currency }),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    });
  }

  static toRecord(wallet: Wallet): WalletRecord {
    const record = Object.create(WalletRecord.prototype) as WalletRecord;
    record.id = wallet.id;
    record.playerId = wallet.playerId;
    record.currency = wallet.currency;
    record.balance = wallet.balance.toJSON().amount;
    record.version = wallet.version;
    record.createdAt = (wallet as unknown as { createdAt: Date }).createdAt;
    record.updatedAt = wallet.updatedAt;
    return record;
  }
}

export class LedgerMapper {
  static toDomain(record: LedgerRecord): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: record.id,
      walletId: record.walletId,
      transactionId: record.transactionId,
      direction: record.direction as LedgerDirection,
      money: Money.rehydrate({ amount: record.amount, currency: record.currency }),
      balanceBefore: Money.rehydrate({ amount: record.balanceBefore, currency: record.currency }),
      balanceAfter: Money.rehydrate({ amount: record.balanceAfter, currency: record.currency }),
      createdAt: record.createdAt
    });
  }

  static toRecord(entry: WalletLedgerEntry): LedgerRecord {
    const record = Object.create(LedgerRecord.prototype) as LedgerRecord;
    record.id = entry.id;
    record.walletId = entry.walletId;
    record.transactionId = entry.transactionId;
    record.direction = entry.direction;
    record.amount = entry.money.toJSON().amount;
    record.currency = entry.money.currency;
    record.balanceBefore = entry.balanceBefore.toJSON().amount;
    record.balanceAfter = entry.balanceAfter.toJSON().amount;
    record.createdAt = entry.createdAt;
    return record;
  }
}
