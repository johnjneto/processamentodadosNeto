import { describe, expect, test } from 'bun:test';
import { Money } from '../../src/domain/money/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wager/wager-transaction';
import { LedgerDirection } from '../../src/domain/ledger/wallet-ledger-entry';
import { InvalidTransactionStateError } from '../../src/domain/errors/domain-errors';
import {
  businessFieldsFromWager,
  hashPayload,
} from '../../src/application/services/payload-hash';

function bet(overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) {
  return WagerTransaction.create({
    id: 't1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'hash',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'r1',
    gameId: 'g1',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    ...overrides,
  });
}

describe('WagerTransaction rules', () => {
  test('BET debit direction; LOSS does not affect balance', () => {
    const b = bet();
    expect(b.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(b.affectsBalance()).toBe(true);

    const loss = bet({
      id: 't2',
      kind: WagerTransactionKind.Loss,
      externalTransactionId: 'ext-2',
      idempotencyKey: 'provider-a:ext-2',
    });
    expect(loss.affectsBalance()).toBe(false);
    expect(loss.ledgerDirectionFor()).toBeUndefined();
  });

  test('REFUND requires reference; ROLLBACK inverts reference direction', () => {
    expect(() =>
      bet({
        kind: WagerTransactionKind.Refund,
        externalTransactionId: 'ref-1',
        idempotencyKey: 'provider-a:ref-1',
      }),
    ).toThrow();

    const original = bet();
    original.markProcessed(undefined, new Date());
    const rollback = bet({
      id: 't3',
      kind: WagerTransactionKind.Rollback,
      externalTransactionId: 'rb-1',
      idempotencyKey: 'provider-a:rb-1',
      referenceExternalTransactionId: 'ext-1',
    });
    expect(rollback.requiresReference()).toBe(true);
    expect(rollback.ledgerDirectionFor(original)).toBe(LedgerDirection.Credit);
  });

  test('terminal states reject further transitions', () => {
    const t = bet();
    t.reject('INSUFFICIENT_BALANCE');
    expect(t.isTerminal()).toBe(true);
    expect(() => t.markProcessed(undefined, new Date())).toThrow(
      InvalidTransactionStateError,
    );
  });

  test('idempotency payload hash is stable and key-order independent', () => {
    const a = hashPayload(
      businessFieldsFromWager({
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        playerId: 'p',
        walletId: 'w',
        roundId: 'r',
        gameId: 'g',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    );
    const b = hashPayload({
      money: { currency: 'BRL', amount: '25.00' },
      kind: 'BET',
      gameId: 'g',
      roundId: 'r',
      walletId: 'w',
      playerId: 'p',
      externalTransactionId: 'transaction-123',
      providerId: 'provider-a',
    });
    expect(a).toBe(b);

    const conflict = hashPayload(
      businessFieldsFromWager({
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        playerId: 'p',
        walletId: 'w',
        roundId: 'r',
        gameId: 'g',
        kind: 'BET',
        money: { amount: '30.00', currency: 'BRL' },
      }),
    );
    expect(conflict).not.toBe(a);
  });

  test('matchesPayload detects divergence', () => {
    const t = bet({ payloadHash: 'abc' });
    expect(t.matchesPayload('abc')).toBe(true);
    expect(t.matchesPayload('xyz')).toBe(false);
  });

  test('status PENDING after create', () => {
    expect(bet().status).toBe(WagerTransactionStatus.Pending);
  });
});
