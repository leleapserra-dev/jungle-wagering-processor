import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});

export const transactionsTotal = new Counter({
  name: 'wager_transactions_total',
  help: 'Wager transactions by final status and kind',
  labelNames: ['status', 'kind'] as const,
  registers: [registry]
});

export const idempotentReplaysTotal = new Counter({
  name: 'wager_idempotent_replays_total',
  help: 'Duplicate submissions answered with the original result',
  registers: [registry]
});

export const retriesTotal = new Counter({
  name: 'retries_total',
  help: 'Retries scheduled by background components',
  labelNames: ['component'] as const,
  registers: [registry]
});

export const dlqMessagesTotal = new Counter({
  name: 'dlq_messages_total',
  help: 'Messages sent to a dead-letter queue',
  labelNames: ['source'] as const,
  registers: [registry]
});

export const lockConflictsTotal = new Counter({
  name: 'lock_conflicts_total',
  help: 'Concurrency conflicts detected while mutating state',
  labelNames: ['kind'] as const,
  registers: [registry]
});

export const outboxPending = new Gauge({
  name: 'outbox_pending_messages',
  help: 'Outbox messages waiting to be published',
  registers: [registry]
});

export const outboxLagSeconds = new Gauge({
  name: 'outbox_lag_seconds',
  help: 'Age of the oldest unpublished outbox message',
  registers: [registry]
});

export const processingDuration = new Histogram({
  name: 'wager_processing_duration_seconds',
  help: 'Time spent processing a wager transaction',
  labelNames: ['kind', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry]
});
