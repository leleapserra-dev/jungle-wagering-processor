# Distributed Wagering Processor

Financial backend for multi-provider wagering: wallets, immutable ledger, idempotent bet/reversal processing, transactional outbox, and SQS delivery.

## Stack

- Bun + TypeScript (strict) + NestJS
- PostgreSQL 16 + MikroORM
- AWS SQS FIFO via LocalStack
- Docker Compose with three application replicas

## Quick start

```sh
cp .env.example .env
docker compose up --build
```

Services:

- API replicas: `http://localhost:3001`, `http://localhost:3002`, `http://localhost:3003`
- PostgreSQL: `localhost:5432` (`jungle` / `jungle`, database `wagering`)
- LocalStack: `http://localhost:4566`

Migrations run in the one-shot `migrate` service before the replicas start.

## API

| Method | Path                                                                  | Notes                                   |
| ------ | --------------------------------------------------------------------- | --------------------------------------- |
| POST   | `/wallets`                                                            | Create a wallet with an initial balance |
| GET    | `/wallets/:walletId`                                                  | Materialized balance and version        |
| GET    | `/wallets/:walletId/ledger?cursor=&limit=50`                          | Immutable ledger page                   |
| POST   | `/wagering/transactions`                                              | Requires `Idempotency-Key`              |
| GET    | `/wagering/transactions/:transactionId`                               | Lookup by internal id                   |
| GET    | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Lookup by provider id                   |
| POST   | `/wallets/:walletId/reconciliation`                                   | Compare wallet balance with ledger      |
| GET    | `/health/live`, `/health/ready`                                       | Liveness and dependency readiness       |

`POST /wallets/:walletId/reconciliation` returns the stored balance, ledger-derived balance, and whether they match.

Supported transaction kinds: `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`. `REFUND` and `ROLLBACK` require `referenceExternalTransactionId`.

## Money

Money is always a decimal string with up to two fractional digits. Internally it is represented with `decimal.js`; JavaScript `number` is never used for monetary values. Values for different currencies are rejected.

## Reliability semantics

- Idempotency key + canonical payload hash are persisted. Replays return the original result; key reuse with a different payload returns `409`.
- Wallet row locking (`SELECT ... FOR UPDATE`) serializes balance changes; uniqueness constraints backstop idempotency across replicas.
- Financial change, ledger entry, inbox marker, and outbox event commit in one database transaction.
- The outbox publisher claims rows with `FOR UPDATE SKIP LOCKED`, retries with backoff, and moves exhausted messages to the DLQ.
- The SQS consumer acknowledges only after commit. Malformed envelopes and business rejections are acknowledged; unknown failures are retried and eventually dead-lettered.
- References that arrive out of order are stored as `PENDING_REFERENCE`; a worker retries them with exponential backoff until the reference appears or the attempt limit rejects them.
- The ledger is append-only and protected by a database trigger. Constraints keep `balance_after` consistent and balances non-negative.

## Tests

The integration, concurrency, E2E, and load suites require the Docker stack to be running.

```sh
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration
bun run test:concurrency
bun run test:e2e
bun run test:load
```

Test coverage:

- Unit: money, wallet, transaction state transitions, cursor validation, exception mapping.
- Integration: persisted ledger/outbox/reconciliation, SQS delivery and DLQ, pending-reference retries.
- Concurrency: parallel debits against one wallet and duplicate submissions across replicas.
- E2E: HTTP validation, idempotency, pagination, reconciliation, and correlation ids.
- Load: parallel betting across three replicas and a duplicate-request storm.

## Configuration

See `.env.example` for all settings. The most relevant groups are:

- Database: `DATABASE_URL`, pool size, SSL.
- SQS: endpoint, source/DLQ/events queue URLs, receive count, visibility timeout, backoff.
- Outbox: polling interval, batch size, max attempts, backoff.
- Pending references: polling interval, batch size, max attempts, backoff.
- `AUTH_ENABLED` and `CORS_ORIGINS`.

## Project layout

```
src/config/                    configuration and MikroORM setup
src/modules/wallet/            wallet, ledger, reconciliation
src/modules/wagering/          transaction domain, use case, presentation, worker
src/modules/messaging/         SQS consumer, outbox publisher, inbox
src/modules/health/            liveness/readiness
src/shared/                    money, errors, ids, events, canonical JSON, HTTP plumbing
src/migrations/                schema and constraints
test/                          unit, integration, concurrency, e2e, load
docker/localstack/             FIFO queue bootstrap
```

## Design documents

See `ARCHITECTURE.md` for layer boundaries, transaction strategy, failure handling, and known limitations.
