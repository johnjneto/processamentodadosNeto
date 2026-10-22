import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProcessWagerTransactionUseCase,
} from '../../application/use-cases/process-wager-transaction.use-case';
import { SqsService } from '../../infrastructure/messaging/sqs.service';
import { MetricsService } from '../../infrastructure/observability/metrics.service';
import {
  BusinessRuleViolationError,
  IdempotencyConflictError,
  WagerTransactionKind,
} from '../../domain';

const CONSUMER_NAME = 'wager-transactions-consumer';

@Injectable()
export class SqsConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerWorker.name);
  private running = false;
  private loopPromise?: Promise<void>;
  private inFlight = 0;

  constructor(
    private readonly sqs: SqsService,
    private readonly processWager: ProcessWagerTransactionUseCase,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('SQS_CONSUMER_ENABLED', 'true') !== 'true') return;
    try {
      await this.sqs.ensureQueues();
    } catch (err) {
      this.logger.warn(`SQS init deferred: ${(err as Error).message}`);
    }
    this.running = true;
    this.loopPromise = this.loop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    const deadline = Date.now() + 25_000;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (this.running && !this.sqs.isShuttingDown()) {
      try {
        const messages = await this.sqs.receive(5, 5);
        for (const msg of messages) {
          if (!this.running) {
            await this.sqs.release(msg.receiptHandle, 0);
            continue;
          }
          this.inFlight += 1;
          try {
            await this.handle(msg.messageId, msg.body);
            await this.sqs.ack(msg.receiptHandle);
          } catch (err) {
            await this.onError(msg.receiptHandle, err);
          } finally {
            this.inFlight -= 1;
          }
        }
      } catch (err) {
        this.logger.error(`poll error: ${(err as Error).message}`);
        this.metrics.inc('sqs_poll_errors');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(sqsMessageId: string, body: string): Promise<void> {
    const started = Date.now();
    const parsed = JSON.parse(body) as {
      messageId?: string;
      type?: string;
      data: {
        providerId: string;
        externalTransactionId: string;
        idempotencyKey: string;
        playerId: string;
        walletId: string;
        roundId: string;
        gameId: string;
        kind: WagerTransactionKind;
        money: { amount: string; currency: string };
        referenceExternalTransactionId?: string;
      };
    };
    const messageId = parsed.messageId ?? sqsMessageId;
    const data = parsed.data;

    this.logger.log(
      JSON.stringify({
        msg: 'sqs_message_received',
        messageId,
        walletId: data.walletId,
        providerId: data.providerId,
        correlationId: messageId,
      }),
    );

    await this.processWager.execute({
      ...data,
      inbox: { messageId, consumerName: CONSUMER_NAME },
      correlationId: messageId,
      causationId: messageId,
    });
    this.metrics.observeLatencyMs(Date.now() - started);
  }

  private async onError(receiptHandle: string, err: unknown): Promise<void> {
    if (
      err instanceof BusinessRuleViolationError ||
      err instanceof IdempotencyConflictError
    ) {
      // Terminal business outcome — ack to avoid infinite redelivery
      this.metrics.inc('sqs_business_terminal');
      await this.sqs.ack(receiptHandle);
      return;
    }
    // Transient — release visibility for retry / DLQ after maxReceiveCount
    this.metrics.inc('sqs_retries');
    this.logger.warn(`transient failure, retrying: ${(err as Error).message}`);
    await this.sqs.release(receiptHandle, 5);
  }
}
