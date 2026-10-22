import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import Decimal from 'decimal.js';
import {
  BusinessRuleViolationError,
  FailureCodes,
  Money,
  type MoneyProps,
  WagerTransactionStatus,
} from '../../domain';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { MetricsService } from '../../infrastructure/observability/metrics.service';
import { wagerFromEntity } from '../../infrastructure/persistence/mappers/domain.mappers';

@Injectable()
export class GetWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string) {
    const w = await this.em.findOne(WalletEntity, { id: walletId });
    if (!w) {
      throw new BusinessRuleViolationError(FailureCodes.WALLET_NOT_FOUND, 'wallet not found');
    }
    return {
      id: w.id,
      playerId: w.playerId,
      balance: { amount: w.balanceAmount, currency: w.currency },
      version: w.version,
    };
  }
}

@Injectable()
export class GetLedgerUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(walletId: string, cursor: string | undefined, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    let createdAt: Date | undefined;
    let id: string | undefined;
    if (cursor) {
      try {
        const raw = Buffer.from(cursor, 'base64url').toString('utf8');
        const parsed = JSON.parse(raw) as { createdAt: string; id: string };
        createdAt = new Date(parsed.createdAt);
        id = parsed.id;
      } catch {
        throw new BusinessRuleViolationError(FailureCodes.INVALID_PAYLOAD, 'invalid cursor');
      }
    }

    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryEntity, 'l')
      .where({ walletId })
      .orderBy({ createdAt: 'asc', id: 'asc' })
      .limit(take + 1);

    if (createdAt && id) {
      qb.andWhere(
        '(l.created_at > ? OR (l.created_at = ? AND l.id > ?))',
        [createdAt, createdAt, id],
      );
    }

    const rows = await qb.getResult();
    const page = rows.slice(0, take);
    const next =
      rows.length > take
        ? Buffer.from(
            JSON.stringify({
              createdAt: page[page.length - 1]!.createdAt.toISOString(),
              id: page[page.length - 1]!.id,
            }),
            'utf8',
          ).toString('base64url')
        : null;

    return {
      items: page.map((e) => ({
        id: e.id,
        transactionId: e.transactionId,
        direction: e.direction,
        money: { amount: e.amount, currency: e.currency },
        balanceBefore: { amount: e.balanceBefore, currency: e.currency },
        balanceAfter: { amount: e.balanceAfter, currency: e.currency },
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: next,
    };
  }
}

@Injectable()
export class GetTransactionUseCase {
  constructor(private readonly em: EntityManager) {}

  async byId(transactionId: string) {
    const e = await this.em.findOne(WagerTransactionEntity, { id: transactionId });
    if (!e) {
      throw new BusinessRuleViolationError(FailureCodes.INVALID_PAYLOAD, 'transaction not found');
    }
    return this.toDto(e);
  }

  async byProviderExternal(providerId: string, externalTransactionId: string) {
    const e = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    if (!e) {
      throw new BusinessRuleViolationError(FailureCodes.INVALID_PAYLOAD, 'transaction not found');
    }
    return this.toDto(e);
  }

  private toDto(e: WagerTransactionEntity) {
    const tx = wagerFromEntity(e);
    return {
      transactionId: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      failureCode: tx.failureCode,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      processedAt: tx.processedAt?.toISOString(),
      createdAt: tx.createdAt.toISOString(),
    };
  }
}

@Injectable()
export class ReconcileWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
  ) {}

  async execute(walletId: string) {
    const wallet = await this.em.findOne(WalletEntity, { id: walletId });
    if (!wallet) {
      throw new BusinessRuleViolationError(FailureCodes.WALLET_NOT_FOUND, 'wallet not found');
    }

    const entries = await this.em.find(
      WalletLedgerEntryEntity,
      { walletId },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );

    let calculated = new Decimal(0);
    for (const e of entries) {
      if (e.direction === 'CREDIT') {
        calculated = calculated.plus(e.amount);
      } else {
        calculated = calculated.minus(e.amount);
      }
    }

    const stored = new Decimal(wallet.balanceAmount);
    const difference = stored.minus(calculated);
    const consistent = difference.isZero();

    if (!consistent) {
      this.metrics.inc('reconciliation_divergences');
      // structured log without full financial dump
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'wallet_reconciliation_divergence',
          walletId,
          checkedEntries: entries.length,
        }),
      );
    }

    const currency = wallet.currency;
    return {
      walletId,
      storedBalance: {
        amount: Money.from({ amount: stored.toFixed(2), currency }).toJSON().amount,
        currency,
      } satisfies MoneyProps,
      calculatedBalance: {
        amount: Money.from({ amount: calculated.toFixed(2), currency }).toJSON().amount,
        currency,
      } satisfies MoneyProps,
      difference: {
        amount: Money.from({ amount: difference.toFixed(2), currency }).toJSON().amount,
        currency,
      } satisfies MoneyProps,
      consistent,
      checkedEntries: entries.length,
    };
  }
}

export { WagerTransactionStatus };
