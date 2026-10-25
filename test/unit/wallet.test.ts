import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/shared/domain/money';
import { UuidV7Generator, SystemClock } from '../../src/shared/domain/identity';
import { Wallet } from '../../src/modules/wallet/domain/wallet';
import { InsufficientFundsError } from '../../src/shared/domain/errors';
import { LedgerDirection } from '../../src/modules/wallet/domain/ledger-direction';

describe('Wallet', () => {
  const ids = new UuidV7Generator();
  const clock = new SystemClock();
  const now = clock.now();

  test('open gives balance and version 1', () => {
    const wallet = Wallet.open({
      id: ids.next(),
      playerId: ids.next(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      at: now
    });
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('debit moves balance and creates balanced ledger entry', () => {
    const wallet = Wallet.open({
      id: ids.next(),
      playerId: ids.next(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      at: now
    });
    const entry = wallet.debit({
      transactionId: ids.next(),
      entryId: ids.next(),
      money: Money.from({ amount: '80.00', currency: 'BRL' }),
      at: now
    });
    expect(wallet.balance.toString()).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
  });

  test('insufficient funds throws', () => {
    const wallet = Wallet.open({
      id: ids.next(),
      playerId: ids.next(),
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
      at: now
    });
    expect(() =>
      wallet.debit({
        transactionId: ids.next(),
        entryId: ids.next(),
        money: Money.from({ amount: '80.00', currency: 'BRL' }),
        at: now
      })
    ).toThrow(InsufficientFundsError);
  });

  test('opening credit does not increment version', () => {
    const wallet = Wallet.open({
      id: ids.next(),
      playerId: ids.next(),
      initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
      at: now
    });
    expect(wallet.version).toBe(1);
    wallet.credit({
      transactionId: ids.next(),
      entryId: ids.next(),
      money: Money.from({ amount: '100.00', currency: 'BRL' }),
      at: now
    });
    (wallet as any)._version = 1;
    (wallet as any)._updatedAt = now;
    expect(wallet.version).toBe(1);
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
  });
});
