import { EntityManager } from '@mikro-orm/postgresql';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { OutboxMessage } from '../../domain/outbox-message';
import type { OutboxRepository } from '../../domain/outbox.repository';
import { OutboxRecord } from './outbox-message.record';
import { LockMode } from '@mikro-orm/core';

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepository {
  private readonly repo: EntityRepository<OutboxRecord>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    this.repo = this.em.getRepository(OutboxRecord);
  }

  async insert(message: OutboxMessage): Promise<void> {
    const record = new OutboxRecord();
    record.id = message.id;
    record.aggregateId = message.aggregateId;
    record.eventType = message.eventType;
    record.payload = message.payload as never;
    record.occurredAt = message.occurredAt;
    record.attempts = message.attempts;
    record.nextAttemptAt = message.nextAttemptAt ?? null;
    record.publishedAt = message.publishedAt ?? null;
    await this.em.persistAndFlush(record);
  }

  async findDueForUpdate(now: Date, limit: number): Promise<OutboxMessage[]> {
    const qb = this.repo
      .createQueryBuilder('o')
      .where({ publishedAt: null })
      .andWhere('(o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)', [now])
      .orderBy({ occurredAt: 'asc', id: 'asc' })
      .limit(limit);
    const records = await qb.getResultList({ lockMode: LockMode.PESSIMISTIC_WRITE, lockVersion: undefined } as never);
    const locked = await this.em.execute(
      `select id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at
       from outbox_messages
       where published_at is null and (next_attempt_at is null or next_attempt_at <= ?)
       order by occurred_at asc, id asc
       for update skip locked
       limit ?`,
      [now, limit]
    );
    if (Array.isArray(locked) && locked.length > 0) {
      const ids = (locked as Array<{ id: string }>).map((r) => r.id);
      const recordsById = await this.repo.find({ id: { $in: ids } } as never);
      const map = new Map(recordsById.map((r) => [r.id, r]));
      const ordered = ids.map((id) => map.get(id)).filter((r): r is OutboxRecord => r !== undefined);
      return ordered.map((record) => this.toDomain(record));
    }
    return records.map((record) => this.toDomain(record));
  }

  async markPublished(id: string, at: Date): Promise<void> {
    const record = await this.repo.findOne({ id });
    if (record === null) {
      return;
    }
    record.publishedAt = at;
    record.nextAttemptAt = null;
    await this.em.flush();
  }

  async scheduleRetry(id: string, now: Date, baseMs: number, maxMs: number): Promise<void> {
    const record = await this.repo.findOne({ id });
    if (record === null) {
      return;
    }
    if (record.publishedAt !== null) {
      return;
    }
    const attempts = record.attempts + 1;
    const delay = backoffMs(attempts, baseMs, maxMs, id);
    record.attempts = attempts;
    record.nextAttemptAt = new Date(now.getTime() + delay);
    await this.em.flush();
  }

  async countPending(now: Date): Promise<number> {
    return this.repo.count({
      publishedAt: null,
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }]
    } as never);
  }

  async oldestPendingAgeSeconds(now: Date): Promise<number> {
    const record = await this.repo.findOne({ publishedAt: null } as never, {
      orderBy: { occurredAt: 'asc' }
    });
    if (record === null) {
      return 0;
    }
    return Math.max(0, (now.getTime() - record.occurredAt.getTime()) / 1000);
  }

  private toDomain(record: OutboxRecord): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: record.id,
      aggregateId: record.aggregateId,
      eventType: record.eventType,
      payload: record.payload,
      occurredAt: record.occurredAt,
      attempts: record.attempts,
      nextAttemptAt: record.nextAttemptAt ?? undefined,
      publishedAt: record.publishedAt ?? undefined
    });
  }
}

function backoffMs(attempt: number, baseMs: number, maxMs: number, seed: string): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(baseMs * 2 ** exponent, maxMs);
  const jitter = 0.8 + hashToUnit(seed) * 0.4;
  return Math.max(1, Math.round(raw * jitter));
}

function hashToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
