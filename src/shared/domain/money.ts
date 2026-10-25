import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const DECIMAL_PATTERN = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -100, toExpPos: 100 });

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string
  ) {}

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;

    if (typeof amount !== 'string' || !DECIMAL_PATTERN.test(amount)) {
      throw new InvalidMoneyError('amount must be a non-negative decimal string with at most 2 decimal places', {
        amount
      });
    }
    Money.assertCurrency(currency);

    return new Money(new Decimal(amount), currency);
  }

  static zero(currency: string): Money {
    Money.assertCurrency(currency);
    return new Money(new Decimal(0), currency);
  }

  static rehydrate(props: MoneyProps): Money {
    const value = new Decimal(props.amount);
    if (!value.isFinite()) {
      throw new InvalidMoneyError('stored amount must be finite', { amount: props.amount });
    }
    Money.assertCurrency(props.currency);
    return new Money(value, props.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThan(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError('money operations require identical currencies', {
        left: this.currency,
        right: other.currency
      });
    }
  }

  private static assertCurrency(currency: string): void {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new InvalidMoneyError('currency must be an ISO-4217 uppercase code', { currency });
    }
  }
}
