import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../../../config/app-config';
import type { OutboxRepository } from '../domain/outbox.repository';

@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickPromise: Promise<void> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject('OutboxRepository') private readonly outboxRepo: OutboxRepository,
    @Inject('SqsClientService')
    private readonly sqs: {
      sendMessage: (
        queueUrl: string,
        body: string,
        messageGroupId?: string,
        messageDeduplicationId?: string
      ) => Promise<unknown>;
    },
    @Inject('EntityManager')
    private readonly em: { transactional: <T>(work: () => Promise<T>) => Promise<T> }
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.outboxEnabled) return;
    this.stopped = false;
    this.startTick();
    this.timer = setInterval(() => {
      this.startTick();
    }, this.config.outboxPollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
    if (this.tickPromise !== null) {
      await this.tickPromise;
    }
  }

  private startTick(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.tickPromise = this.tick()
      .catch((error: unknown) => {
        this.logger.error('outbox tick failed', error instanceof Error ? error.stack : String(error));
      })
      .finally(() => {
        this.running = false;
        this.tickPromise = null;
      });
  }

  private async tick(): Promise<void> {
    const now = new Date();
    await this.em.transactional(async () => {
      const messages = await this.outboxRepo.findDueForUpdate(now, this.config.outboxBatchSize);
      for (const message of messages) {
        const groupId = message.aggregateId;
        const dedupId = message.id;
        const queueUrl = this.config.sqsEventsQueueUrl ?? this.config.sqsQueueUrl;
        const body = JSON.stringify({
          messageId: message.id,
          type: message.eventType,
          occurredAt: message.occurredAt.toISOString(),
          data: message.payload.data
        });

        try {
          if (message.attempts >= this.config.outboxMaxAttempts) {
            await this.sqs.sendMessage(this.config.sqsDlqUrl, body, groupId, dedupId);
            await this.outboxRepo.markPublished(message.id, new Date());
            this.logger.warn(`moved outbox message ${message.id} to DLQ after ${message.attempts} attempts`);
            continue;
          }
          await this.sqs.sendMessage(queueUrl, body, groupId, dedupId);
          await this.outboxRepo.markPublished(message.id, new Date());
        } catch {
          await this.outboxRepo.scheduleRetry(
            message.id,
            new Date(),
            this.config.outboxBackoffBaseMs,
            this.config.outboxBackoffMaxMs
          );
        }
      }
    });
  }
}
