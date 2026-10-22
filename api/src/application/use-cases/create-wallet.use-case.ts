import { Injectable } from '@nestjs/common';
import { EntityManager, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  BusinessRuleViolationError,
  FailureCodes,
  LedgerDirection,
  Money,
  OutboxMessage,
  Wallet,
  WalletLedgerEntry,
  WagerTransaction,
  WalletBalanceChanged,
  WagerTransactionProcessed,
  type MoneyProps,
} from '../../domain';
import {
  ledgerToEntity,
  outboxToEntity,
  wagerToEntity,
  walletToEntity,
} from '../../infrastructure/persistence/mappers/domain.mappers';
import { newId } from '../services/id';

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(private readonly em: EntityManager) {}

  async execute(input: CreateWalletInput): Promise<CreateWalletResult> {
    const initial = Money.from(input.initialBalance);
    if (initial.isNegative()) {
      throw new BusinessRuleViolationError(
        FailureCodes.INVALID_MONEY,
        'initial balance cannot be negative',
      );
    }

    return this.em.transactional(async (tem) => {
      const now = new Date();
      // version=1 after creation; OPENING is part of the same creation unit
      const wallet = Wallet.open({
        id: newId(),
        playerId: input.playerId,
        initialBalance: initial,
        createdAt: now,
      });

      try {
        await tem.persistAndFlush(walletToEntity(wallet));
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new BusinessRuleViolationError(
            FailureCodes.DUPLICATE_WALLET,
            'wallet already exists for playerId+currency',
          );
        }
        throw err;
      }

      if (initial.isPositive()) {
        const opening = WagerTransaction.createOpening({
          id: newId(),
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initial,
          createdAt: now,
        });
        opening.markProcessed(undefined, now);

        const entry = WalletLedgerEntry.create({
          id: newId(),
          walletId: wallet.id,
          transactionId: opening.id,
          direction: LedgerDirection.Credit,
          money: initial,
          balanceBefore: Money.zero(initial.currency),
          balanceAfter: initial,
          createdAt: now,
        });

        tem.persist(wagerToEntity(opening));
        tem.persist(ledgerToEntity(entry));

        const correlationId = newId();
        tem.persist(
          outboxToEntity(
            OutboxMessage.enqueue(
              WagerTransactionProcessed.from(opening, wallet.balance.toJSON(), {
                eventId: newId(),
                correlationId,
                occurredAt: now,
              }),
            ),
          ),
        );
        tem.persist(
          outboxToEntity(
            OutboxMessage.enqueue(
              WalletBalanceChanged.from(wallet, entry, {
                eventId: newId(),
                correlationId,
                occurredAt: now,
              }),
            ),
          ),
        );
      }

      await tem.flush();
      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
