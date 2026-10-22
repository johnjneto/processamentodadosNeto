import {
  InboxMessage,
  Money,
  OutboxMessage,
  Wallet,
  WalletLedgerEntry,
  LedgerDirection,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type FailureCode,
} from '../../../domain';
import { WalletEntity } from '../entities/wallet.entity';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export function walletToEntity(w: Wallet): WalletEntity {
  const e = new WalletEntity();
  const s = w.toState();
  e.id = s.id;
  e.playerId = s.playerId;
  e.currency = s.currency;
  e.balanceAmount = s.balance.amount;
  e.version = s.version;
  e.createdAt = s.createdAt;
  e.updatedAt = s.updatedAt;
  return e;
}

export function walletFromEntity(e: WalletEntity): Wallet {
  return Wallet.rehydrate({
    id: e.id,
    playerId: e.playerId,
    currency: e.currency,
    balance: { amount: e.balanceAmount, currency: e.currency },
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  });
}

export function applyWalletToEntity(w: Wallet, e: WalletEntity): void {
  const s = w.toState();
  e.balanceAmount = s.balance.amount;
  e.version = s.version;
  e.updatedAt = s.updatedAt;
}

export function wagerToEntity(tx: WagerTransaction): WagerTransactionEntity {
  const s = tx.toState();
  const e = new WagerTransactionEntity();
  e.id = s.id;
  e.providerId = s.providerId;
  e.externalTransactionId = s.externalTransactionId;
  e.idempotencyKey = s.idempotencyKey;
  e.payloadHash = s.payloadHash;
  e.walletId = s.walletId;
  e.playerId = s.playerId;
  e.roundId = s.roundId;
  e.gameId = s.gameId;
  e.kind = s.kind;
  e.amount = s.money.amount;
  e.currency = s.money.currency;
  e.referenceExternalTransactionId = s.referenceExternalTransactionId;
  e.status = s.status;
  e.referenceTransactionId = s.referenceTransactionId;
  e.failureCode = s.failureCode;
  e.createdAt = s.createdAt;
  e.processedAt = s.processedAt;
  e.pendingReferenceAttempts = s.pendingReferenceAttempts;
  e.pendingReferenceNextAt = s.pendingReferenceNextAt;
  return e;
}

export function applyWagerToEntity(
  tx: WagerTransaction,
  e: WagerTransactionEntity,
): void {
  const s = tx.toState();
  e.status = s.status;
  e.referenceTransactionId = s.referenceTransactionId;
  e.failureCode = s.failureCode;
  e.processedAt = s.processedAt;
  e.pendingReferenceAttempts = s.pendingReferenceAttempts;
  e.pendingReferenceNextAt = s.pendingReferenceNextAt;
}

export function wagerFromEntity(e: WagerTransactionEntity): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: e.id,
    providerId: e.providerId,
    externalTransactionId: e.externalTransactionId,
    idempotencyKey: e.idempotencyKey,
    payloadHash: e.payloadHash,
    walletId: e.walletId,
    playerId: e.playerId,
    roundId: e.roundId,
    gameId: e.gameId,
    kind: e.kind as WagerTransactionKind,
    money: { amount: e.amount, currency: e.currency },
    referenceExternalTransactionId: e.referenceExternalTransactionId,
    createdAt: e.createdAt,
    status: e.status as WagerTransactionStatus,
    referenceTransactionId: e.referenceTransactionId,
    failureCode: e.failureCode as FailureCode | undefined,
    processedAt: e.processedAt,
    pendingReferenceAttempts: e.pendingReferenceAttempts,
    pendingReferenceNextAt: e.pendingReferenceNextAt,
  });
}

export function ledgerToEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
  const e = new WalletLedgerEntryEntity();
  e.id = entry.id;
  e.walletId = entry.walletId;
  e.transactionId = entry.transactionId;
  e.direction = entry.direction;
  e.amount = entry.money.toDecimalString();
  e.currency = entry.money.currency;
  e.balanceBefore = entry.balanceBefore.toDecimalString();
  e.balanceAfter = entry.balanceAfter.toDecimalString();
  e.createdAt = entry.createdAt;
  return e;
}

export function ledgerFromEntity(e: WalletLedgerEntryEntity): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: e.id,
    walletId: e.walletId,
    transactionId: e.transactionId,
    direction: e.direction as LedgerDirection,
    money: { amount: e.amount, currency: e.currency },
    balanceBefore: { amount: e.balanceBefore, currency: e.currency },
    balanceAfter: { amount: e.balanceAfter, currency: e.currency },
    createdAt: e.createdAt,
  });
}

export function inboxToEntity(m: InboxMessage): InboxMessageEntity {
  const s = m.toState();
  const e = new InboxMessageEntity();
  e.consumerName = s.consumerName;
  e.messageId = s.messageId;
  e.payloadHash = s.payloadHash;
  e.receivedAt = s.receivedAt;
  e.processedAt = s.processedAt;
  return e;
}

export function outboxToEntity(m: OutboxMessage): OutboxMessageEntity {
  const s = m.toState();
  const e = new OutboxMessageEntity();
  e.id = s.id;
  e.aggregateId = s.aggregateId;
  e.eventType = s.eventType;
  e.payload = { ...s.payload };
  e.occurredAt = s.occurredAt;
  e.attempts = s.attempts;
  e.nextAttemptAt = s.nextAttemptAt;
  e.publishedAt = s.publishedAt;
  return e;
}

export function outboxFromEntity(e: OutboxMessageEntity): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: e.id,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    payload: e.payload,
    occurredAt: e.occurredAt,
    attempts: e.attempts,
    nextAttemptAt: e.nextAttemptAt,
    publishedAt: e.publishedAt,
  });
}

// silence unused Money import if tree-shaken oddly
void Money;
