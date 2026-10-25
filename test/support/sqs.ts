import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient
} from '@aws-sdk/client-sqs';

const endpoint = 'http://localhost:4566';
const accountPath = '/000000000000/';

export const SOURCE_QUEUE = endpoint + accountPath + 'wager-transactions.fifo';
export const DLQ_QUEUE = endpoint + accountPath + 'wager-transactions-dlq.fifo';
export const EVENTS_QUEUE = endpoint + accountPath + 'wager-events.fifo';

export const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
});

export interface BrokerMessage {
  messageId: string | undefined;
  deduplicationId: string | undefined;
  body: string | undefined;
}

export async function queueDepth(queueUrl: string): Promise<number> {
  const result = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
    })
  );
  const visible = Number(result.Attributes?.ApproximateNumberOfMessages ?? '0');
  const inFlight = Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0');
  return visible + inFlight;
}

export async function purgeQueue(queueUrl: string): Promise<void> {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}

export async function purgeQueues(): Promise<void> {
  await purgeQueue(SOURCE_QUEUE);
  await purgeQueue(DLQ_QUEUE);
}

export async function sendEnvelope(body: unknown, groupId: string, dedupId: string): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: SOURCE_QUEUE,
      MessageBody: JSON.stringify(body),
      MessageGroupId: groupId,
      MessageDeduplicationId: dedupId
    })
  );
}

export async function drainQueue(queueUrl: string): Promise<BrokerMessage[]> {
  const messages: BrokerMessage[] = [];
  let emptyPolls = 0;
  while (emptyPolls < 2) {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 30,
        AttributeNames: ['All']
      })
    );
    const batch = result.Messages ?? [];
    if (batch.length === 0) {
      emptyPolls += 1;
      continue;
    }
    emptyPolls = 0;
    for (const message of batch) {
      messages.push({
        messageId: message.MessageId,
        deduplicationId: message.Attributes?.MessageDeduplicationId,
        body: message.Body
      });
      if (message.ReceiptHandle !== undefined) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      }
    }
  }
  return messages;
}
