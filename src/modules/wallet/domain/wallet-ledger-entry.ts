import { InvalidLedgerEntryError } from '../../../shared/domain/errors';
import type { Money } from '../../../shared/domain/money';
import { LedgerDirection } from './ledger-direction';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface LedgerEntryState extends CreateLedgerEntryProps {}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (props.id.length === 0 || props.walletId.length === 0 || props.transactionId.length === 0) {
      throw new InvalidLedgerEntryError('ledger identifiers must not be empty');
    }
    if (!props.money.isPositive()) {
      throw new InvalidLedgerEntryError('ledger amount must be positive', { transactionId: props.transactionId });
    }
    if (props.balanceBefore.currency !== props.money.currency || props.balanceAfter.currency !== props.money.currency) {
      throw new InvalidLedgerEntryError('ledger currencies must match', { transactionId: props.transactionId });
    }

    const expected =
      props.direction === LedgerDirection.Debit
        ? props.balanceBefore.subtract(props.money)
        : props.balanceBefore.add(props.money);

    if (!expected.equals(props.balanceAfter)) {
      throw new InvalidLedgerEntryError('ledger arithmetic is inconsistent', {
        transactionId: props.transactionId,
        direction: props.direction
      });
    }
    if (props.balanceAfter.isNegative()) {
      throw new InvalidLedgerEntryError('ledger balance cannot be negative', { transactionId: props.transactionId });
    }

    return new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt
    );
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt
    );
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Debit
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);
    return expected.equals(this.balanceAfter);
  }
}
