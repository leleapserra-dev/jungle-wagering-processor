import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand
} from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../../../config/app-config';

@Injectable()
export class SqsClientService {
  readonly client: SQSClient;

  constructor(@Inject(AppConfig) private readonly config: AppConfig) {
    const credentials =
      this.config.awsAccessKeyId && this.config.awsSecretAccessKey
        ? { accessKeyId: this.config.awsAccessKeyId, secretAccessKey: this.config.awsSecretAccessKey }
        : undefined;
    const opts: Record<string, unknown> = { region: this.config.awsRegion };
    if (this.config.sqsEndpoint !== undefined) opts.endpoint = this.config.sqsEndpoint;
    if (credentials !== undefined) opts.credentials = credentials;
    this.client = new SQSClient(opts as never);
  }

  async sendMessage(
    queueUrl: string,
    body: string,
    messageGroupId?: string,
    messageDeduplicationId?: string
  ): Promise<string | undefined> {
    const res = await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: messageGroupId,
        MessageDeduplicationId: messageDeduplicationId
      })
    );
    return res.MessageId;
  }

  async receiveMessages(queueUrl: string, maxMessages: number, visibilityTimeout: number, waitTimeSeconds = 20) {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ['All']
      })
    );
    return res.Messages ?? [];
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }

  async changeVisibility(queueUrl: string, receiptHandle: string, visibilityTimeout: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout
      })
    );
  }
}
