# Architecture

## Overview

The service is a modular monolith deployed as three identical replicas. PostgreSQL is the source of truth; SQS is the transport for inbound provider operations and outbound integration events. Correctness never depends on FIFO ordering or single delivery: the database enforces the invariants.

Global invariants: no duplicated credit or debit, no lost confirmed event, no negative balance.

## Layers

- `shared/domain`: `Money`, errors, identifiers, clock, integration events, retry/backoff helpers.
- `modules/*/domain`: entities, value objects, failure codes and repository ports. No NestJS, ORM or AWS imports.
- `modules/*/application`: use cases and workers that orchestrate domain objects and ports.
- `modules/*/infrastructure`: MikroORM records, mappers, repositories and the SQS client.
- `modules/*/presentation`: controllers, DTOs and validation pipes.
- `shared/observability`: Prometheus registry and the `/metrics` controller.

Dependency direction is enforced by ESLint boundaries. Bun does not emit decorator metadata, so every injected dependency uses an explicit `@Inject(...)` token.

## Technical choices

**MikroORM.** Chosen for its explicit Unit of Work and `EntityManager.transactional()`, which gives one transaction boundary per use case, and for its lock support (`SELECT ... FOR UPDATE`). Domain entities are separate from persistence records, with explicit mappers, so the domain does not depend on the ORM.

**Money.** Wraps `decimal.js`. Amounts travel as decimal strings with at most two fractional digits; JavaScript `number` is never used for money. Operations return new instances, currencies never mix, and persisted values are rehydrated through `Money`.

**Transaction strategy.** One use case invocation runs in one SQL transaction through a `UnitOfWork` port. The wallet balance, ledger entry, wager transaction state, inbox marker and outbox events commit together or not at all.

## Data model

- `wallets`: id, player id, currency, materialized balance, version. One wallet per player and currency. A check constraint keeps the balance non-negative.
- `wallet_ledger_entries`: append-only history with `balance_before`, `balance_after`, direction, amount and transaction id. One entry per wallet and transaction.
- `wager_transactions`: provider operation, internal and external ids, kind, status, failure code, observed balance, reference pointer, idempotency key, canonical payload hash and pending-reference attempt metadata. Unique constraints cover the idempotency key and the provider plus external transaction id.
- `inbox_messages`: `(consumer_name, message_id)` markers for SQS at-least-once delivery.
- `outbox_messages`: events written in the business transaction, with attempts, next attempt time and publication state.

The ledger trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`. Check constraints enforce `balance_after = balance_before + direction * amount` and non-negative balances.

## Concurrency strategy

The unit of concurrency is the wallet. A balance change locks the wallet row with `SELECT ... FOR UPDATE` before reading it, so every replica serializes mutations of the same wallet in PostgreSQL, while different wallets proceed in parallel. There is no global lock.

| Option                               | Result                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Pessimistic lock per wallet (chosen) | Simple to reason about, no retry loop, predictable under a hot wallet. Cost: contenders wait on the row lock.                          |
| Optimistic lock with retry           | No waiting, but a hot wallet produces conflicts and retries; it needs a bounded retry policy and surfaces transient errors to callers. |
| Conditional atomic update            | Efficient for a single balance update, but the ledger entry, transaction state and outbox events still need the same transaction.      |

Idempotency does not depend on the lock alone. Unique constraints decide the winner when two replicas race on the same key: the loser re-reads the stored result and answers as a replay.

## Idempotency

`POST /wagering/transactions` requires `Idempotency-Key`. The payload hash is SHA-256 over the canonical JSON (sorted keys) of the business fields: `providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money` and `referenceExternalTransactionId`. Headers, correlation ids and other transport metadata are excluded. The SQS consumer uses the same hash.

- Same key and same hash: the original result is returned with `idempotentReplay: true`.
- Same key and different hash: `409`.
- The provider external transaction id is also unique, so duplicate deliveries cannot create a second transaction.

## Transaction state machine

```
PENDING ──► PROCESSED
   │ ├────► REJECTED
   │ ├────► FAILED
   └──────► PENDING_REFERENCE ──► PROCESSED | REJECTED | FAILED
```

`PROCESSED`, `REJECTED` and `FAILED` are terminal; transitioning out of them raises `InvalidTransactionStateError`. While a transaction waits in `PENDING_REFERENCE`, its attempt counter and next attempt time advance on each retry.

## Transaction and outbox flow

For each accepted operation, one SQL transaction writes the wallet balance and version, the ledger entry, the transaction state, the inbox marker (SQS input only) and the outbox rows.

After commit, the outbox publisher claims due rows with `FOR UPDATE SKIP LOCKED`, sends them to SQS and marks them published. A send failure schedules exponential backoff with jitter. Rows that exhaust the attempt budget are moved to the DLQ. Event ids are stable, so a duplicate publication is harmless to consumers.

The SQS consumer validates the envelope, runs the same use case as the HTTP API, and deletes the message only after the transaction commits. The result is at-least-once processing with effectively-once financial effects.

## Failure handling

- Invalid envelopes and business rejections are acknowledged; redelivery would not change the outcome.
- Unknown failures leave the message unacknowledged, with a backoff computed from the receive count. The consumer moves a message to the DLQ once the receive count exceeds the configured limit.
- The publisher and pending-reference workers catch tick errors, so an unavailable dependency never crashes the process.
- Readiness checks PostgreSQL and SQS; the SQS probe aborts after 1.5 seconds.
- Unexpected HTTP errors are logged server side with the stack; clients receive a generic `500`.
- On `SIGTERM` the consumer stops polling and waits for the poll in flight.

## Failure codes

Each rejection carries a stable `failureCode`. All of them are terminal for that transaction.

| Code                                                                                             | Meaning                                                                  | Provider action                                          |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `INSUFFICIENT_FUNDS`                                                                             | BET larger than the balance                                              | Do not resend; the round cannot start                    |
| `REVERSAL_WOULD_OVERDRAW`                                                                        | A reversal would leave a negative balance                                | Escalate; operational review                             |
| `REFERENCE_REQUIRED`                                                                             | REFUND/ROLLBACK without a reference id                                   | Correct the payload                                      |
| `REFERENCE_NOT_FOUND`                                                                            | Reference never arrived within the attempt limit                         | Send the original transaction first, then a new reversal |
| `REFERENCE_NOT_PROCESSED`                                                                        | Reference exists but was not processed                                   | Resolve the original first                               |
| `REFERENCE_MISMATCH`                                                                             | Reference belongs to another provider, player, wallet, currency or round | Correct the payload                                      |
| `INVALID_REFERENCE_KIND`                                                                         | REFUND of a non-BET, or ROLLBACK of an unsupported kind                  | Correct the payload                                      |
| `ALREADY_REVERSED`                                                                               | The reference was already reversed by the same kind                      | Do not resend                                            |
| `AMOUNT_MISMATCH`                                                                                | Reversal amount differs from the reference                               | Correct the amount (partial reversals are unsupported)   |
| `CURRENCY_MISMATCH`, `PLAYER_MISMATCH`, `WALLET_MISMATCH`, `ROUND_MISMATCH`, `PROVIDER_MISMATCH` | Identity of the operation conflicts with the wallet or reference         | Correct the payload                                      |
| `INVALID_KIND`                                                                                   | Unsupported kind                                                         | Correct the payload                                      |
| `INVALID_TRANSITION`                                                                             | Internal state machine violation                                         | Report; not caused by the provider                       |

## Reference rules and pending references

`REFUND` references a processed `BET`. `ROLLBACK` references a processed `BET`, `WIN` or `REFUND`. The reference is resolved by provider and external id, and must share provider, player, wallet, currency and round. The reversal amount must equal the referenced amount, and the same reference cannot be reversed twice by the same kind.

If the reference is missing or not yet processed, the transaction is stored as `PENDING_REFERENCE` with an attempt counter and next attempt time, and a `WagerTransactionPendingReference` event is emitted. `PendingReferenceWorker` periodically claims due rows with row locks and:

- links and processes the reversal once the reference is processed,
- backs off exponentially while waiting,
- rejects with `REFERENCE_NOT_FOUND` after the attempt limit and emits the matching events.

Intervals, batch sizes, attempt limits and backoff bounds are environment settings with defaults in `.env.example`.

## HTTP mapping

| Situation                              | Status | Notes                                                                                        |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Processed transaction                  | 201    | `idempotentReplay` distinguishes fresh from replay                                           |
| Waiting for a reference                | 201    | `status: "PENDING_REFERENCE"`; the request was accepted and stored, and a worker finishes it |
| Invalid payload, money, kind or cursor | 400    | Never `500`                                                                                  |
| Unknown wallet or route                | 404    |                                                                                              |
| Idempotency or uniqueness conflict     | 409    |                                                                                              |
| Business rejection                     | 422    | Body includes `transactionId`, `status`, `failureCode`                                       |
| Dependency unavailable                 | 503    | `Retry-After`; safe to retry                                                                 |
| Unexpected failure                     | 500    | Generic body                                                                                 |

## Observability

Logs are JSON (pino). A small middleware logs each request with its `correlationId`, because the automatic request logging of `pino-http` did not produce output under Bun. Health and metrics endpoints are not logged.

`GET /metrics` exposes Prometheus metrics per replica: transactions by status and kind, idempotent replays, retries, DLQ messages, lock conflicts, outbox pending count and lag, processing latency, HTTP latency and reconciliation outcomes. Reconciliation never repairs a divergence: it recalculates the balance as the sum of all ledger entries (credits minus debits), compares it with the stored balance, logs an error, increments `reconciliation_runs_total{result="divergent"}` and reports `consistent: false` with the difference.

## Tests mapped to risks

| Risk                                       | Test                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| Duplicate submissions across replicas      | `test/concurrency/concurrency-real.test.ts` (scenario 1) |
| Two bets racing for one balance            | `test/concurrency/concurrency-real.test.ts` (scenario 2) |
| Hot wallet, distinct wallets, all replicas | `test/concurrency/concurrency-real.test.ts` (3 to 5)     |
| Crash after commit and before ack          | `test/concurrency/failure-recovery.test.ts` (scenario 6) |
| Concurrent outbox publishers               | `test/concurrency/failure-recovery.test.ts` (scenario 7) |
| Full restart under load                    | `test/concurrency/failure-recovery.test.ts` (scenario 8) |
| Out-of-order references                    | `test/integration/persistence.test.ts`                   |
| SQS redelivery, replay dedup and DLQ       | `test/integration/sqs-delivery.test.ts`                  |
| HTTP contract and validation               | `test/e2e/wagering-api.test.ts`                          |

## Authentication

Authentication is intentionally a no-op behind `ProviderIdentityPort` and `AuthGuard`, as allowed by the challenge. To use Keycloak, Zitadel or another OIDC provider:

1. implement the port with token validation and provider-to-player mapping,
2. enable `AUTH_ENABLED`,
3. keep health endpoints public and SQS input trusted as an internal channel, while still validating message contents.

## Limitations and next steps

- No external identity provider is integrated; the extension point exists but the guard is a no-op.
- Metrics are per replica. `outbox_pending_messages` and `outbox_lag_seconds` are computed over the batch each publisher claims, not over the whole table, so a very large backlog is under-reported.
- The reconciliation endpoint answers `201`; `200` would describe a read-only check better.
- The use case repeats the rejection branch several times. It is covered by tests and could be extracted into one helper.
- Wallet creation relies on the player and currency uniqueness and has no idempotency key.
- DLQ inspection and replay are operational work, not an API.
- There is no zero-downtime migration workflow.
- The load suite is a functional concurrency check, not a capacity benchmark.
