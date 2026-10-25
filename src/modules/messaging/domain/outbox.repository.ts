import type { OutboxMessage } from './outbox-message';

export interface OutboxRepository {
  insert(message: OutboxMessage): Promise<void>;
  findDueForUpdate(now: Date, limit: number): Promise<OutboxMessage[]>;
  markPublished(id: string, at: Date): Promise<void>;
  scheduleRetry(id: string, now: Date, baseMs: number, maxMs: number): Promise<void>;
  countPending(now: Date): Promise<number>;
  oldestPendingAgeSeconds(now: Date): Promise<number>;
}
