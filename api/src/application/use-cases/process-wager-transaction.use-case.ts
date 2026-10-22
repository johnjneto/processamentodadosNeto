import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  BusinessRuleViolationError,
  FailureCodes,
  IdempotencyConflictError,
  InsufficientBalanceError,
  InboxMessage,
  LedgerDirection,
  Money,
  OutboxMessage,
  WalletBalanceChanged,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionStatus,
  type FailureCode,
  type MoneyProps,
} from '../../domain';
import { WalletEntity } from '../../infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../../infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from '../../infrastructure/persistence/entities/outbox-message.entity';
import {
  applyWalletToEntity,
  applyWagerToEntity,
  inboxToEntity,
  ledgerToEntity,
  outboxToEntity,
  wagerFromEntity,
  wagerToEntity,
  walletFromEntity,
} from '../../infrastructure/persistence/mappers/domain.mappers';
import {
  businessFieldsFromWager,
  hashPayload,
} from '../services/payload-hash';
import { newId } from '../services/id';
import { MetricsService } from '../../infrastructure/observability/metrics.service';

export interface ProcessWagerInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId?: string;
  causationId?: string;
  /** When set, inbox row participates in the same SQL transaction. */
  inbox?: { messageId: string; consumerName: string };
}

export interface ProcessWagerResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance?: MoneyProps;
  /** Balance snapshot at original processing time for replay. */
  balanceAtProcessing?: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

/** Max attempts waiting for a missing reference before REJECTED. */
export const PENDING_REFERENCE_MAX_ATTEMPTS = 10;

@Injectable()
export class ProcessWagerTransactionUseCase {
  private readonly logger = new Logger(ProcessWagerTransactionUseCase.name);

  constructor(
    private readonly em: EntityManager,
    private readonly metrics: MetricsService,
  ) {}

  async execute(input: ProcessWagerInput): Promise<ProcessWagerResult> {
    if (input.kind === WagerTransactionKind.Opening) {
      throw new BusinessRuleViolationError(
        FailureCodes.OPENING_NOT_ALLOWED_EXTERNALLY,
        'OPENING cannot be submitted externally',
      );
    }

    const money = Money.from(input.money);
    const payloadHash = hashPayload(businessFieldsFromWager({ ...input, money: input.money }));
    const correlationId = input.correlationId ?? newId();

    return this.em.transactional(async (tem) => {
      if (input.inbox) {
        const claimed = await this.tryClaimInbox(tem, input.inbox, payloadHash);
        if (!claimed) {
          this.metrics.inc('duplicates_detected');
          const existing = await tem.findOne(WagerTransactionEntity, {
            idempotencyKey: input.idempotencyKey,
          });
          if (existing) {
            return this.replayResult(wagerFromEntity(existing), tem);
          }
          // Duplicate SQS delivery without matching tx yet — safe no-op ack path
          return {
            transactionId: 'duplicate-inbox',
            status: WagerTransactionStatus.Processed,
            idempotentReplay: true,
          };
        }
      }

      const existing = await tem.findOne(WagerTransactionEntity, {
        idempotencyKey: input.idempotencyKey,
      });
      if (existing) {
        const domain = wagerFromEntity(existing);
        if (!domain.matchesPayload(payloadHash)) {
          this.metrics.inc('idempotency_conflicts');
          throw new IdempotencyConflictError();
        }
        this.metrics.inc('duplicates_detected');
        return this.replayResult(domain, tem);
      }

      const walletEntity = await tem.findOne(
        WalletEntity,
        { id: input.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletEntity) {
        throw new BusinessRuleViolationError(
          FailureCodes.WALLET_NOT_FOUND,
          'wallet not found',
        );
      }
      if (walletEntity.playerId !== input.playerId) {
        throw new BusinessRuleViolationError(
          FailureCodes.REFERENCE_SCOPE_MISMATCH,
          'playerId does not own wallet',
        );
      }

      let tx = WagerTransaction.create({
        id: newId(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      try {
        await tem.persistAndFlush(wagerToEntity(tx));
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          const again = await tem.findOneOrFail(WagerTransactionEntity, {
            idempotencyKey: input.idempotencyKey,
          });
          const domain = wagerFromEntity(again);
          if (!domain.matchesPayload(payloadHash)) {
            throw new IdempotencyConflictError();
          }
          return this.replayResult(domain, tem);
        }
        throw err;
      }

      const wallet = walletFromEntity(walletEntity);
      const result = await this.applyTransaction(
        tem,
        walletEntity,
        wallet,
        tx,
        correlationId,
        input.causationId,
      );

      if (input.inbox) {
        const inboxRow = await tem.findOneOrFail(InboxMessageEntity, {
          consumerName: input.inbox.consumerName,
          messageId: input.inbox.messageId,
        });
        inboxRow.processedAt = new Date();
      }

      await tem.flush();
      this.metrics.inc(`tx_status_${result.status.toLowerCase()}`);
      return result;
    });
  }

  /** Reprocess a PENDING_REFERENCE transaction (scheduled worker). */
  async reprocessPendingReference(transactionId: string): Promise<ProcessWagerResult> {
    const correlationId = newId();
    return this.em.transactional(async (tem) => {
      const entity = await tem.findOne(
        WagerTransactionEntity,
        { id: transactionId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!entity || entity.status !== WagerTransactionStatus.PendingReference) {
        return {
          transactionId,
          status: (entity?.status as WagerTransactionStatus) ?? WagerTransactionStatus.Failed,
          idempotentReplay: true,
        };
      }
      let tx = wagerFromEntity(entity);
      const walletEntity = await tem.findOne(
        WalletEntity,
        { id: tx.walletId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!walletEntity) {
        tx.reject(FailureCodes.WALLET_NOT_FOUND);
        applyWagerToEntity(tx, entity);
        this.enqueueRejected(tem, tx, correlationId);
        await tem.flush();
        return {
          transactionId: tx.id,
          status: tx.status,
          failureCode: tx.failureCode,
          idempotentReplay: false,
        };
      }
      const wallet = walletFromEntity(walletEntity);
      const result = await this.applyTransaction(
        tem,
        walletEntity,
        wallet,
        tx,
        correlationId,
      );
      applyWagerToEntity(tx, entity);
      await tem.flush();
      return result;
    });
  }

  private async applyTransaction(
    tem: EntityManager,
    walletEntity: WalletEntity,
    wallet: ReturnType<typeof walletFromEntity>,
    tx: WagerTransaction,
    correlationId: string,
    causationId?: string,
  ): Promise<ProcessWagerResult> {
    const now = new Date();
    const txEntity = await tem.findOneOrFail(WagerTransactionEntity, { id: tx.id });

    let reference: WagerTransaction | undefined;
    if (tx.requiresReference() || tx.kind === WagerTransactionKind.Win) {
      if (tx.referenceExternalTransactionId) {
        const refEntity = await tem.findOne(WagerTransactionEntity, {
          providerId: tx.providerId,
          externalTransactionId: tx.referenceExternalTransactionId,
        });
        if (!refEntity) {
          if (tx.requiresReference()) {
            return this.parkPendingReference(tem, txEntity, tx, correlationId, causationId, now);
          }
        } else {
          reference = wagerFromEntity(refEntity);
          const scopeError = this.validateReferenceScope(tx, reference);
          if (scopeError) {
            return this.reject(tem, txEntity, tx, scopeError, correlationId, causationId, wallet);
          }
          if (reference.status !== WagerTransactionStatus.Processed) {
            if (tx.requiresReference()) {
              return this.parkPendingReference(tem, txEntity, tx, correlationId, causationId, now);
            }
          }
          const kindError = this.validateReferenceKind(tx, reference);
          if (kindError) {
            return this.reject(tem, txEntity, tx, kindError, correlationId, causationId, wallet);
          }
          if (!tx.money.equals(reference.money) && tx.requiresReference()) {
            return this.reject(
              tem,
              txEntity,
              tx,
              FailureCodes.REFERENCE_AMOUNT_MISMATCH,
              correlationId,
              causationId,
              wallet,
            );
          }
        }
      } else if (tx.requiresReference()) {
        return this.reject(
          tem,
          txEntity,
          tx,
          FailureCodes.INVALID_REFERENCE,
          correlationId,
          causationId,
          wallet,
        );
      }
    }

    try {
      if (wallet.currency !== tx.money.currency) {
        return this.reject(
          tem,
          txEntity,
          tx,
          FailureCodes.WALLET_CURRENCY_MISMATCH,
          correlationId,
          causationId,
          wallet,
        );
      }

      const direction = tx.ledgerDirectionFor(reference);
      let balanceProps = wallet.balance.toJSON();

      if (direction === LedgerDirection.Debit) {
        const { entry } = wallet.debit({
          entryId: newId(),
          transactionId: tx.id,
          money: tx.money,
          at: now,
        });
        applyWalletToEntity(wallet, walletEntity);
        tem.persist(ledgerToEntity(entry));
        this.enqueueOutbox(
          tem,
          WalletBalanceChanged.from(wallet, entry, {
            eventId: newId(),
            correlationId,
            causationId,
            occurredAt: now,
          }),
        );
        balanceProps = wallet.balance.toJSON();
      } else if (direction === LedgerDirection.Credit) {
        if (tx.money.isZero()) {
          // zero credit: process without ledger (edge)
        } else {
          const { entry } = wallet.credit({
            entryId: newId(),
            transactionId: tx.id,
            money: tx.money,
            at: now,
          });
          applyWalletToEntity(wallet, walletEntity);
          tem.persist(ledgerToEntity(entry));
          this.enqueueOutbox(
            tem,
            WalletBalanceChanged.from(wallet, entry, {
              eventId: newId(),
              correlationId,
              causationId,
              occurredAt: now,
            }),
          );
          balanceProps = wallet.balance.toJSON();
        }
      }

      tx.markProcessed(reference?.id, now);
      applyWagerToEntity(tx, txEntity);
      this.enqueueOutbox(
        tem,
        WagerTransactionProcessed.from(tx, balanceProps, {
          eventId: newId(),
          correlationId,
          causationId,
          occurredAt: now,
        }),
      );

      return {
        transactionId: tx.id,
        status: tx.status,
        balance: balanceProps,
        balanceAtProcessing: balanceProps,
        idempotentReplay: false,
      };
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return this.reject(
          tem,
          txEntity,
          tx,
          FailureCodes.INSUFFICIENT_BALANCE,
          correlationId,
          causationId,
          wallet,
        );
      }
      if (err instanceof BusinessRuleViolationError) {
        return this.reject(
          tem,
          txEntity,
          tx,
          err.failureCode,
          correlationId,
          causationId,
          wallet,
        );
      }
      throw err;
    }
  }

  private async parkPendingReference(
    tem: EntityManager,
    txEntity: WagerTransactionEntity,
    tx: WagerTransaction,
    correlationId: string,
    causationId: string | undefined,
    now: Date,
  ): Promise<ProcessWagerResult> {
    const attempts = tx.pendingReferenceAttempts + 1;
    if (attempts > PENDING_REFERENCE_MAX_ATTEMPTS) {
      return this.reject(
        tem,
        txEntity,
        tx,
        FailureCodes.REFERENCE_NOT_FOUND,
        correlationId,
        causationId,
        undefined,
      );
    }
    const backoff = Math.min(2 ** Math.min(attempts, 8), 300);
    tx.markPendingReference(now, backoff);
    applyWagerToEntity(tx, txEntity);
    this.enqueueOutbox(
      tem,
      WagerTransactionPendingReference.from(tx, {
        eventId: newId(),
        correlationId,
        causationId,
        occurredAt: now,
      }),
    );
    this.metrics.inc('pending_reference');
    return {
      transactionId: tx.id,
      status: tx.status,
      idempotentReplay: false,
    };
  }

  private reject(
    tem: EntityManager,
    txEntity: WagerTransactionEntity,
    tx: WagerTransaction,
    code: FailureCode,
    correlationId: string,
    causationId: string | undefined,
    wallet: ReturnType<typeof walletFromEntity> | undefined,
  ): ProcessWagerResult {
    tx.reject(code);
    applyWagerToEntity(tx, txEntity);
    this.enqueueRejected(tem, tx, correlationId, causationId);
    this.metrics.inc('tx_rejected');
    return {
      transactionId: tx.id,
      status: tx.status,
      balance: wallet?.balance.toJSON(),
      failureCode: code,
      idempotentReplay: false,
    };
  }

  private enqueueRejected(
    tem: EntityManager,
    tx: WagerTransaction,
    correlationId: string,
    causationId?: string,
  ): void {
    this.enqueueOutbox(
      tem,
      WagerTransactionRejected.from(tx, {
        eventId: newId(),
        correlationId,
        causationId,
        occurredAt: new Date(),
      }),
    );
  }

  private enqueueOutbox(
    tem: EntityManager,
    event: { toJSON: () => Record<string, unknown> } & {
      eventId: string;
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
    },
  ): void {
    const msg = OutboxMessage.enqueue(event as never);
    tem.persist(outboxToEntity(msg));
  }

  private validateReferenceScope(
    tx: WagerTransaction,
    ref: WagerTransaction,
  ): FailureCode | null {
    if (
      ref.providerId !== tx.providerId ||
      ref.playerId !== tx.playerId ||
      ref.walletId !== tx.walletId ||
      ref.roundId !== tx.roundId ||
      ref.money.currency !== tx.money.currency
    ) {
      return FailureCodes.REFERENCE_SCOPE_MISMATCH;
    }
    return null;
  }

  private validateReferenceKind(
    tx: WagerTransaction,
    ref: WagerTransaction,
  ): FailureCode | null {
    if (tx.kind === WagerTransactionKind.Refund) {
      if (ref.kind !== WagerTransactionKind.Bet) {
        return FailureCodes.REFERENCE_KIND_INVALID;
      }
    }
    if (tx.kind === WagerTransactionKind.Rollback) {
      if (
        ref.kind !== WagerTransactionKind.Bet &&
        ref.kind !== WagerTransactionKind.Win &&
        ref.kind !== WagerTransactionKind.Refund
      ) {
        return FailureCodes.REFERENCE_KIND_INVALID;
      }
    }
    if (tx.kind === WagerTransactionKind.Win && ref.kind !== WagerTransactionKind.Bet) {
      return FailureCodes.REFERENCE_KIND_INVALID;
    }
    return null;
  }

  private async tryClaimInbox(
    tem: EntityManager,
    inbox: { messageId: string; consumerName: string },
    payloadHash: string,
  ): Promise<boolean> {
    const msg = InboxMessage.receive({
      messageId: inbox.messageId,
      consumerName: inbox.consumerName,
      payloadHash,
    });
    try {
      await tem.persistAndFlush(inboxToEntity(msg));
      return true;
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        return false;
      }
      throw err;
    }
  }

  private async replayResult(
    tx: WagerTransaction,
    tem: EntityManager,
  ): Promise<ProcessWagerResult> {
    let balanceAtProcessing: MoneyProps | undefined;
    if (tx.status === WagerTransactionStatus.Processed && tx.affectsBalance()) {
      const entry = await tem.findOne(WalletLedgerEntryEntity, {
        transactionId: tx.id,
      });
      if (entry) {
        balanceAtProcessing = {
          amount: entry.balanceAfter,
          currency: entry.currency,
        };
      }
    }
    const wallet = await tem.findOne(WalletEntity, { id: tx.walletId });
    return {
      transactionId: tx.id,
      status: tx.status,
      balance: wallet
        ? { amount: wallet.balanceAmount, currency: wallet.currency }
        : undefined,
      balanceAtProcessing,
      idempotentReplay: true,
      failureCode: tx.failureCode,
    };
  }
}
