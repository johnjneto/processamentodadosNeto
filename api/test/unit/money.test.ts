import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/errors/domain-errors';

describe('Money', () => {
  test('parses fixed scale-2 decimal strings', () => {
    const m = Money.from({ amount: '25.5', currency: 'brl' });
    expect(m.toJSON()).toEqual({ amount: '25.50', currency: 'BRL' });
  });

  test('rejects scientific notation', () => {
    expect(() => Money.from({ amount: '1e2', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejects more than 2 decimal places', () => {
    expect(() => Money.from({ amount: '1.234', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test('rejects empty / NaN-like', () => {
    expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
    expect(() => Money.from({ amount: 'Infinity', currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  test('add/subtract are immutable and currency-safe', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '3.50', currency: 'BRL' });
    const c = a.add(b);
    expect(a.toString()).toBe('10.00');
    expect(c.toString()).toBe('13.50');
    expect(a.subtract(b).toString()).toBe('6.50');
  });

  test('currency mismatch throws', () => {
    const a = Money.from({ amount: '1.00', currency: 'BRL' });
    const b = Money.from({ amount: '1.00', currency: 'USD' });
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  test('zero and negate', () => {
    const z = Money.zero('BRL');
    expect(z.isZero()).toBe(true);
    const n = Money.from({ amount: '5.00', currency: 'BRL' }).negate();
    expect(n.isNegative()).toBe(true);
    expect(n.toString()).toBe('-5.00');
  });
});
