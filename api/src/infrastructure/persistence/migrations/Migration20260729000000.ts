import { Migration } from '@mikro-orm/migrations';

export class Migration20260729000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency CHAR(3) NOT NULL,
        balance_amount NUMERIC(20,2) NOT NULL,
        version INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT chk_wallets_balance_non_negative CHECK (balance_amount >= 0),
        CONSTRAINT chk_wallets_version_positive CHECK (version >= 1),
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency)
      );
    `);

    this.addSql(`
      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(128) NOT NULL,
        external_transaction_id VARCHAR(256) NOT NULL,
        idempotency_key VARCHAR(512) NOT NULL,
        payload_hash VARCHAR(128) NOT NULL,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        player_id UUID NOT NULL,
        round_id VARCHAR(256) NOT NULL,
        game_id VARCHAR(256) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        amount NUMERIC(20,2) NOT NULL,
        currency CHAR(3) NOT NULL,
        reference_external_transaction_id VARCHAR(256) NULL,
        status VARCHAR(32) NOT NULL,
        reference_transaction_id UUID NULL,
        failure_code VARCHAR(64) NULL,
        created_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ NULL,
        pending_reference_attempts INTEGER NOT NULL DEFAULT 0,
        pending_reference_next_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_wager_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT chk_wager_kind CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT chk_wager_status CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT uq_wager_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wager_provider_external UNIQUE (provider_id, external_transaction_id)
      );
    `);

    this.addSql(`
      CREATE UNIQUE INDEX uq_wager_refund_once
        ON wager_transactions (provider_id, reference_external_transaction_id)
        WHERE kind = 'REFUND'
          AND status IN ('PROCESSED','PENDING','PENDING_REFERENCE');
    `);

    this.addSql(`
      CREATE UNIQUE INDEX uq_wager_rollback_once
        ON wager_transactions (provider_id, reference_external_transaction_id)
        WHERE kind = 'ROLLBACK'
          AND status IN ('PROCESSED','PENDING','PENDING_REFERENCE');
    `);

    this.addSql(`
      CREATE INDEX idx_wager_pending_reference
        ON wager_transactions (status, pending_reference_next_at)
        WHERE status = 'PENDING_REFERENCE';
    `);

    this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
        direction VARCHAR(16) NOT NULL,
        amount NUMERIC(20,2) NOT NULL,
        currency CHAR(3) NOT NULL,
        balance_before NUMERIC(20,2) NOT NULL,
        balance_after NUMERIC(20,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT chk_ledger_direction CHECK (direction IN ('DEBIT','CREDIT')),
        CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0),
        CONSTRAINT chk_ledger_balances_non_negative CHECK (balance_before >= 0 AND balance_after >= 0),
        CONSTRAINT chk_ledger_arithmetic CHECK (
          (direction = 'CREDIT' AND balance_after = balance_before + amount)
          OR (direction = 'DEBIT' AND balance_after = balance_before - amount)
        ),
        CONSTRAINT uq_ledger_transaction UNIQUE (transaction_id)
      );
    `);

    this.addSql(`
      CREATE INDEX idx_ledger_wallet_cursor
        ON wallet_ledger_entries (wallet_id, created_at, id);
    `);

    this.addSql(`
      CREATE TABLE inbox_messages (
        consumer_name VARCHAR(128) NOT NULL,
        message_id VARCHAR(256) NOT NULL,
        payload_hash VARCHAR(128) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ NULL,
        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    this.addSql(`
      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id VARCHAR(128) NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NULL,
        published_at TIMESTAMPTZ NULL
      );
    `);

    this.addSql(`
      CREATE INDEX idx_outbox_pending
        ON outbox_messages (next_attempt_at)
        WHERE published_at IS NULL;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS outbox_messages CASCADE;');
    this.addSql('DROP TABLE IF EXISTS inbox_messages CASCADE;');
    this.addSql('DROP TABLE IF EXISTS wallet_ledger_entries CASCADE;');
    this.addSql('DROP TABLE IF EXISTS wager_transactions CASCADE;');
    this.addSql('DROP TABLE IF EXISTS wallets CASCADE;');
  }
}
