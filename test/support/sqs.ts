import { SQSClient, SendMessageCommand, GetQueueAttributesCommand, PurgeQueueCommand } from "@aws-sdk/client-sqs";

const endpoint = "http://localhost:4566";
const accountPath = "/000000000000/";

export const SOURCE_QUEUE = endpoint + accountPath + "wager-transactions.fifo";
export const DLQ_QUEUE = endpoint + accountPath + "wager-transactions-dlq.fifo";

export const sqs = new SQSClient({
  region: "us-east-1",
  endpoint,
  credentials: { accessKeyId: "test", secretAccessKey: "test" }
});

export async function queueDepth(queueUrl: string): Promise<number> {
  const result = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    })
  );
  const visible = Number(result.Attributes?.ApproximateNumberOfMessages ?? "0");
  const inFlight = Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0");
  return visible + inFlight;
}

export async function purgeQueues(): Promise<void> {
  await sqs.send(new PurgeQueueCommand({ QueueUrl: SOURCE_QUEUE }));
  await sqs.send(new PurgeQueueCommand({ QueueUrl: DLQ_QUEUE }));
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
