import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const optionalUrl = z.string().url().optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().min(1).startsWith('postgres'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: booleanString.default('false'),
  AWS_REGION: z.string().min(1).default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  SQS_ENDPOINT: z.string().url().optional(),
  SQS_QUEUE_URL: z.string().url(),
  SQS_DLQ_URL: z.string().url(),
  SQS_EVENTS_QUEUE_URL: optionalUrl,
  SQS_CONSUMER_ENABLED: booleanString.default('true'),
  SQS_CONSUMER_NAME: z.string().min(1).default('wager-transactions'),
  SQS_MAX_RECEIVE_COUNT: z.coerce.number().int().min(1).max(100).default(5),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(43200).default(60),
  SQS_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).default(5),
  SQS_BACKOFF_MAX_SECONDS: z.coerce.number().int().min(1).default(300),
  OUTBOX_ENABLED: booleanString.default('true'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(20),
  OUTBOX_BACKOFF_BASE_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BACKOFF_MAX_MS: z.coerce.number().int().min(100).default(60000),
  PENDING_REFERENCE_ENABLED: booleanString.default('true'),
  PENDING_REFERENCE_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  PENDING_REFERENCE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  PENDING_REFERENCE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(10),
  PENDING_REFERENCE_BACKOFF_BASE_MS: z.coerce.number().int().min(500).default(5000),
  PENDING_REFERENCE_BACKOFF_MAX_MS: z.coerce.number().int().min(500).default(300000),
  AUTH_ENABLED: booleanString.default('false'),
  CORS_ORIGINS: z.string().default('')
});

export type Env = z.infer<typeof envSchema>;
