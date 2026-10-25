import { EntitySchema } from '@mikro-orm/core';
import type { SerializedIntegrationEvent } from '../../../../shared/domain/integration-event';

export class OutboxRecord {
  id!: string;
  aggregateId!: string;
  eventType!: string;
  payload!: SerializedIntegrationEvent<unknown>;
  occurredAt!: Date;
  attempts!: number;
  nextAttemptAt!: Date | null;
  publishedAt!: Date | null;
}

export const OutboxRecordSchema = new EntitySchema<OutboxRecord>({
  class: OutboxRecord,
  tableName: 'outbox_messages',
  properties: {
    id: { type: 'uuid', primary: true },
    aggregateId: { type: 'string', fieldName: 'aggregate_id' },
    eventType: { type: 'string', fieldName: 'event_type' },
    payload: { type: 'json', columnType: 'jsonb' },
    occurredAt: { type: 'Date', fieldName: 'occurred_at', columnType: 'timestamptz' },
    attempts: { type: 'integer' },
    nextAttemptAt: { type: 'Date', fieldName: 'next_attempt_at', columnType: 'timestamptz', nullable: true },
    publishedAt: { type: 'Date', fieldName: 'published_at', columnType: 'timestamptz', nullable: true }
  }
});
