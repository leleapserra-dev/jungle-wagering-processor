import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import {
  PORTS,
  createWallet,
  expectStackReady,
  getPg,
  request,
  submitWager,
  waitFor,
  wagerInput
} from '../support/api';
import type { ReconciliationResponse } from '../support/api';

describe('integration: persisted financial state', () => {
  test('ledger is append-only, balances reconcile and outbox is drained', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '100.00');

    const bet = await submitWager(PORTS[1], wagerInput(wallet, '15.00', 'BET'));
    expect(bet.status).toBe(201);
    expect(bet.body?.status).toBe('PROCESSED');

    const win = await submitWager(PORTS[2], wagerInput(wallet, '5.00', 'WIN'));
    expect(win.status).toBe(201);
    expect(win.body?.status).toBe('PROCESSED');

    const pg = await getPg();
    try {
      const stored = await pg.query<{ balance: string; version: number }>(
        'select balance, version from wallets where id=$1',
        [wallet.id]
      );
      expect(stored.rows[0]?.balance).toBe('90.00');
      expect(stored.rows[0]?.version).toBe(3);

      const ledger = await pg.query<{
        id: string;
        direction: string;
        amount: string;
        balance_before: string;
        balance_after: string;
      }>(
        `select id, direction, amount, balance_before, balance_after
         from wallet_ledger_entries
         where wallet_id=$1
         order by created_at asc, id asc`,
        [wallet.id]
      );
      expect(
        ledger.rows.map((entry) => ({
          direction: entry.direction,
          amount: entry.amount,
          before: entry.balance_before,
          after: entry.balance_after
        }))
      ).toEqual([
        { direction: 'CREDIT', amount: '100.00', before: '0.00', after: '100.00' },
        { direction: 'DEBIT', amount: '15.00', before: '100.00', after: '85.00' },
        { direction: 'CREDIT', amount: '5.00', before: '85.00', after: '90.00' }
      ]);

      const totals = await pg.query<{ credits: string; debits: string }>(
        `select
           coalesce(sum(case when direction='CREDIT' then amount else 0 end), 0)::text as credits,
           coalesce(sum(case when direction='DEBIT' then amount else 0 end), 0)::text as debits
         from wallet_ledger_entries where wallet_id=$1`,
        [wallet.id]
      );
      expect(Number(totals.rows[0]?.credits) - Number(totals.rows[0]?.debits)).toBe(90);

      const entryId = ledger.rows[0]?.id;
      if (entryId === undefined) throw new Error('ledger entry missing');
      await expect(pg.query("update wallet_ledger_entries set amount='1.00' where id=$1", [entryId])).rejects.toThrow(
        /immutable/
      );
      await expect(pg.query('delete from wallet_ledger_entries where id=$1', [entryId])).rejects.toThrow(/immutable/);

      const reconciliation = await request<ReconciliationResponse>(
        PORTS[2],
        'POST',
        '/wallets/' + wallet.id + '/reconciliation'
      );
      expect(reconciliation.status).toBe(201);
      expect(reconciliation.body?.consistent).toBe(true);
      expect(reconciliation.body?.difference.amount).toBe('0.00');
      expect(reconciliation.body?.checkedEntries).toBe(3);

      const pending = await waitFor('outbox drain', async () => {
        const res = await pg.query<{ pending: string; event_types: string[] }>(
          `select count(*)::text as pending, coalesce(array_agg(distinct event_type), '{}') as event_types
           from outbox_messages
           where payload->'data'->>'walletId'=$1 and published_at is null`,
          [wallet.id]
        );
        return Number(res.rows[0]?.pending) === 0 ? res.rows[0] : undefined;
      });
      expect(Number(pending?.pending)).toBe(0);

      const events = await pg.query<{ event_type: string; published_at: Date | null }>(
        `select event_type, published_at from outbox_messages where payload->'data'->>'walletId'=$1`,
        [wallet.id]
      );
      const types = new Set(events.rows.map((row) => row.event_type));
      expect(types.has('WagerTransactionProcessed')).toBe(true);
      expect(types.has('WalletBalanceChanged')).toBe(true);
      expect(events.rows.every((row) => row.published_at !== null)).toBe(true);
    } finally {
      await pg.end();
    }
  }, 60000);

  test('refund and rollback reference a processed transaction atomically', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '100.00');
    const betBody = wagerInput(wallet, '20.00', 'BET');
    const bet = await submitWager(PORTS[0], betBody);
    expect(bet.status).toBe(201);
    expect(bet.body?.status).toBe('PROCESSED');

    const refundBody = {
      ...wagerInput(wallet, '20.00', 'REFUND'),
      providerId: betBody.providerId,
      roundId: betBody.roundId,
      referenceExternalTransactionId: betBody.externalTransactionId
    };
    const refund = await submitWager(PORTS[1], refundBody);
    expect(refund.status).toBe(201);
    expect(refund.body?.status).toBe('PROCESSED');
    expect(refund.body?.balance.amount).toBe('100.00');

    const rollbackBody = {
      ...wagerInput(wallet, '20.00', 'ROLLBACK'),
      providerId: betBody.providerId,
      roundId: betBody.roundId,
      referenceExternalTransactionId: refundBody.externalTransactionId
    };
    const rollback = await submitWager(PORTS[2], rollbackBody);
    expect(rollback.status).toBe(201);
    expect(rollback.body?.status).toBe('PROCESSED');
    expect(rollback.body?.balance.amount).toBe('80.00');

    const duplicateRefund = await submitWager(
      PORTS[1],
      { ...refundBody, externalTransactionId: 'ext-' + randomUUID() },
      'idem-refund-duplicate-' + randomUUID()
    );
    expect(duplicateRefund.status).toBe(422);
    expect(duplicateRefund.body?.failureCode).toBe('ALREADY_REVERSED');

    const pg = await getPg();
    try {
      const state = await pg.query<{ balance: string; entries: string }>(
        `select
           (select balance from wallets where id=$1)::text as balance,
           (select count(*) from wallet_ledger_entries where wallet_id=$1)::text as entries`,
        [wallet.id]
      );
      expect(state.rows[0]?.balance).toBe('80.00');
      expect(state.rows[0]?.entries).toBe('4');
    } finally {
      await pg.end();
    }
  }, 60000);

  test('pending reference retries and resolves once the referenced transaction arrives', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '100.00');
    const providerId = 'prov-' + randomUUID();
    const roundId = 'r-' + randomUUID();
    const missingReference = 'ext-missing-' + randomUUID();

    const pending = await submitWager(PORTS[1], {
      ...wagerInput(wallet, '10.00', 'REFUND'),
      providerId,
      roundId,
      referenceExternalTransactionId: missingReference
    });
    expect(pending.status).toBe(201);
    expect(pending.body?.status).toBe('PENDING_REFERENCE');
    const pendingId = pending.body?.transactionId;
    if (pendingId === undefined) throw new Error('missing pending transaction id');

    const pg = await getPg();
    try {
      const retried = await waitFor(
        'pending reference retry',
        async () => {
          const res = await pg.query<{ status: string; reference_attempts: number }>(
            'select status, reference_attempts from wager_transactions where id=$1',
            [pendingId]
          );
          const row = res.rows[0];
          return row !== undefined && row.reference_attempts >= 2 ? row : undefined;
        },
        20000
      );
      expect(retried.status).toBe('PENDING_REFERENCE');

      const referenceBody = {
        ...wagerInput(wallet, '10.00', 'BET'),
        providerId,
        roundId,
        externalTransactionId: missingReference
      };
      const reference = await submitWager(PORTS[2], referenceBody);
      expect(reference.status).toBe(201);
      expect(reference.body?.status).toBe('PROCESSED');
      const referenceId = reference.body?.transactionId;
      if (referenceId === undefined) throw new Error('missing reference transaction id');

      const resolved = await waitFor(
        'pending reference resolved',
        async () => {
          const res = await pg.query<{ status: string; reference_transaction_id: string | null }>(
            'select status, reference_transaction_id from wager_transactions where id=$1',
            [pendingId]
          );
          return res.rows[0]?.status === 'PROCESSED' ? res.rows[0] : undefined;
        },
        30000
      );
      expect(resolved.reference_transaction_id).toBe(referenceId);

      const state = await pg.query<{ balance: string; entries: string }>(
        `select
           (select balance from wallets where id=$1)::text as balance,
           (select count(*) from wallet_ledger_entries where wallet_id=$1)::text as entries`,
        [wallet.id]
      );
      expect(state.rows[0]?.balance).toBe('100.00');
      expect(state.rows[0]?.entries).toBe('3');
    } finally {
      await pg.end();
    }
  }, 90000);

  test('transaction lookup and idempotency are persisted', async () => {
    await expectStackReady();
    const wallet = await createWallet(PORTS[0], '50.00');
    const body = wagerInput(wallet, '7.50', 'BET');
    const key = 'idem-persisted-' + randomUUID();

    const first = await submitWager(PORTS[0], body, key);
    expect(first.status).toBe(201);
    expect(first.body?.idempotentReplay).toBe(false);

    const replay = await submitWager(PORTS[1], body, key);
    expect(replay.status).toBe(201);
    expect(replay.body?.idempotentReplay).toBe(true);
    expect(replay.body?.transactionId).toBe(first.body?.transactionId);

    const pg = await getPg();
    try {
      const tx = await pg.query<{ status: string; payload_hash: string; idempotency_key: string }>(
        'select status, payload_hash, idempotency_key from wager_transactions where id=$1',
        [first.body?.transactionId]
      );
      expect(tx.rows[0]?.status).toBe('PROCESSED');
      expect(tx.rows[0]?.idempotency_key).toBe(key);
      expect(tx.rows[0]?.payload_hash).toHaveLength(64);

      const count = await pg.query<{ c: string }>(
        "select count(*)::text as c from wager_transactions where wallet_id=$1 and kind='BET'",
        [wallet.id]
      );
      expect(count.rows[0]?.c).toBe('1');
    } finally {
      await pg.end();
    }

    const byProvider = await request<{ id: string }>(
      PORTS[2],
      'GET',
      '/providers/' + body.providerId + '/wagering/transactions/' + body.externalTransactionId
    );
    expect(byProvider.status).toBe(200);
    expect(byProvider.body?.id).toBe(first.body?.transactionId);
  }, 60000);
});
