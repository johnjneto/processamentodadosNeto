import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager, LockMode } from '@mikro-orm/core';
import { OutboxMessageEntity } from '../../infrastructure/persistence/entities/outbox-message.entity';
import { outboxFromEntity } from '../../infrastructure/persistence/mappers/domain.mappers';
import { SqsService } from '../../infrastructure/messaging/sqs.service';
import { MetricsService } from '../../infrastructure/observability/metrics.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private busy = false;

  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async tick(): Promise<void> {
    if (this.config.get('OUTBOX_WORKER_ENABLED', 'true') !== 'true') return;
    if (this.busy) return;
    this.busy = true;
    try {
      await this.publishBatch();
    } catch (err) {
      this.logger.error(`outbox tick failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  async publishBatch(limit = 20): Promise<number> {
    const now = new Date();
    return this.em.fork().transactional(async (tem) => {
      // SKIP LOCKED via native query for multi-publisher safety
      const rows = await tem.getConnection().execute<
        Array<{ id: string }>
      >(
        `SELECT id FROM outbox_messages
         WHERE published_at IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY occurred_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT ?`,
        [now, limit],
      );

      this.metrics.setGauge('outbox_lag_batch', rows.length);
      let published = 0;

      for (const row of rows) {
        const entity = await tem.findOne(
          OutboxMessageEntity,
          { id: row.id },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (!entity || entity.publishedAt) continue;

        const domain = outboxFromEntity(entity);
        try {
          await this.sqs.publishIntegrationEvent(domain.payload);
          domain.markPublished(new Date());
          entity.publishedAt = domain.publishedAt;
          published += 1;
          this.metrics.inc('outbox_published');
        } catch (err) {
          domain.scheduleRetry(new Date());
          entity.attempts = domain.attempts;
          entity.nextAttemptAt = domain.nextAttemptAt;
          this.metrics.inc('outbox_retries');
          this.logger.warn(
            `outbox publish failed id=${entity.id}: ${(err as Error).message}`,
          );
        }
      }
      await tem.flush();
      return published;
    });
  }
}
