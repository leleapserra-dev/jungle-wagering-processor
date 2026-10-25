import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../../../config/app-config';
import { exponentialBackoffMs } from '../../../shared/domain/backoff';
import { DomainError, InfrastructureUnavailableError } from '../../../shared/domain/errors';
import { UuidV7Generator } from '../../../shared/domain/identity';
import { Money } from '../../../shared/domain/money';
import { Sha256PayloadHasher } from '../../../shared/payload-hasher';
import { ProcessWagerTransactionUseCase } from '../../wagering/application/process-wager-transaction.use-case';
import { InboxMessage } from '../domain/inbox-message';
import { dlqMessagesTotal, retriesTotal } from '../../../shared/observability/metrics';

const COMMAND_TYPES = new Set(['ProcessWagerTransaction', 'WagerTransactionRequested']);

const envelopeSchema = z
  .object({
    messageId: z.string().min(1).max(256),
    type: z.string().min(1).max(128),
    occurredAt: z.string().datetime(),
    data: z.unknown()
  })
  .strict();

const amountPattern = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;
const currencyPattern = /^[A-Z]{3}$/;

const commandSchema = z
  .object({
    idempotencyKey: z.string().min(1).max(200),
    providerId: z.string().min(1).max(128),
    externalTransactionId: z.string().min(1).max(256),
    playerId: z.string().min(1).max(128),
    walletId: z.string().uuid(),
    roundId: z.string().min(1).max(128),
    gameId: z.string().min(1).max(128),
    kind: z.enum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']),
    money: z
      .object({
        amount: z.string().regex(amountPattern),
        currency: z.string().regex(currencyPattern)
      })
      .strict(),
    referenceExternalTransactionId: z.string().min(1).max(256).optional(),
    correlationId: z.string().min(1).max(128).optional()
  })
  .strict();

type WagerCommand = z.infer<typeof commandSchema>;

interface SqsMessage {
  ReceiptHandle?: string;
  MessageId?: string;
  MessageDeduplicationId?: string;
  Body?: string;
  Attributes?: Record<string, string>;
}

class PermanentMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMessageError';
  }
}

@Injectable()
export class SqsConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private pollPromise: Promise<void> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject('SqsClientService')
    private readonly sqs: {
      receiveMessages: (
        queueUrl: string,
        maxMessages: number,
        visibilityTimeout: number,
        waitTimeSeconds?: number
      ) => Promise<SqsMessage[]>;
      deleteMessage: (queueUrl: string, receiptHandle: string) => Promise<void>;
      changeVisibility: (queueUrl: string, receiptHandle: string, visibilityTimeout: number) => Promise<void>;
      sendMessage: (
        queueUrl: string,
        body: string,
        messageGroupId?: string,
        messageDeduplicationId?: string
      ) => Promise<string | undefined>;
    },
    @Inject(ProcessWagerTransactionUseCase) private readonly processTx: ProcessWagerTransactionUseCase,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator,
    @Inject(Sha256PayloadHasher) private readonly hasher: Sha256PayloadHasher
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.sqsConsumerEnabled) return;
    this.stopped = false;
    this.startPoll();
    this.timer = setInterval(() => {
      this.startPoll();
    }, 1000);
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
    if (this.pollPromise !== null) {
      await this.pollPromise;
    }
  }

  private startPoll(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.pollPromise = this.pollOnce()
      .catch((error: unknown) => {
        this.logger.error('sqs poll failed', error instanceof Error ? error.stack : String(error));
      })
      .finally(() => {
        this.running = false;
        this.pollPromise = null;
      });
  }

  private async pollOnce(): Promise<void> {
    const messages = await this.sqs.receiveMessages(
      this.config.sqsQueueUrl,
      10,
      this.config.sqsVisibilityTimeoutSeconds,
      5
    );
    for (const message of messages) {
      await this.handleMessage(message);
      if (this.stopped) break;
    }
  }

  private async handleMessage(message: SqsMessage): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (receiptHandle === undefined) return;

    const body = message.Body ?? '{}';
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    if (Number.isFinite(receiveCount) && receiveCount > this.config.sqsMaxReceiveCount) {
      await this.deadLetter(message, body, `receive count ${receiveCount} exceeded`);
      return;
    }

    try {
      const parsed = this.parse(body);
      await this.processTx.execute({
        correlationId: parsed.command.correlationId ?? this.ids.next(),
        providerId: parsed.command.providerId,
        externalTransactionId: parsed.command.externalTransactionId,
        idempotencyKey: parsed.command.idempotencyKey,
        payloadHash: this.payloadHash(parsed.command),
        walletId: parsed.command.walletId,
        playerId: parsed.command.playerId,
        roundId: parsed.command.roundId,
        gameId: parsed.command.gameId,
        kind: parsed.command.kind,
        money: Money.from(parsed.command.money),
        referenceExternalTransactionId: parsed.command.referenceExternalTransactionId,
        at: new Date(),
        inboxMessage: InboxMessage.receive({
          id: this.ids.next(),
          messageId: parsed.messageId,
          consumerName: this.config.sqsConsumerName,
          payloadHash: this.payloadHash(parsed.command),
          receivedAt: new Date()
        })
      });
      await this.ack(message);
    } catch (error) {
      await this.handleFailure(message, body, error, receiveCount);
    }
  }

  private parse(body: string): { messageId: string; command: WagerCommand } {
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new PermanentMessageError('message body is not valid JSON');
    }
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success) {
      throw new PermanentMessageError('message envelope is invalid');
    }
    if (!COMMAND_TYPES.has(envelope.data.type)) {
      throw new PermanentMessageError(`unsupported message type: ${envelope.data.type}`);
    }
    const command = commandSchema.safeParse(envelope.data.data);
    if (!command.success) {
      throw new PermanentMessageError('message data is invalid');
    }
    return { messageId: envelope.data.messageId, command: command.data };
  }

  private payloadHash(command: WagerCommand): string {
    return this.hasher.hash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId ?? null
    });
  }

  private async handleFailure(message: SqsMessage, body: string, error: unknown, receiveCount: number): Promise<void> {
    const permanentCodes = new Set(['INVALID_WAGER_TRANSACTION', 'INVALID_MONEY']);
    const permanent =
      error instanceof PermanentMessageError ||
      error instanceof SyntaxError ||
      (error instanceof DomainError && permanentCodes.has(error.code));

    if (permanent) {
      await this.deadLetter(message, body, 'permanent failure');
      return;
    }

    if (error instanceof DomainError && !(error instanceof InfrastructureUnavailableError)) {
      this.logger.warn(`acking business failure: ${error.code}`);
      await this.safeDelete(message);
      return;
    }

    retriesTotal.inc({ component: 'sqs-consumer' });
    const delaySeconds = this.backoffSeconds(receiveCount, message.MessageId ?? this.ids.next());
    try {
      if (message.ReceiptHandle !== undefined) {
        await this.sqs.changeVisibility(this.config.sqsQueueUrl, message.ReceiptHandle, delaySeconds);
      }
    } catch (visibilityError) {
      this.logger.error(
        'failed to schedule sqs retry',
        visibilityError instanceof Error ? visibilityError.stack : String(visibilityError)
      );
    }
  }

  private async deadLetter(message: SqsMessage, body: string, reason: string): Promise<void> {
    const groupId = message.Attributes?.MessageGroupId ?? this.ids.next();
    const dedupId = message.MessageId ?? this.ids.next();
    try {
      await this.sqs.sendMessage(this.config.sqsDlqUrl, body, groupId, dedupId);
      await this.ack(message);
      dlqMessagesTotal.inc({ source: 'sqs-consumer' });
      this.logger.warn(`moved message to DLQ: ${reason}`);
    } catch (error) {
      this.logger.error('failed to move message to DLQ', error instanceof Error ? error.stack : String(error));
      await this.handleFailure(message, body, new InfrastructureUnavailableError('DLQ unavailable'), 1);
    }
  }

  private async ack(message: SqsMessage): Promise<void> {
    if (message.ReceiptHandle === undefined) return;
    await this.safeDelete(message);
  }

  private async safeDelete(message: SqsMessage): Promise<void> {
    if (message.ReceiptHandle === undefined) return;
    try {
      await this.sqs.deleteMessage(this.config.sqsQueueUrl, message.ReceiptHandle);
    } catch (error) {
      this.logger.error('failed to delete sqs message', error instanceof Error ? error.stack : String(error));
    }
  }

  private backoffSeconds(receiveCount: number, seed: string): number {
    const attempt = Number.isFinite(receiveCount) ? Math.max(1, receiveCount) : 1;
    const delayMs = exponentialBackoffMs(
      attempt,
      this.config.sqsBackoffBaseSeconds * 1000,
      this.config.sqsBackoffMaxSeconds * 1000,
      seed
    );
    return Math.min(this.config.sqsBackoffMaxSeconds, Math.max(1, Math.round(delayMs / 1000)));
  }
}
