/**
 * Integration/concurrency scenarios — require PostgreSQL (+ optional LocalStack).
 * Skip automatically when DATABASE_URL is unreachable.
 *
 * Covered:
 * - 50 parallel identical BETs → one debit
 * - two concurrent 80 BETs on 100 balance → one PROCESSED, one REJECTED, balance 20
 * - wallet.balance == ledger reconstruction
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { MikroORM, LockMode } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletEntity } from '../../src/infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../src/infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../src/infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../src/infrastructure/persistence/entities/outbox-message.entity';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/query.use-cases';
import { MetricsService } from '../../src/infrastructure/observability/metrics.service';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/domain';
import { v7 as uuidv7 } from 'uuid';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://wager:wager@localhost:5432/wagering';

let orm: MikroORM | undefined;
let available = false;

beforeAll(async () => {
  try {
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      clientUrl: DATABASE_URL,
      entities: [
        WalletEntity,
        WagerTransactionEntity,
        WalletLedgerEntryEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ],
      migrations: {
        path: 'src/infrastructure/persistence/migrations',
        glob: 'Migration*.ts',
      },
      extensions: [Migrator],
      allowGlobalContext: true,
    });
    await orm.getMigrator().up();
    available = true;
  } catch (err) {
    console.warn('Skipping integration tests — DB unavailable:', (err as Error).message);
    available = false;
  }
});

afterAll(async () => {
  await orm?.close(true);
});

function usecases() {
  const em = orm!.em.fork();
  const metrics = new MetricsService();
  return {
    em,
    create: new CreateWalletUseCase(em),
    process: new ProcessWagerTransactionUseCase(em, metrics),
    reconcile: new ReconcileWalletUseCase(em, metrics),
  };
}

describe('concurrency + financial invariants', () => {
  test('50 parallel identical BETs → single debit + consistent ledger', async () => {
    if (!available) return;
    const { create, process, reconcile } = usecases();
    const playerId = uuidv7();
    const wallet = await create.execute({
      playerId,
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        process.execute({
          providerId: 'provider-a',
          externalTransactionId: 'same-tx-50',
          idempotencyKey: 'provider-a:same-tx-50',
          playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'game-1',
          kind: WagerTransactionKind.Bet,
          money: { amount: '10.00', currency: 'BRL' },
        }),
      ),
    );

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    expect(processed.length).toBe(50);
    expect(processed.filter((r) => !r.idempotentReplay).length).toBe(1);

    const rec = await reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe('990.00');
    expect(rec.checkedEntries).toBe(2); // OPENING + BET
  });

  test('section 8: two concurrent 80 BETs on 100 → one win one reject, balance 20', async () => {
    if (!available) return;
    const { create, process, reconcile, em } = usecases();
    const playerId = uuidv7();
    const wallet = await create.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const [a, b] = await Promise.all([
      process.execute({
        providerId: 'provider-a',
        externalTransactionId: 'bet-a',
        idempotencyKey: 'provider-a:bet-a',
        playerId,
        walletId: wallet.id,
        roundId: 'round-hot',
        gameId: 'game',
        kind: WagerTransactionKind.Bet,
        money: { amount: '80.00', currency: 'BRL' },
      }),
      process.execute({
        providerId: 'provider-a',
        externalTransactionId: 'bet-b',
        idempotencyKey: 'provider-a:bet-b',
        playerId,
        walletId: wallet.id,
        roundId: 'round-hot',
        gameId: 'game',
        kind: WagerTransactionKind.Bet,
        money: { amount: '80.00', currency: 'BRL' },
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
    ]);
    const rejected = [a, b].find((r) => r.status === WagerTransactionStatus.Rejected)!;
    expect(rejected.failureCode).toBe('INSUFFICIENT_BALANCE');

    const rec = await reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe('20.00');

    const debits = await em.find(WalletLedgerEntryEntity, {
      walletId: wallet.id,
      direction: 'DEBIT',
    });
    expect(debits.length).toBe(1);
  });

  test('REFUND before BET parks as PENDING_REFERENCE then processes', async () => {
    if (!available) return;
    const { create, process, reconcile } = usecases();
    const playerId = uuidv7();
    const wallet = await create.execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    const refundFirst = await process.execute({
      providerId: 'provider-a',
      externalTransactionId: 'refund-1',
      idempotencyKey: 'provider-a:refund-1',
      playerId,
      walletId: wallet.id,
      roundId: 'round-oo',
      gameId: 'game',
      kind: WagerTransactionKind.Refund,
      money: { amount: '30.00', currency: 'BRL' },
      referenceExternalTransactionId: 'bet-late',
    });
    expect(refundFirst.status).toBe(WagerTransactionStatus.PendingReference);

    await process.execute({
      providerId: 'provider-a',
      externalTransactionId: 'bet-late',
      idempotencyKey: 'provider-a:bet-late',
      playerId,
      walletId: wallet.id,
      roundId: 'round-oo',
      gameId: 'game',
      kind: WagerTransactionKind.Bet,
      money: { amount: '30.00', currency: 'BRL' },
    });

    const again = await process.reprocessPendingReference(refundFirst.transactionId);
    expect(again.status).toBe(WagerTransactionStatus.Processed);

    const rec = await reconcile.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe('100.00');
  });

  test('pessimistic lock mode is available on wallet row', async () => {
    if (!available) return;
    const em = orm!.em.fork();
    await em.transactional(async (tem) => {
      const w = await tem.findOne(
        WalletEntity,
        {},
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      expect(w === null || typeof w.id === 'string').toBe(true);
    });
  });
});
