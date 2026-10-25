import type { InboxMessage } from './inbox-message';

export interface InboxRepository {
  tryInsert(message: InboxMessage): Promise<boolean>;
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  markProcessed(consumerName: string, messageId: string, at: Date): Promise<void>;
}
