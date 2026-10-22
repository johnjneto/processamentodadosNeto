import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';

@Entity({ tableName: 'wager_transactions' })
@Unique({ properties: ['idempotencyKey'], name: 'uq_wager_idempotency_key' })
@Unique({
  properties: ['providerId', 'externalTransactionId'],
  name: 'uq_wager_provider_external',
})
@Index({
  properties: ['status', 'pendingReferenceNextAt'],
  name: 'idx_wager_pending_reference',
})
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ fieldName: 'provider_id', length: 128 })
  providerId!: string;

  @Property({ fieldName: 'external_transaction_id', length: 256 })
  externalTransactionId!: string;

  @Property({ fieldName: 'idempotency_key', length: 512 })
  idempotencyKey!: string;

  @Property({ fieldName: 'payload_hash', length: 128 })
  payloadHash!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Property({ fieldName: 'player_id', type: 'uuid' })
  playerId!: string;

  @Property({ fieldName: 'round_id', length: 256 })
  roundId!: string;

  @Property({ fieldName: 'game_id', length: 256 })
  gameId!: string;

  @Property({ length: 32 })
  kind!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({
    fieldName: 'reference_external_transaction_id',
    length: 256,
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({ length: 32 })
  status!: string;

  @Property({ fieldName: 'reference_transaction_id', type: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Property({ fieldName: 'failure_code', length: 64, nullable: true })
  failureCode?: string;

  @Property({ fieldName: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Property({ fieldName: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt?: Date;

  @Property({ fieldName: 'pending_reference_attempts', type: 'integer', default: 0 })
  pendingReferenceAttempts: number = 0;

  @Property({
    fieldName: 'pending_reference_next_at',
    type: 'timestamptz',
    nullable: true,
  })
  pendingReferenceNextAt?: Date;
}
