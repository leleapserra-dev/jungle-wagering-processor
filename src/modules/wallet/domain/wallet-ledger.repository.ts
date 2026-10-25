import type { Money } from '../../../shared/domain/money';
import type { WalletLedgerEntry } from './wallet-ledger-entry';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  nextCursor: LedgerCursor | null;
}

export interface WalletLedgerRepository {
  insert(entry: WalletLedgerEntry): Promise<void>;
  findPage(walletId: string, cursor: LedgerCursor | null, limit: number): Promise<LedgerPage>;
  calculateBalance(walletId: string, currency: string): Promise<Money>;
  count(walletId: string): Promise<number>;
}
