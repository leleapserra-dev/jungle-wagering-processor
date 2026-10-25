import { describe, expect, test } from 'bun:test';
import { PORTS, createWallet, expectStackReady, getPg, submitWager, wagerInput } from '../support/api';

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

describe('load: sustained wagering traffic', () => {
  test('120 parallel bets across 3 replicas keep balance and ledger consistent', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '200.00');
    const startedAt = performance.now();
    const latencies: number[] = [];

    const calls = Array.from({ length: 120 }).map(async (_, index) => {
      const callStartedAt = performance.now();
      const result = await submitWager(PORTS[index % PORTS.length] ?? PORTS[0], wagerInput(wallet, '1.00', 'BET'));
      latencies.push(performance.now() - callStartedAt);
      return result;
    });

    const results = await Promise.all(calls);
    const elapsedMs = performance.now() - startedAt;

    expect(results.filter((result) => result.status >= 500)).toHaveLength(0);
    expect(results.filter((result) => result.status === 201)).toHaveLength(120);
    expect(results.filter((result) => result.body?.status === 'PROCESSED')).toHaveLength(120);
    expect(percentile(latencies, 95)).toBeLessThan(10000);
    expect(elapsedMs).toBeLessThan(60000);

    const pg = await getPg();
    try {
      const state = await pg.query<{ balance: string; debits: string; ledger_total: string }>(
        `select
           (select balance from wallets where id=$1)::text as balance,
           (select count(*) from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT')::text as debits,
           (select coalesce(sum(amount), 0) from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT')::text as ledger_total`,
        [wallet.id]
      );
      expect(state.rows[0]?.balance).toBe('80.00');
      expect(state.rows[0]?.debits).toBe('120');
      expect(state.rows[0]?.ledger_total).toBe('120.00');
    } finally {
      await pg.end();
    }
  }, 120000);

  test('60 parallel duplicate submissions produce one effect and 59 replays', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[1], '100.00');
    const input = wagerInput(wallet, '9.00', 'BET');
    const key = 'idem-load-' + crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 60 }).map((_, index) => submitWager(PORTS[index % PORTS.length] ?? PORTS[0], input, key))
    );

    expect(results.filter((result) => result.status >= 500)).toHaveLength(0);
    const processed = results.filter(
      (result) => result.body?.status === 'PROCESSED' && result.body.idempotentReplay === false
    );
    const replays = results.filter((result) => result.body?.idempotentReplay === true);
    expect(processed).toHaveLength(1);
    expect(replays).toHaveLength(59);

    const pg = await getPg();
    try {
      const state = await pg.query<{ balance: string; debits: string; transactions: string }>(
        `select
           (select balance from wallets where id=$1)::text as balance,
           (select count(*) from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT')::text as debits,
           (select count(*) from wager_transactions where idempotency_key=$2)::text as transactions`,
        [wallet.id, key]
      );
      expect(state.rows[0]?.balance).toBe('91.00');
      expect(state.rows[0]?.debits).toBe('1');
      expect(state.rows[0]?.transactions).toBe('1');
    } finally {
      await pg.end();
    }
  }, 60000);
});
