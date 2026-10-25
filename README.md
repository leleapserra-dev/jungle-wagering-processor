# Distributed Wagering Processor

Financial backend for multi-provider wagering: wallets, an immutable ledger, idempotent bet and reversal processing, a transactional outbox and SQS delivery. It stays correct when messages are duplicated, delivered out of order or processed concurrently by several replicas.

## Stack

- Bun 1.x, TypeScript (strict), NestJS
- PostgreSQL 16 with MikroORM (versioned migrations)
- AWS SQS FIFO via LocalStack
- Docker Compose with three application replicas
- pino (structured JSON logs) and prom-client (Prometheus metrics)

## Prerequisites

- Docker Desktop (running)
- Bun 1.x, only to run the tests and linters from the host (`bun install`)

## Quick start

```sh
cp .env.example .env
docker compose up --build
```

Services:

| Service    | Address                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| API        | `http://localhost:3001`, `http://localhost:3002`, `http://localhost:3003` |
| PostgreSQL | `localhost:5432` (user `jungle`, password `jungle`, database `wagering`)  |
| LocalStack | `http://localhost:4566`                                                   |

Migrations run in the one-shot `migrate` service before the replicas start. When everything is up, each replica answers `GET /health/ready` with `{"status":"ready","postgres":"ok","sqs":"ok"}`.

Reset everything (including the database volume): `docker compose down -v`.

## API

| Method | Path                                                                  | Notes                                                   |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| POST   | `/wallets`                                                            | Create a wallet with an initial balance                 |
| GET    | `/wallets/:walletId`                                                  | Materialized balance and version                        |
| GET    | `/wallets/:walletId/ledger?cursor=&limit=50`                          | Immutable ledger, opaque keyset cursor                  |
| POST   | `/wagering/transactions`                                              | Requires the `Idempotency-Key` header                   |
| GET    | `/wagering/transactions/:transactionId`                               | Lookup by internal id                                   |
| GET    | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Lookup by provider id                                   |
| POST   | `/wallets/:walletId/reconciliation`                                   | Recompute the balance from the whole ledger and compare |
| GET    | `/health/live`, `/health/ready`                                       | Liveness and dependency readiness (public)              |
| GET    | `/metrics`                                                            | Prometheus metrics of the replica that answers          |

Transaction kinds: `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`. `REFUND` and `ROLLBACK` require `referenceExternalTransactionId`. `OPENING` is internal and rejected at the API.

Money is always `{ "amount": "25.00", "currency": "BRL" }`: a decimal string with at most two fractional digits.

### Examples

The commands below use a POSIX shell. On Windows PowerShell call `curl.exe` and escape the inner quotes (`'{\"amount\":\"100.00\"}'`), or send the body from a file with `--data-binary "@body.json"`.

Create a wallet:

```sh
curl -s -X POST http://localhost:3001/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Place a bet (use the wallet `id` returned above):

```sh
curl -s -X POST http://localhost:3001/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provider-a:bet-1" \
  -d '{"providerId":"provider-a","externalTransactionId":"bet-1","playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","walletId":"<WALLET_ID>","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"80.00","currency":"BRL"}}'
```

Expected result:

```json
{
  "transactionId": "...",
  "status": "PROCESSED",
  "balance": { "amount": "20.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

Situations worth trying:

- **Replay:** send the same request again. The same `transactionId` comes back with `"idempotentReplay": true` and the balance is not debited twice.
- **Key reuse with another payload:** same `Idempotency-Key`, different amount. Response `409`.
- **Insufficient funds:** a second `BET` of `80.00` with another key. Response `422` with `transactionId`, `"status":"REJECTED"` and `"failureCode":"INSUFFICIENT_FUNDS"`.
- **Ledger:** `GET /wallets/<WALLET_ID>/ledger?limit=50`.
- **Reconciliation:** `POST /wallets/<WALLET_ID>/reconciliation` returns `storedBalance`, `calculatedBalance`, `difference`, `consistent` and `checkedEntries`.

## Error contract

| Situation                              | HTTP | Body                                                      |
| -------------------------------------- | ---- | --------------------------------------------------------- |
| Invalid payload, money, cursor or kind | 400  | `{ code, message, details, correlationId }`               |
| Unknown wallet or route                | 404  | `{ code, message, details, correlationId }`               |
| Idempotency or uniqueness conflict     | 409  | `{ code, message, details, correlationId }`               |
| Business rejection                     | 422  | `{ transactionId, status: "REJECTED", failureCode, ... }` |
| Dependency unavailable                 | 503  | `Retry-After` header; safe to retry                       |
| Unexpected failure                     | 500  | Generic message; details are only logged server side      |

Failure codes and what a provider should do with each one are listed in `ARCHITECTURE.md`.

## Reliability semantics

- The idempotency key and a canonical payload hash are persisted. Replays return the original result; reusing a key with a different payload returns `409`.
- The wallet row is locked with `SELECT ... FOR UPDATE`, which serializes balance changes across replicas. Unique constraints back up idempotency.
- The financial change, ledger entry, inbox marker and outbox events commit in one database transaction.
- The outbox publisher claims rows with `FOR UPDATE SKIP LOCKED` and retries with exponential backoff and jitter.
- The SQS consumer acknowledges a message only after the transaction commits. Invalid envelopes and business rejections are acknowledged; unknown failures are retried and finally dead-lettered.
- References that arrive out of order are stored as `PENDING_REFERENCE`. A worker retries them with backoff until the reference appears or the attempt limit rejects them with `REFERENCE_NOT_FOUND`.
- The ledger is append-only, enforced by a database trigger. Check constraints keep `balance_after` consistent and balances non-negative.

## Observability

- **Logs:** one JSON object per line (pino). Requests carry `correlationId`, method, path, status and duration. The `X-Correlation-Id` header is accepted or generated, returned in the response and propagated to outbox events. Health and metrics calls are not logged.
- **Metrics (`GET /metrics`):** `wager_transactions_total{status,kind}`, `wager_idempotent_replays_total`, `retries_total{component}`, `dlq_messages_total{source}`, `lock_conflicts_total{kind}`, `outbox_pending_messages`, `outbox_lag_seconds`, `wager_processing_duration_seconds`, `http_request_duration_seconds` and `reconciliation_runs_total{result}`.
- **Health:** `/health/live` has no dependencies; `/health/ready` checks PostgreSQL and SQS.

## Tests

The integration, concurrency, E2E and load suites need the Docker stack running.

```sh
bun install
bun run typecheck
bun run lint
bun run format:check
bun run test:unit
bun run test:integration
bun run test:concurrency
bun run test:e2e
bun run test:load
```

| Suite       | Covers                                                                                                                                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | money, wallet, transaction state transitions, ledger cursor validation, exception mapping                                                                                                                                                                      |
| Integration | persisted ledger, outbox and reconciliation; SQS delivery with replay deduplication and DLQ; pending-reference retries                                                                                                                                         |
| Concurrency | same bet 50 times in parallel; two bets of 80.00 on a balance of 100.00 across replicas; many small concurrent bets; distinct wallets; load on all replicas; replica killed after commit and before ack; concurrent outbox publishers; full restart under load |
| E2E         | HTTP validation, idempotency, ledger pagination, reconciliation, correlation ids, readiness of every replica                                                                                                                                                   |
| Load        | parallel betting across three replicas and a duplicate-request storm (a functional check, not a capacity benchmark)                                                                                                                                            |

Every concurrency test ends by checking that the wallet balance equals the sum of its ledger.

## Configuration

See `.env.example` for all settings. The main groups are:

- Database: `DATABASE_URL`, pool size, SSL.
- SQS: endpoint, source, DLQ and events queue URLs, receive count, visibility timeout, backoff.
- Outbox: polling interval, batch size, max attempts, backoff.
- Pending references: polling interval, batch size, max attempts, backoff.
- `AUTH_ENABLED` and `CORS_ORIGINS`.
- `LOG_LEVEL`.

## Project layout

```
src/config/                    configuration, logging and MikroORM setup
src/modules/wallet/            wallet, ledger
src/modules/reconciliation/    balance reconciliation
src/modules/wagering/          transaction domain, use case, presentation, pending-reference worker
src/modules/messaging/         SQS consumer, outbox publisher, inbox
src/modules/health/            liveness and readiness
src/shared/                    money, errors, ids, events, canonical JSON, HTTP plumbing, metrics
src/migrations/                schema and constraints
test/                          unit, integration, concurrency, e2e, load
docker/localstack/             FIFO queue bootstrap
```

## Design documents

`ARCHITECTURE.md` explains the layers, the concurrency strategy and its trade-offs, the state machine, failure codes, retry policy, HTTP mapping and the known limitations.
