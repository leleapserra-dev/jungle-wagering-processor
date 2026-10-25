import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/shared/domain/money';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/shared/domain/errors';

describe('Money', () => {
  test('from/toJSON preserves two decimals', () => {
    const m = Money.from({ amount: '25.00', currency: 'BRL' });
    expect(m.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  test('add/subtract with same currency', () => {
    const a = Money.from({ amount: '10.50', currency: 'BRL' });
    const b = Money.from({ amount: '2.00', currency: 'BRL' });
    expect(a.add(b).toString()).toBe('12.50');
    expect(a.subtract(b).toString()).toBe('8.50');
  });

  test('rejects different currency', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '10.00', currency: 'USD' });
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  test('rejects more than two decimals', () => {
    expect(() => Money.from({ amount: '10.001', currency: 'BRL' })).toThrow(InvalidMoneyError);
  });

  test('rejects negative in from', () => {
    expect(() => Money.from({ amount: '-1.00', currency: 'BRL' })).toThrow(InvalidMoneyError);
  });
});
