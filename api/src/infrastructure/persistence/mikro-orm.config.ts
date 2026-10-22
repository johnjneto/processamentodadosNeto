import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletEntity } from './entities/wallet.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';

const config = defineConfig({
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  clientUrl:
    process.env.DATABASE_URL ??
    'postgresql://wager:wager@localhost:5432/wagering',
  migrations: {
    path: 'src/infrastructure/persistence/migrations',
    glob: 'Migration*.ts',
    transactional: true,
    allOrNothing: true,
  },
  extensions: [Migrator],
  allowGlobalContext: false,
});

export default config;
