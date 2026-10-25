import { EntitySchema } from '@mikro-orm/core';

export class InboxRecord {
  id!: string;
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt!: Date | null;
}

export const InboxRecordSchema = new EntitySchema<InboxRecord>({
  class: InboxRecord,
  tableName: 'inbox_messages',
  properties: {
    id: { type: 'uuid', primary: true },
    consumerName: { type: 'string', fieldName: 'consumer_name' },
    messageId: { type: 'string', fieldName: 'message_id' },
    payloadHash: { type: 'string', fieldName: 'payload_hash', columnType: 'char(64)' },
    receivedAt: { type: 'Date', fieldName: 'received_at', columnType: 'timestamptz' },
    processedAt: { type: 'Date', fieldName: 'processed_at', columnType: 'timestamptz', nullable: true }
  }
});
