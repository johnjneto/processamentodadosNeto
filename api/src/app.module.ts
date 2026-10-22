import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { LoggerModule } from 'nestjs-pino';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

import { WalletEntity } from './infrastructure/persistence/entities/wallet.entity';
import { WagerTransactionEntity } from './infrastructure/persistence/entities/wager-transaction.entity';
import { WalletLedgerEntryEntity } from './infrastructure/persistence/entities/wallet-ledger-entry.entity';
import { InboxMessageEntity } from './infrastructure/persistence/entities/inbox-message.entity';
import { OutboxMessageEntity } from './infrastructure/persistence/entities/outbox-message.entity';

import { MetricsService } from './infrastructure/observability/metrics.service';
import { SqsService } from './infrastructure/messaging/sqs.service';
import {
  IdentityPort,
  NoopIdentityPort,
} from './infrastructure/auth/identity.port';
import { NoopAuthGuard } from './infrastructure/auth/noop-auth.guard';

import { CreateWalletUseCase } from './application/use-cases/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from './application/use-cases/process-wager-transaction.use-case';
import {
  GetLedgerUseCase,
  GetTransactionUseCase,
  GetWalletUseCase,
  ReconcileWalletUseCase,
} from './application/use-cases/query.use-cases';

import { WalletsController } from './interfaces/http/wallets.controller';
import { WageringController } from './interfaces/http/wagering.controller';
import { HealthController } from './interfaces/http/health.controller';
import { ApiExceptionFilter } from './interfaces/http/http-exception.filter';
import { SqsConsumerWorker } from './interfaces/workers/sqs-consumer.worker';
import { OutboxWorker } from './interfaces/workers/outbox.worker';
import { PendingReferenceWorker } from './interfaces/workers/pending-reference.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'money',
            'initialBalance',
            'balance',
            'req.body.money',
          ],
          remove: true,
        },
      },
    }),
    MikroOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        defineConfig({
          clientUrl:
            config.get('DATABASE_URL') ??
            'postgresql://wager:wager@localhost:5432/wagering',
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
        }),
    }),
  ],
  controllers: [WalletsController, WageringController, HealthController],
  providers: [
    MetricsService,
    SqsService,
    CreateWalletUseCase,
    ProcessWagerTransactionUseCase,
    GetWalletUseCase,
    GetLedgerUseCase,
    GetTransactionUseCase,
    ReconcileWalletUseCase,
    SqsConsumerWorker,
    OutboxWorker,
    PendingReferenceWorker,
    NoopAuthGuard,
    { provide: IdentityPort, useClass: NoopIdentityPort },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: NoopAuthGuard },
  ],
})
export class AppModule {}
