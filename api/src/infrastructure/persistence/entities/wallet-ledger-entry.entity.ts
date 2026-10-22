import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({ properties: ['transactionId'], name: 'uq_ledger_transaction' })
@Index({ properties: ['walletId', 'createdAt', 'id'], name: 'idx_ledger_wallet_cursor' })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Property({ fieldName: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Property({ length: 16 })
  direction!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ fieldName: 'balance_before', type: 'decimal', precision: 20, scale: 2 })
  balanceBefore!: string;

  @Property({ fieldName: 'balance_after', type: 'decimal', precision: 20, scale: 2 })
  balanceAfter!: string;

  @Property({ fieldName: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
