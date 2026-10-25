import { InvalidOutboxStateError } from '../../../shared/domain/errors';
import type { IntegrationEvent, SerializedIntegrationEvent } from '../../../shared/domain/integration-event';
import { exponentialBackoffMs } from '../../../shared/domain/backoff';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<SerializedIntegrationEvent<unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<SerializedIntegrationEvent<unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt: Date | undefined,
    private _publishedAt: Date | undefined
  ) {}

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      Object.freeze(event.toJSON()),
      event.occurredAt,
      0,
      undefined,
      undefined
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      Object.freeze(state.payload),
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }
    return this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime();
  }

  markPublished(at: Date): void {
    if (!this.isPending()) {
      throw new InvalidOutboxStateError('outbox message was already published', { id: this.id });
    }
    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(now: Date, baseMs: number, maxMs: number): void {
    if (!this.isPending()) {
      throw new InvalidOutboxStateError('published outbox messages cannot be retried', { id: this.id });
    }
    this._attempts += 1;
    const delay = exponentialBackoffMs(this._attempts, baseMs, maxMs, this.id);
    this._nextAttemptAt = new Date(now.getTime() + delay);
  }
}
