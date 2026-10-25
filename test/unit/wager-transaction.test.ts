import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/shared/domain/money';
import { WagerTransaction } from '../../src/modules/wagering/domain/wager-transaction';
import {
  WagerTransactionKind,
  WagerTransactionStatus
} from '../../src/modules/wagering/domain/wager-transaction-status';
import { FailureCode } from '../../src/modules/wagering/domain/failure-code';
import { UuidV7Generator, SystemClock } from '../../src/shared/domain/identity';

describe('WagerTransaction', () => {
  const ids = new UuidV7Generator();
  const clock = new SystemClock();
  const now = clock.now();

  test('bet created pending and requires no reference', () => {
    const tx = WagerTransaction.create({
      id: ids.next(),
      providerId: 'p1',
      externalTransactionId: 'e1',
      idempotencyKey: 'p1:e1',
      payloadHash: 'x',
      walletId: ids.next(),
      playerId: ids.next(),
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: undefined,
      createdAt: now,
      observedBalance: Money.from({ amount: '100.00', currency: 'BRL' })
    });
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.requiresReference()).toBe(false);
    expect(tx.affectsBalance()).toBe(true);
  });

  test('refund requires reference', () => {
    expect(() =>
      WagerTransaction.create({
        id: ids.next(),
        providerId: 'p1',
        externalTransactionId: 'e2',
        idempotencyKey: 'p1:e2',
        payloadHash: 'x',
        walletId: ids.next(),
        playerId: ids.next(),
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Refund,
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
        referenceExternalTransactionId: undefined,
        createdAt: now,
        observedBalance: Money.from({ amount: '100.00', currency: 'BRL' })
      })
    ).toThrow();
  });

  test('terminal states cannot transition', () => {
    const tx = WagerTransaction.create({
      id: ids.next(),
      providerId: 'p1',
      externalTransactionId: 'e3',
      idempotencyKey: 'p1:e3',
      payloadHash: 'x',
      walletId: ids.next(),
      playerId: ids.next(),
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Loss,
      money: Money.from({ amount: '0.00', currency: 'BRL' }),
      referenceExternalTransactionId: undefined,
      createdAt: now,
      observedBalance: Money.from({ amount: '100.00', currency: 'BRL' })
    });
    tx.reject(FailureCode.InvalidKind, now, Money.from({ amount: '100.00', currency: 'BRL' }));
    expect(() => tx.markProcessed(undefined, now, Money.from({ amount: '100.00', currency: 'BRL' }))).toThrow();
  });

  test('rejected transaction has failure code and is persisted format', () => {
    const tx = WagerTransaction.create({
      id: ids.next(),
      providerId: 'p1',
      externalTransactionId: 'e4',
      idempotencyKey: 'p1:e4',
      payloadHash: 'x',
      walletId: ids.next(),
      playerId: ids.next(),
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: undefined,
      createdAt: now,
      observedBalance: Money.from({ amount: '10.00', currency: 'BRL' })
    });
    tx.reject(FailureCode.InsufficientFunds, now, Money.from({ amount: '10.00', currency: 'BRL' }));
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
  });
});
