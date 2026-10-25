# Architecture

## Overview

The service is a modular monolith deployed as three identical replicas. PostgreSQL is the source of truth; SQS is the transport for inbound provider operations and outbound integration events. Correctness does not depend on FIFO ordering or single delivery.

## Layers

- `shared/domain`: `Money`, errors, identifiers, clock, integration events, retry/backoff helpers.
- `modules/*/domain`: entities, value objects, failure codes, and repository ports. No NestJS, ORM, or AWS imports.
- `modules/*/application`: use cases and workers orchestrating domain objects and ports.
- `modules/*/infrastructure`: MikroORM records, mappers, repositories, SQS client.
- `modules/*/presentation`: controllers, DTOs, validation pipes.
- `modules/*/messaging`: inbox/outbox persistence and SQS consumer/publisher services.

Dependency checks are enforced by ESLint boundaries.

## Data model

- `wallets`: wallet id, player id, currency, materialized balance, version.
- `wallet_ledger_entries`: immutable append-only history with `balance_before`, `balance_after`, direction, amount, and transaction id.
- `wager_transactions`: provider operation, internal/external ids, kind, status, failure code, observed balance, reference pointer, idempotency key, canonical payload hash, pending-reference attempt metadata.
- `idempotency`/unique constraints prevent duplicate transactions for the same provider external id or idempotency key.
- `inbox_messages`: `(consumer_name, message_id)` processed markers for SQS at-least-once delivery.
- `outbox_messages`: transactionally written integration events with attempts, next attempt time, and publication state.

## Concurrency strategy

The unit of financial concurrency is the wallet. Balance changes lock the wallet row with `SELECT ... FOR UPDATE` before reading or updating it. All replicas therefore serialize financial mutations for the same wallet in PostgreSQL.

Idempotency is persistent, not in-memory:

- The same idempotency key and payload return the original stored result.
- The same key with a different canonical payload is rejected with `409`.
- Provider external transaction ids are unique, so duplicate deliveries cannot create a second transaction.

SQS FIFO is used as a transport optimization, not as the correctness mechanism. Message group ids are aggregate-based; cross-replica correctness still comes from database locks and constraints.

## Transaction and outbox flow

For each accepted operation, one SQL transaction writes:

1. the wallet balance and version,
2. the ledger entry,
3. the wager transaction state,
4. the inbox marker when processing an SQS message,
5. outbox event rows.

After commit, the outbox publisher claims due rows with `FOR UPDATE SKIP LOCKED`, sends them to SQS, and marks them published. Send failures schedule exponential backoff with jitter. Rows that exhaust their attempt budget are moved to the DLQ.

The SQS consumer validates the envelope, processes the command through the same use case, and acknowledges the message only after the database transaction commits. This provides at-least-once processing with effectively-once financial effects.

## Failure handling

- Invalid envelopes and business rejections are acknowledged (and recorded where applicable); they will not become correct on redelivery.
- Unknown failures leave the message unacknowledged for redelivery. The queue redrive policy moves poison messages to the DLQ after the configured receive count.
- The publisher and pending-reference workers catch tick errors so an unavailable dependency cannot crash the process.
- Health readiness checks PostgreSQL and SQS; SQS checks use a 1.5 second abort so readiness does not hang.
- Unexpected HTTP exceptions are logged server-side while clients receive a generic `500` response.

## Pending references

`REFUND` and `ROLLBACK` require an already processed `BET`/`WIN` reference. If the reference is missing, the transaction is persisted as `PENDING_REFERENCE` with an attempt counter and next attempt time.

`PendingReferenceWorker` periodically claims due rows, locks them with `FOR UPDATE`, and:

- links and processes the reversal when the reference exists,
- applies exponential backoff while waiting,
- rejects with `REFERENCE_NOT_FOUND` after the configured attempt limit,
- emits the corresponding outbox events.

The worker, repositories, and outbox publisher share the same transaction-scoped `EntityManager`.

## Idempotent HTTP submissions

`POST /wagering/transactions` requires `Idempotency-Key`. The canonical payload hash covers business fields only, excluding transport headers and correlation ids. The response distinguishes fresh processing from `idempotentReplay: true`.

Business rejections return `422` with the transaction id, failure code, and current balance. Pending references return `201` with `status: "PENDING_REFERENCE"`.

## Ledger integrity

A database trigger rejects `UPDATE`, `DELETE`, and `TRUNCATE` on ledger rows. Check constraints enforce:

- `balance_after = balance_before + direction * amount`,
- non-negative balances,
- currency consistency.

Wallet reconciliation compares the materialized balance with the latest ledger outcome and reports any mismatch.

## Authentication

Authentication is intentionally a no-op behind `ProviderIdentityPort` and `AuthGuard`, as allowed by the challenge. To integrate Keycloak/Zitadel or another OIDC provider:

1. implement the port with token validation and provider/player mapping,
2. enable `AUTH_ENABLED`,
3. keep health endpoints public and SQS input trusted as an internal channel while still applying all domain validations to message contents.

## Limitations and next steps

- No external IdP is integrated; the extension point is present but the guard is a no-op.
- DLQ inspection/replay is operational work, not an API.
- Observability is limited to structured request logs, correlation ids, and decision logs; no metrics endpoint is currently exposed.
- The schema uses MikroORM migrations; there is no zero-downtime migration workflow.
- The load suite is a functional concurrency check, not a capacity benchmark.
- Wallet creation relies on player/currency uniqueness and is not protected by an idempotency key.
