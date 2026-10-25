import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly databasePoolSize: number;
  readonly databaseSsl: boolean;
  readonly awsRegion: string;
  readonly awsAccessKeyId: string | undefined;
  readonly awsSecretAccessKey: string | undefined;
  readonly sqsEndpoint: string | undefined;
  readonly sqsQueueUrl: string;
  readonly sqsDlqUrl: string;
  readonly sqsEventsQueueUrl: string | undefined;
  readonly sqsConsumerEnabled: boolean;
  readonly sqsConsumerName: string;
  readonly sqsMaxReceiveCount: number;
  readonly sqsVisibilityTimeoutSeconds: number;
  readonly sqsBackoffBaseSeconds: number;
  readonly sqsBackoffMaxSeconds: number;
  readonly outboxEnabled: boolean;
  readonly outboxPollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxAttempts: number;
  readonly outboxBackoffBaseMs: number;
  readonly outboxBackoffMaxMs: number;
  readonly pendingReferenceEnabled: boolean;
  readonly pendingReferencePollIntervalMs: number;
  readonly pendingReferenceBatchSize: number;
  readonly pendingReferenceMaxAttempts: number;
  readonly pendingReferenceBackoffBaseMs: number;
  readonly pendingReferenceBackoffMaxMs: number;
  readonly authEnabled: boolean;
  readonly corsOrigins: string[];

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.nodeEnv = config.getOrThrow('NODE_ENV');
    this.port = config.getOrThrow('PORT');
    this.logLevel = config.getOrThrow('LOG_LEVEL');
    this.databaseUrl = config.getOrThrow('DATABASE_URL');
    this.databasePoolSize = config.getOrThrow('DATABASE_POOL_SIZE');
    this.databaseSsl = config.getOrThrow('DATABASE_SSL');
    this.awsRegion = config.getOrThrow('AWS_REGION');
    this.awsAccessKeyId = config.get('AWS_ACCESS_KEY_ID');
    this.awsSecretAccessKey = config.get('AWS_SECRET_ACCESS_KEY');
    this.sqsEndpoint = config.get('SQS_ENDPOINT');
    this.sqsQueueUrl = config.getOrThrow('SQS_QUEUE_URL');
    this.sqsDlqUrl = config.getOrThrow('SQS_DLQ_URL');
    this.sqsEventsQueueUrl = config.get('SQS_EVENTS_QUEUE_URL');
    this.sqsConsumerEnabled = config.getOrThrow('SQS_CONSUMER_ENABLED');
    this.sqsConsumerName = config.getOrThrow('SQS_CONSUMER_NAME');
    this.sqsMaxReceiveCount = config.getOrThrow('SQS_MAX_RECEIVE_COUNT');
    this.sqsVisibilityTimeoutSeconds = config.getOrThrow('SQS_VISIBILITY_TIMEOUT_SECONDS');
    this.sqsBackoffBaseSeconds = config.getOrThrow('SQS_BACKOFF_BASE_SECONDS');
    this.sqsBackoffMaxSeconds = config.getOrThrow('SQS_BACKOFF_MAX_SECONDS');
    this.outboxEnabled = config.getOrThrow('OUTBOX_ENABLED');
    this.outboxPollIntervalMs = config.getOrThrow('OUTBOX_POLL_INTERVAL_MS');
    this.outboxBatchSize = config.getOrThrow('OUTBOX_BATCH_SIZE');
    this.outboxMaxAttempts = config.getOrThrow('OUTBOX_MAX_ATTEMPTS');
    this.outboxBackoffBaseMs = config.getOrThrow('OUTBOX_BACKOFF_BASE_MS');
    this.outboxBackoffMaxMs = config.getOrThrow('OUTBOX_BACKOFF_MAX_MS');
    this.pendingReferenceEnabled = config.getOrThrow('PENDING_REFERENCE_ENABLED');
    this.pendingReferencePollIntervalMs = config.getOrThrow('PENDING_REFERENCE_POLL_INTERVAL_MS');
    this.pendingReferenceBatchSize = config.getOrThrow('PENDING_REFERENCE_BATCH_SIZE');
    this.pendingReferenceMaxAttempts = config.getOrThrow('PENDING_REFERENCE_MAX_ATTEMPTS');
    this.pendingReferenceBackoffBaseMs = config.getOrThrow('PENDING_REFERENCE_BACKOFF_BASE_MS');
    this.pendingReferenceBackoffMaxMs = config.getOrThrow('PENDING_REFERENCE_BACKOFF_MAX_MS');
    this.authEnabled = config.getOrThrow('AUTH_ENABLED');
    this.corsOrigins = config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }
}
