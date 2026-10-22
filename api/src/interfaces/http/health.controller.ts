import { Controller, Get } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SqsService } from '../../infrastructure/messaging/sqs.service';
import { MetricsService } from '../../infrastructure/observability/metrics.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    let postgres = false;
    let sqs = false;
    try {
      await this.em.getConnection().execute('select 1');
      postgres = true;
    } catch {
      postgres = false;
    }
    try {
      sqs = await this.sqs.isReachable();
    } catch {
      sqs = false;
    }
    const ready = postgres && sqs;
    return {
      status: ready ? 'ready' : 'not_ready',
      checks: { postgres, sqs },
      metrics: this.metrics.snapshot(),
    };
  }
}
