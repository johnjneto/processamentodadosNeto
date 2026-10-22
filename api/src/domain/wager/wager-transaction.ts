import { Money, type MoneyProps } from '../money/money';
import type { FailureCode } from '../failure-codes';
import {
  BusinessRuleViolationError,
  InvalidTransactionStateError,
} from '../errors/domain-errors';
import { LedgerDirection } from '../ledger/wallet-ledger-entry';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  pendingReferenceAttempts: number;
  pendingReferenceNextAt?: Date;
}

const TERMINAL: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _pendingReferenceAttempts: number = 0,
    private _pendingReferenceNextAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      // allowed only via internal factory path — external callers must use createOpening
    }
    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !props.referenceExternalTransactionId
    ) {
      throw new BusinessRuleViolationError(
        'INVALID_REFERENCE',
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }
    if (
      props.kind !== WagerTransactionKind.Refund &&
      props.kind !== WagerTransactionKind.Rollback &&
      props.referenceExternalTransactionId
    ) {
      // WIN may optionally reference a BET — allowed; BET/LOSS should not carry refs
      if (
        props.kind === WagerTransactionKind.Bet ||
        props.kind === WagerTransactionKind.Loss ||
        props.kind === WagerTransactionKind.Opening
      ) {
        throw new BusinessRuleViolationError(
          'INVALID_REFERENCE',
          `${props.kind} must not carry a reference`,
        );
      }
    }
    if (props.money.isNegative()) {
      throw new BusinessRuleViolationError(
        'INVALID_MONEY',
        'transaction money cannot be negative',
      );
    }
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  /** Internal OPENING credit — never via public API/queue. */
  static createOpening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    createdAt?: Date;
  }): WagerTransaction {
    return new WagerTransaction(
      props.id,
      'system',
      `opening:${props.walletId}`,
      `system:opening:${props.walletId}`,
      'opening',
      props.walletId,
      props.playerId,
      `opening:${props.walletId}`,
      'system',
      WagerTransactionKind.Opening,
      props.money,
      undefined,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.pendingReferenceAttempts,
      state.pendingReferenceNextAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get pendingReferenceAttempts(): number {
    return this._pendingReferenceAttempts;
  }

  get pendingReferenceNextAt(): Date | undefined {
    return this._pendingReferenceNextAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._failureCode = undefined;
  }

  markPendingReference(now: Date, backoffSeconds: number): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
    this._pendingReferenceAttempts += 1;
    this._pendingReferenceNextAt = new Date(
      now.getTime() + backoffSeconds * 1000,
    );
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  isTerminal(): boolean {
    return TERMINAL.has(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Direction to apply for this transaction relative to an optional reference.
   * LOSS → undefined (no ledger). ROLLBACK inverts the reference direction.
   */
  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): LedgerDirection | undefined {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        return undefined;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new BusinessRuleViolationError(
            'INVALID_REFERENCE',
            'rollback requires a resolved reference',
          );
        }
        const refDir = reference.ledgerDirectionFor();
        if (!refDir) {
          throw new BusinessRuleViolationError(
            'REFERENCE_KIND_INVALID',
            'cannot rollback a non-balance transaction',
          );
        }
        return refDir === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
      default:
        return undefined;
    }
  }

  toState(): WagerTransactionState {
    return {
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      money: this.money.toJSON(),
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      createdAt: this.createdAt,
      status: this._status,
      referenceTransactionId: this._referenceTransactionId,
      failureCode: this._failureCode,
      processedAt: this._processedAt,
      pendingReferenceAttempts: this._pendingReferenceAttempts,
      pendingReferenceNextAt: this._pendingReferenceNextAt,
    };
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `cannot transition from terminal status ${this._status}`,
      );
    }
  }
}
