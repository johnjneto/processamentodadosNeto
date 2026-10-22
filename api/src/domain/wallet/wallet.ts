import { Money, type MoneyProps } from '../money/money';
import {
  BusinessRuleViolationError,
  CurrencyMismatchError,
  InsufficientBalanceError,
} from '../errors/domain-errors';
import {
  LedgerDirection,
  WalletLedgerEntry,
} from '../ledger/wallet-ledger-entry';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletMovementResult {
  entry: WalletLedgerEntry;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
    createdAt?: Date;
  }): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new BusinessRuleViolationError(
        'INVALID_MONEY',
        'initial balance cannot be negative',
      );
    }
    const now = props.createdAt ?? new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
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

  debit(props: {
    entryId: string;
    transactionId: string;
    money: Money;
    at: Date;
  }): WalletMovementResult {
    this.assertSameCurrency(props.money);
    if (props.money.isNegative() || props.money.isZero()) {
      throw new BusinessRuleViolationError(
        'INVALID_MONEY',
        'debit amount must be positive',
      );
    }
    if (this._balance.isLessThan(props.money)) {
      throw new InsufficientBalanceError();
    }
    const before = this._balance;
    const after = before.subtract(props.money);
    if (after.isNegative()) {
      throw new BusinessRuleViolationError(
        'WOULD_RESULT_IN_NEGATIVE_BALANCE',
        'debit would result in negative balance',
      );
    }
    this._balance = after;
    this._version += 1;
    this._updatedAt = props.at;
    return {
      entry: WalletLedgerEntry.create({
        id: props.entryId,
        walletId: this.id,
        transactionId: props.transactionId,
        direction: LedgerDirection.Debit,
        money: props.money,
        balanceBefore: before,
        balanceAfter: after,
        createdAt: props.at,
      }),
    };
  }

  credit(props: {
    entryId: string;
    transactionId: string;
    money: Money;
    at: Date;
  }): WalletMovementResult {
    this.assertSameCurrency(props.money);
    if (props.money.isNegative() || props.money.isZero()) {
      throw new BusinessRuleViolationError(
        'INVALID_MONEY',
        'credit amount must be positive',
      );
    }
    const before = this._balance;
    const after = before.add(props.money);
    this._balance = after;
    this._version += 1;
    this._updatedAt = props.at;
    return {
      entry: WalletLedgerEntry.create({
        id: props.entryId,
        walletId: this.id,
        transactionId: props.transactionId,
        direction: LedgerDirection.Credit,
        money: props.money,
        balanceBefore: before,
        balanceAfter: after,
        createdAt: props.at,
      }),
    };
  }

  toState(): WalletState {
    return {
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: this._balance.toJSON(),
      version: this._version,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }
}
