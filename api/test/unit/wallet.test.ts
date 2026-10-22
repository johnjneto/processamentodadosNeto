import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import { Wallet } from '../../src/domain/wallet/wallet';
import { InsufficientBalanceError } from '../../src/domain/errors/domain-errors';
import { LedgerDirection } from '../../src/domain/ledger/wallet-ledger-entry';

describe('Wallet', () => {
  test('open starts at version 1', () => {
    const w = Wallet.open({
      id: 'w1',
      playerId: 'p1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    expect(w.version).toBe(1);
    expect(w.balance.toString()).toBe('100.00');
  });

  test('debit creates DEBIT ledger and bumps version', () => {
    const w = Wallet.open({
      id: 'w1',
      playerId: 'p1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const { entry } = w.debit({
      entryId: 'e1',
      transactionId: 't1',
      money: Money.from({ amount: '40.00', currency: 'BRL' }),
      at: new Date(),
    });
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.toString()).toBe('60.00');
    expect(w.version).toBe(2);
    expect(entry.isBalanced()).toBe(true);
  });

  test('insufficient balance is rejected without mutation', () => {
    const w = Wallet.open({
      id: 'w1',
      playerId: 'p1',
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    expect(() =>
      w.debit({
        entryId: 'e1',
        transactionId: 't1',
        money: Money.from({ amount: '20.00', currency: 'BRL' }),
        at: new Date(),
      }),
    ).toThrow(InsufficientBalanceError);
    expect(w.balance.toString()).toBe('10.00');
    expect(w.version).toBe(1);
  });

  test('currency conflict on credit', () => {
    const w = Wallet.open({
      id: 'w1',
      playerId: 'p1',
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    expect(() =>
      w.credit({
        entryId: 'e1',
        transactionId: 't1',
        money: Money.from({ amount: '1.00', currency: 'USD' }),
        at: new Date(),
      }),
    ).toThrow();
  });

  test('rehydrate does not revalidate transitions', () => {
    const w = Wallet.rehydrate({
      id: 'w1',
      playerId: 'p1',
      currency: 'BRL',
      balance: { amount: '5.00', currency: 'BRL' },
      version: 9,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(w.version).toBe(9);
  });
});
