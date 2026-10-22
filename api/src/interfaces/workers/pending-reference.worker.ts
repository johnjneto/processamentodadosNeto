import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';
import { WagerTransactionEntity } from '../../infrastructure/persistence/entities/wager-transaction.entity';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case';
import { WagerTransactionStatus } from '../../domain';

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private busy = false;

  constructor(
    private readonly em: EntityManager,
    private readonly processWager: ProcessWagerTransactionUseCase,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    if (this.config.get('PENDING_REF_WORKER_ENABLED', 'true') !== 'true') return;
    if (this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      const due = await this.em.find(
        WagerTransactionEntity,
        {
          status: WagerTransactionStatus.PendingReference,
          pendingReferenceNextAt: { $lte: now },
        },
        { limit: 20, orderBy: { pendingReferenceNextAt: 'asc' } },
      );
      for (const row of due) {
        try {
          await this.processWager.reprocessPendingReference(row.id);
        } catch (err) {
          this.logger.warn(
            `pending-ref reprocess failed ${row.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
