import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueUrlCommand,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics.service';

export interface SqsEnvelope {
  messageId: string;
  receiptHandle: string;
  body: string;
}

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly logger = new Logger(SqsService.name);
  private readonly client: SQSClient;
  private queueUrl?: string;
  private dlqUrl?: string;
  private shuttingDown = false;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.client = new SQSClient({
      region: this.config.get('AWS_REGION', 'us-east-1'),
      endpoint: this.config.get('AWS_ENDPOINT_URL', 'http://localhost:4566'),
      credentials: {
        accessKeyId: this.config.get('AWS_ACCESS_KEY_ID', 'test'),
        secretAccessKey: this.config.get('AWS_SECRET_ACCESS_KEY', 'test'),
      },
    });
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async ensureQueues(): Promise<void> {
    const main = this.config.get('SQS_QUEUE_NAME', 'wager-transactions.fifo');
    const dlq = this.config.get('SQS_DLQ_NAME', 'wager-transactions-dlq.fifo');
    this.dlqUrl = await this.ensureFifoQueue(dlq);
    const dlqArn = await this.getQueueArn(this.dlqUrl);
    this.queueUrl = await this.ensureFifoQueue(main, {
      FifoQueue: 'true',
      ContentBasedDeduplication: 'false',
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: this.config.get('SQS_MAX_RECEIVE_COUNT', '5'),
      }),
    });
    this.logger.log(`SQS ready main=${this.queueUrl} dlq=${this.dlqUrl}`);
  }

  async receive(max = 5, waitSeconds = 10): Promise<SqsEnvelope[]> {
    if (!this.queueUrl || this.shuttingDown) return [];
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: max,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: 30,
        MessageAttributeNames: ['All'],
      }),
    );
    return (res.Messages ?? [])
      .filter((m) => m.Body && m.ReceiptHandle && m.MessageId)
      .map((m) => ({
        messageId: m.MessageId!,
        receiptHandle: m.ReceiptHandle!,
        body: m.Body!,
      }));
  }

  async ack(receiptHandle: string): Promise<void> {
    if (!this.queueUrl) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async release(receiptHandle: string, visibilityTimeout = 0): Promise<void> {
    if (!this.queueUrl) return;
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  async publishMain(body: unknown, groupId: string, dedupeId: string): Promise<void> {
    if (!this.queueUrl) await this.ensureQueues();
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl!,
        MessageBody: JSON.stringify(body),
        MessageGroupId: groupId,
        MessageDeduplicationId: dedupeId,
      }),
    );
  }

  async publishIntegrationEvent(body: unknown): Promise<void> {
    // Integration events go to a dedicated fan-out queue when configured;
    // for local demo we log + count (outbox marks published after successful send).
    const eventsQueue = this.config.get<string>('SQS_EVENTS_QUEUE_URL');
    if (!eventsQueue) {
      this.metrics.inc('outbox_published_noop');
      return;
    }
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: eventsQueue,
        MessageBody: JSON.stringify(body),
      }),
    );
    this.metrics.inc('outbox_published');
  }

  async isReachable(): Promise<boolean> {
    try {
      if (!this.queueUrl) await this.ensureQueues();
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl: this.queueUrl!,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private async ensureFifoQueue(
    name: string,
    attributes?: Record<string, string>,
  ): Promise<string> {
    try {
      const url = await this.client.send(
        new GetQueueUrlCommand({ QueueName: name }),
      );
      return url.QueueUrl!;
    } catch {
      const created = await this.client.send(
        new CreateQueueCommand({
          QueueName: name,
          Attributes: {
            FifoQueue: 'true',
            ContentBasedDeduplication: 'false',
            ...attributes,
          },
        }),
      );
      return created.QueueUrl!;
    }
  }

  private async getQueueArn(url: string): Promise<string> {
    const attrs = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['QueueArn'],
      }),
    );
    return attrs.Attributes!.QueueArn!;
  }
}
