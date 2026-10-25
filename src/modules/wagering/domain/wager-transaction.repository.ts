import type { WagerTransaction } from './wager-transaction';

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdForUpdate(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null>;
  findByProviderExternal(providerId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
  findProcessedReversal(referenceTransactionId: string, kind: string): Promise<WagerTransaction | null>;
  findDuePendingReferenceIds(now: Date, limit: number): Promise<string[]>;
  insert(transaction: WagerTransaction): Promise<void>;
  insertIfAbsent(transaction: WagerTransaction): Promise<boolean>;
  update(transaction: WagerTransaction): Promise<void>;
}
