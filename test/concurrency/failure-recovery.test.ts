import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import type { Client } from 'pg';
import {
  createWallet,
  expectStackReady,
  getPg,
  PORTS,
  request,
  submitWager,
  waitFor,
  wagerInput,
  type ApiResult,
  type TransactionResponse
} from '../support/api';
import { drainQueue, EVENTS_QUEUE, queueDepth, sendEnvelope, SOURCE_QUEUE, type BrokerMessage } from '../support/sqs';

const PROXY_NAME = 'wagering-sqs-proxy';
const CONSUMER_NAME = 'wagering-failure-consumer';
const CONSUMER_PORT = 3010;

function log(message: string): void {
  process.stdout.write(`[failure-recovery] ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command: string[], allowFailure = false): string {
  const result = Bun.spawnSync({ cmd: command, stdout: 'pipe', stderr: 'pipe' });
  const exitCode = result.exitCode ?? 1;
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`command failed (${exitCode}): ${command.join(' ')}\n${stdout}\n${stderr}`);
  }
  return stdout;
}

function compose(args: string[], allowFailure = false): string {
  return run(['docker', 'compose', ...args], allowFailure);
}

function containerId(service: string): string {
  const id = compose(['ps', '-q', service]);
  if (id.length === 0) throw new Error(`container for ${service} is not running`);
  return id;
}

function networkOf(service: string): string {
  const id = containerId(service);
  const network = run([
    'docker',
    'inspect',
    '-f',
    '{{range $key, $value := .NetworkSettings.Networks}}{{$key}}{{end}}',
    id
  ]);
  if (network.length === 0) throw new Error(`no docker network found for ${service}`);
  return network;
}

function imageOf(service: string): string {
  return run(['docker', 'inspect', '-f', '{{.Config.Image}}', containerId(service)]);
}

function removeContainer(name: string): void {
  run(['docker', 'rm', '-f', name], true);
}

function startSqsProxy(network: string, image: string): void {
  removeContainer(PROXY_NAME);
  const script =
    "const net=require('node:net');net.createServer((client)=>{const upstream=net.connect(4566,'localstack');" +
    "client.pipe(upstream).pipe(client);client.on('error',()=>upstream.destroy());" +
    "upstream.on('error',()=>client.destroy());}).listen(8666,'0.0.0.0');";
  run(['docker', 'run', '-d', '--name', PROXY_NAME, '--network', network, '--entrypoint', 'bun', image, '-e', script]);
}

function startFailureConsumer(network: string, image: string): void {
  removeContainer(CONSUMER_NAME);
  const proxyEndpoint = `http://${PROXY_NAME}:8666`;
  const environment = [
    'NODE_ENV=production',
    'PORT=3000',
    'LOG_LEVEL=warn',
    'DATABASE_URL=postgresql://jungle:jungle@postgres:5432/wagering',
    'DATABASE_POOL_SIZE=5',
    'DATABASE_SSL=false',
    'AWS_REGION=us-east-1',
    'AWS_ACCESS_KEY_ID=test',
    'AWS_SECRET_ACCESS_KEY=test',
    `SQS_ENDPOINT=${proxyEndpoint}`,
    `SQS_QUEUE_URL=${proxyEndpoint}/000000000000/wager-transactions.fifo`,
    `SQS_DLQ_URL=${proxyEndpoint}/000000000000/wager-transactions-dlq.fifo`,
    `SQS_EVENTS_QUEUE_URL=${proxyEndpoint}/000000000000/wager-events.fifo`,
    'SQS_CONSUMER_ENABLED=true',
    'SQS_CONSUMER_NAME=wager-transactions',
    'SQS_MAX_RECEIVE_COUNT=5',
    'SQS_VISIBILITY_TIMEOUT_SECONDS=5',
    'SQS_BACKOFF_BASE_SECONDS=1',
    'SQS_BACKOFF_MAX_SECONDS=5',
    'OUTBOX_ENABLED=false',
    'PENDING_REFERENCE_ENABLED=false',
    'AUTH_ENABLED=false'
  ];
  const args = [
    'docker',
    'run',
    '-d',
    '--name',
    CONSUMER_NAME,
    '--network',
    network,
    '-p',
    `127.0.0.1:${CONSUMER_PORT}:3000`
  ];
  for (const value of environment) {
    args.push('-e', value);
  }
  args.push(image);
  run(args);
}

async function waitForHttpReady(port: number, timeoutMs = 60000): Promise<void> {
  await waitFor(
    `http ${port} ready`,
    async () => {
      try {
        const response = await fetch(`http://localhost:${port}/health/ready`, {
          signal: AbortSignal.timeout(2000)
        });
        return response.ok ? true : undefined;
      } catch {
        return undefined;
      }
    },
    timeoutMs,
    250
  );
}

async function waitForAllReady(timeoutMs = 90000): Promise<void> {
  for (const port of PORTS) {
    await waitForHttpReady(port, timeoutMs);
  }
}

async function endQuietly(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    // The connection may already be closed after a forced container restart.
  }
}

function brokerEventId(message: BrokerMessage): string {
  if (message.body !== undefined) {
    const parsed = JSON.parse(message.body) as { messageId?: string };
    if (parsed.messageId !== undefined) {
      return parsed.messageId;
    }
  }
  if (message.deduplicationId !== undefined) return message.deduplicationId;
  if (message.messageId !== undefined) return message.messageId;
  throw new Error('broker message has no identifier');
}

async function walletState(
  pg: Client,
  walletId: string,
  externalTransactionId: string,
  inboxMessageId: string
): Promise<{
  balance: string;
  debits: number;
  net: string;
  ledgerEntries: number;
  transactions: number;
  inboxRows: number;
  inboxProcessed: number;
}> {
  const result = await pg.query<{
    balance: string;
    debits: number;
    net: string;
    ledger_entries: number;
    transactions: number;
    inbox_rows: number;
    inbox_processed: number;
  }>(
    `select
       (select balance::text from wallets where id=$1) as balance,
       (select count(*)::int from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT') as debits,
       (select coalesce(sum(case when direction='CREDIT' then amount else -amount end), 0)::text
          from wallet_ledger_entries where wallet_id=$1) as net,
       (select count(*)::int from wallet_ledger_entries where wallet_id=$1) as ledger_entries,
       (select count(*)::int from wager_transactions
          where wallet_id=$1 and external_transaction_id=$2) as transactions,
       (select count(*)::int from inbox_messages where message_id=$3) as inbox_rows,
       (select count(*)::int from inbox_messages where message_id=$3 and processed_at is not null) as inbox_processed`,
    [walletId, externalTransactionId, inboxMessageId]
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('wallet state query returned no rows');
  return {
    balance: row.balance,
    debits: row.debits,
    net: row.net,
    ledgerEntries: row.ledger_entries,
    transactions: row.transactions,
    inboxRows: row.inbox_rows,
    inboxProcessed: row.inbox_processed
  };
}

describe('concurrency failure recovery', () => {
  test('6) replica killed after commit and before ack -> SQS redelivery, inbox/idempotency prevent a second debit', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '100.00');
    const network = networkOf('app-1');
    const image = imageOf('app-1');
    const pg = await getPg();
    const lock = await getPg();
    let lockOpen = false;
    let appsStopped = false;
    const externalTransactionId = 'ext-' + randomUUID();
    const messageId = randomUUID();
    const providerId = 'prov-' + randomUUID();

    try {
      compose(['stop', 'app-1', 'app-2', 'app-3']);
      appsStopped = true;
      await drainQueue(SOURCE_QUEUE);
      startSqsProxy(network, image);
      startFailureConsumer(network, image);
      await waitForHttpReady(CONSUMER_PORT);

      const wager = {
        idempotencyKey: 'idem-' + randomUUID(),
        providerId,
        externalTransactionId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-' + randomUUID(),
        gameId: 'game-' + randomUUID(),
        kind: 'BET',
        money: { amount: '20.00', currency: 'BRL' },
        correlationId: 'corr-' + randomUUID()
      };

      await lock.query('BEGIN');
      lockOpen = true;
      await lock.query('select id from wallets where id=$1 for update', [wallet.id]);

      await sendEnvelope(
        {
          messageId,
          type: 'ProcessWagerTransaction',
          occurredAt: new Date().toISOString(),
          data: wager
        },
        wallet.id,
        messageId
      );

      await waitFor(
        'consumer blocked on the wallet row',
        async () => {
          const result = await pg.query<{ count: number }>(
            `select count(*)::int as count
                 from pg_stat_activity
                where state='active'
                  and query ilike '%from "wallets"%'
                  and query ilike '%for update%'`
          );
          const count = result.rows[0]?.count ?? 0;
          return count > 0 ? count : undefined;
        },
        20000,
        100
      );
      log('consumer received the SQS message and is blocked on the wallet row');

      run(['docker', 'kill', PROXY_NAME]);
      log('SQS proxy killed; the upcoming ack cannot reach LocalStack');

      await lock.query('ROLLBACK');
      lockOpen = false;

      const transaction = await waitFor(
        'transaction commit after lock release',
        async () => {
          const result = await pg.query<{ id: string; status: string }>(
            'select id::text, status from wager_transactions where provider_id=$1 and external_transaction_id=$2',
            [providerId, externalTransactionId]
          );
          return result.rows[0];
        },
        20000,
        100
      );
      expect(transaction.status).toBe('PROCESSED');

      const afterCommitDepth = await queueDepth(SOURCE_QUEUE);
      expect(afterCommitDepth).toBe(1);
      log('transaction committed while the SQS message is still unacknowledged (queue depth=1)');

      run(['docker', 'kill', CONSUMER_NAME]);
      log('consuming replica killed after commit and before ack');

      compose(['start', 'app-1']);
      await waitForHttpReady(PORTS[0]);

      await waitFor(
        'redelivery on another replica',
        async () => ((await queueDepth(SOURCE_QUEUE)) === 0 ? true : undefined),
        30000,
        250
      );
      log('another app replica consumed and acknowledged the redelivered message');

      const state = await walletState(pg, wallet.id, externalTransactionId, messageId);
      expect(state.balance).toBe('80.00');
      expect(state.debits).toBe(1);
      expect(state.net).toBe('80.00');
      expect(state.ledgerEntries).toBe(2);
      expect(state.transactions).toBe(1);
      expect(state.inboxRows).toBe(1);
      expect(state.inboxProcessed).toBe(1);
      log(
        `final: balance=${state.balance} debits=${state.debits} ` +
          `ledgerNet=${state.net} transactions=${state.transactions} ` +
          `inbox=${state.inboxProcessed}/${state.inboxRows}`
      );
    } finally {
      if (lockOpen) {
        try {
          await lock.query('ROLLBACK');
        } catch {
          // Ignore rollback failures while restoring the stack.
        }
      }
      await endQuietly(lock);
      await endQuietly(pg);
      removeContainer(CONSUMER_NAME);
      removeContainer(PROXY_NAME);
      if (appsStopped) {
        compose(['start', 'app-1', 'app-2', 'app-3'], true);
      }
      await waitForAllReady();
    }
  }, 180000);

  test('7) concurrent outbox publishers (SKIP LOCKED) publish every event exactly to a stable broker id', async () => {
    await expectStackReady();
    const pg = await getPg();
    let paused = false;
    let localstackId = '';

    try {
      await waitFor(
        'outbox idle before the publisher race',
        async () => {
          const result = await pg.query<{ count: number }>(
            'select count(*)::int as count from outbox_messages where published_at is null'
          );
          return (result.rows[0]?.count ?? 0) === 0 ? true : undefined;
        },
        60000,
        250
      );
      await drainQueue(EVENTS_QUEUE);

      const wallet = await createWallet(PORTS[0], '1000.00');
      localstackId = containerId('localstack');
      run(['docker', 'pause', localstackId]);
      paused = true;

      const wagers = Array.from({ length: 40 }).map((_, index) =>
        submitWager(PORTS[index % PORTS.length] ?? PORTS[0], wagerInput(wallet, '1.00'))
      );
      const responses = await Promise.all(wagers);
      for (const response of responses) {
        expect(response.status).toBe(201);
        expect(response.body?.status).toBe('PROCESSED');
      }

      await waitFor(
        'pending outbox rows while SQS is stalled',
        async () => {
          const result = await pg.query<{ count: number }>(
            'select count(*)::int as count from outbox_messages where aggregate_id=$1 and published_at is null',
            [wallet.id]
          );
          const count = result.rows[0]?.count ?? 0;
          return count >= 40 ? count : undefined;
        },
        20000,
        100
      );

      const activity = await waitFor(
        'at least two independent outbox publishers',
        async () => {
          const result = await pg.query<{ publishers: number; lock_waiters: number }>(
            `select
                 count(distinct client_addr)::int as publishers,
                 count(*) filter (where wait_event_type='Lock')::int as lock_waiters
               from pg_stat_activity
               where query ilike '%outbox_messages%'
                 and pid <> pg_backend_pid()
                 and state in ('active', 'idle in transaction')`
          );
          const row = result.rows[0];
          if (row === undefined || row.publishers < 2) return undefined;
          return row;
        },
        20000,
        100
      );
      expect(activity.lock_waiters).toBe(0);
      log(
        `publishers=${activity.publishers} lockWaiters=${activity.lock_waiters} ` +
          '(SKIP LOCKED lets each publisher claim a different batch)'
      );

      run(['docker', 'unpause', localstackId]);
      paused = false;

      await waitFor(
        'wallet outbox drained',
        async () => {
          const result = await pg.query<{ count: number }>(
            'select count(*)::int as count from outbox_messages where aggregate_id=$1 and published_at is null',
            [wallet.id]
          );
          return (result.rows[0]?.count ?? 0) === 0 ? true : undefined;
        },
        60000,
        250
      );

      const target = await pg.query<{ id: string }>(
        `select id::text
             from outbox_messages
            where aggregate_id=$1::text
               or aggregate_id in (select id::text from wager_transactions where wallet_id=$1::uuid)
            order by occurred_at asc, id asc`,
        [wallet.id]
      );
      const targetIds = target.rows.map((row) => row.id);
      const received = await drainQueue(EVENTS_QUEUE);
      const eventIds = received.map((message) => brokerEventId(message));
      const unique = new Set(eventIds);
      const missing = targetIds.filter((id) => !unique.has(id));
      const unexpected = eventIds.filter((id) => !targetIds.includes(id));
      const duplicates = eventIds.length - unique.size;

      expect(missing).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(unique.size).toBe(targetIds.length);
      expect(eventIds.length).toBeGreaterThanOrEqual(targetIds.length);
      log(
        `outboxRows=${targetIds.length} brokerMessages=${eventIds.length} ` +
          `uniqueEventIds=${unique.size} duplicatesTolerated=${duplicates}`
      );
    } finally {
      if (paused && localstackId.length > 0) {
        run(['docker', 'unpause', localstackId], true);
      }
      await endQuietly(pg);
    }
  }, 180000);

  test('8) all replicas restart mid-load -> retries converge with no duplicate debit and a drained outbox', async () => {
    await expectStackReady();
    const pg = await getPg();
    const betCount = 80;
    const amountPerBet = 1;

    try {
      await waitFor(
        'outbox idle before restart scenario',
        async () => {
          const result = await pg.query<{ count: number }>(
            'select count(*)::int as count from outbox_messages where published_at is null'
          );
          return (result.rows[0]?.count ?? 0) === 0 ? true : undefined;
        },
        60000,
        250
      );

      const wallet = await createWallet(PORTS[0], '1000.00');
      const bets = Array.from({ length: betCount }).map((_, index) => ({
        port: PORTS[index % PORTS.length] ?? PORTS[0],
        body: wagerInput(wallet, amountPerBet.toFixed(2)),
        key: 'idem-restart-' + randomUUID()
      }));

      const attempt = async (bet: (typeof bets)[number]): Promise<ApiResult<TransactionResponse>> => {
        try {
          return await request<TransactionResponse>(bet.port, 'POST', '/wagering/transactions', {
            body: bet.body,
            headers: { 'Idempotency-Key': bet.key },
            timeoutMs: 5000
          });
        } catch (error) {
          return {
            status: 0,
            body: undefined,
            text: error instanceof Error ? error.message : String(error),
            headers: new Headers()
          };
        }
      };

      const initial = bets.map((bet) => attempt(bet));
      await sleep(200);
      const beforeRestart = await pg.query<{ count: number }>(
        `select count(*)::int as count from wager_transactions
            where wallet_id=$1 and kind='BET' and status='PROCESSED'`,
        [wallet.id]
      );
      const processedBeforeRestart = beforeRestart.rows[0]?.count ?? 0;
      log(`restarting all replicas with ${processedBeforeRestart}/${betCount} bets already committed`);

      compose(['restart', 'app-1', 'app-2', 'app-3']);
      const firstAttempts = await Promise.all(initial);
      await waitForAllReady();
      log(`stack ready again; ${firstAttempts.filter((r) => r.status === 201).length} initial responses succeeded`);

      const retries = await Promise.all(bets.map((bet) => attempt(bet)));
      const retryFailures = retries.filter((result) => result.status !== 201 || result.body?.status !== 'PROCESSED');
      expect(retryFailures.map((result) => `${result.status} ${result.text}`)).toEqual([]);

      const state = await walletState(pg, wallet.id, bets[0]?.body.externalTransactionId ?? '', randomUUID());
      expect(state.balance).toBe('920.00');
      expect(state.debits).toBe(betCount);
      expect(state.net).toBe('920.00');
      expect(state.ledgerEntries).toBe(betCount + 1);
      expect(state.transactions).toBe(1);

      const processedTransactions = await pg.query<{ count: number }>(
        `select count(*)::int as count from wager_transactions
            where wallet_id=$1 and kind='BET' and status='PROCESSED'`,
        [wallet.id]
      );
      expect(processedTransactions.rows[0]?.count ?? 0).toBe(betCount);

      const duplicates = await pg.query<{ count: number }>(
        `select count(*)::int as count from (
             select transaction_id
               from wallet_ledger_entries
              where wallet_id=$1 and direction='DEBIT'
              group by transaction_id
             having count(*) > 1
           ) duplicated`,
        [wallet.id]
      );
      expect(duplicates.rows[0]?.count ?? 0).toBe(0);

      const uniqueTransactions = await pg.query<{ count: number }>(
        `select count(distinct transaction_id)::int as count
             from wallet_ledger_entries
            where wallet_id=$1 and direction='DEBIT'`,
        [wallet.id]
      );
      expect(uniqueTransactions.rows[0]?.count ?? 0).toBe(betCount);

      await waitFor(
        'outbox drained after restart',
        async () => {
          const result = await pg.query<{ count: number }>(
            'select count(*)::int as count from outbox_messages where published_at is null'
          );
          return (result.rows[0]?.count ?? 0) === 0 ? true : undefined;
        },
        60000,
        250
      );

      log(
        `final: balance=${state.balance} debits=${state.debits} ledgerNet=${state.net} ` +
          `ledgerEntries=${state.ledgerEntries} duplicateDebits=0 outboxPending=0`
      );
    } finally {
      await endQuietly(pg);
      await waitForAllReady();
    }
  }, 180000);
});
