import { EntityManager } from '@mikro-orm/postgresql';
import type { EntityRepository } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { InboxMessage } from '../../domain/inbox-message';
import type { InboxRepository } from '../../domain/inbox.repository';
import { InboxRecord } from './inbox-message.record';

@Injectable()
export class MikroOrmInboxRepository implements InboxRepository {
  private readonly repo: EntityRepository<InboxRecord>;

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {
    this.repo = this.em.getRepository(InboxRecord);
  }

  async tryInsert(message: InboxMessage): Promise<boolean> {
    const result = await this.em.execute(
      `insert into "inbox_messages" ("id", "consumer_name", "message_id", "payload_hash", "received_at", "processed_at")
       values (?, ?, ?, ?, ?, null)
       on conflict ("consumer_name", "message_id") do nothing
       returning "id"`,
      [message.id, message.consumerName, message.messageId, message.payloadHash, message.receivedAt]
    );
    return Array.isArray(result) && result.length > 0;
  }

  async find(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const record = await this.repo.findOne({ consumerName, messageId });
    return record === null ? null : this.toDomain(record);
  }

  async markProcessed(consumerName: string, messageId: string, at: Date): Promise<void> {
    const record = await this.repo.findOne({ consumerName, messageId });
    if (record === null) {
      throw new Error('inbox message not found');
    }
    record.processedAt = at;
    await this.em.flush();
  }

  private toDomain(record: InboxRecord): InboxMessage {
    return InboxMessage.rehydrate({
      id: record.id,
      messageId: record.messageId,
      consumerName: record.consumerName,
      payloadHash: record.payloadHash,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt ?? undefined
    });
  }
}
