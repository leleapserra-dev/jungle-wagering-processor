import { CurrencyMismatchError, InsufficientFundsError, InvalidWalletStateError } from '../../../shared/domain/errors';
import type { Money } from '../../../shared/domain/money';
import { LedgerDirection } from './ledger-direction';
import { WalletLedgerEntry } from './wallet-ledger-entry';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  at: Date;
}

export interface WalletMovementProps {
  transactionId: string;
  entryId: string;
  money: Money;
  at: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.id.length === 0 || props.playerId.length === 0) {
      throw new InvalidWalletStateError('wallet identifiers must not be empty');
    }
    if (props.initialBalance.isNegative()) {
      throw new InvalidWalletStateError('initial balance cannot be negative');
    }
    if (props.initialBalance.currency !== props.initialBalance.currency) {
      throw new CurrencyMismatchError('wallet currency must match initial balance');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.at,
      props.at
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(props: WalletMovementProps): WalletLedgerEntry {
    this.assertPositive(props.money);
    this.assertSameCurrency(props.money);
    if (this._balance.isLessThan(props.money)) {
      throw new InsufficientFundsError('wallet balance is insufficient for this debit', {
        walletId: this.id,
        transactionId: props.transactionId
      });
    }
    return this.move(LedgerDirection.Debit, props);
  }

  credit(props: WalletMovementProps): WalletLedgerEntry {
    this.assertPositive(props.money);
    this.assertSameCurrency(props.money);
    return this.move(LedgerDirection.Credit, props);
  }

  private move(direction: LedgerDirection, props: WalletMovementProps): WalletLedgerEntry {
    const balanceBefore = this._balance;
    const balanceAfter =
      direction === LedgerDirection.Debit ? balanceBefore.subtract(props.money) : balanceBefore.add(props.money);
    if (balanceAfter.isNegative()) {
      throw new InvalidWalletStateError('wallet balance cannot become negative', { walletId: this.id });
    }

    const entry = WalletLedgerEntry.create({
      id: props.entryId,
      walletId: this.id,
      transactionId: props.transactionId,
      direction,
      money: props.money,
      balanceBefore,
      balanceAfter,
      createdAt: props.at
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = props.at;
    return entry;
  }

  private assertPositive(money: Money): void {
    if (!money.isPositive()) {
      throw new InvalidWalletStateError('wallet movements require a positive amount', { walletId: this.id });
    }
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError('operation currency does not match wallet currency', {
        walletId: this.id,
        walletCurrency: this.currency,
        operationCurrency: money.currency
      });
    }
  }
}
