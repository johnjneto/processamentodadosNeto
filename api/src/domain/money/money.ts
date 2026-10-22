import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from '../errors/domain-errors';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!props.currency || typeof props.currency !== 'string') {
      throw new InvalidMoneyError('currency is required');
    }
    const currency = props.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new InvalidMoneyError(`invalid currency: ${props.currency}`);
    }
    const amount = Money.parseAmount(props.amount);
    return new Money(amount, currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  private static parseAmount(raw: string): Decimal {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new InvalidMoneyError('amount must be a non-empty decimal string');
    }
    const trimmed = raw.trim();
    if (/[eE]/.test(trimmed)) {
      throw new InvalidMoneyError('scientific notation is not allowed');
    }
    if (!AMOUNT_PATTERN.test(trimmed)) {
      throw new InvalidMoneyError(
        'amount must be a decimal string with at most 2 fractional digits',
      );
    }
    let d: Decimal;
    try {
      d = new Decimal(trimmed);
    } catch {
      throw new InvalidMoneyError('amount is not a valid decimal');
    }
    if (!d.isFinite()) {
      throw new InvalidMoneyError('amount must be finite');
    }
    return d.toDecimalPlaces(2);
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
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  /** Internal absolute decimal for persistence — still exact scale-2. */
  toDecimalString(): string {
    return this.toString();
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
