import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { PORTS, createWallet, expectStackReady, getPg, waitFor, wagerInput } from "../support/api";
import type { WagerInput } from "../support/api";
import { DLQ_QUEUE, SOURCE_QUEUE, purgeQueues, queueDepth, sendEnvelope, sqs } from "../support/sqs";

interface CommandEnvelope {
  messageId: string;
  type: string;
  occurredAt: string;
  data: WagerInput & { idempotencyKey: string };
}

function envelopeFor(input: WagerInput, idempotencyKey: string): CommandEnvelope {
  return {
    messageId: randomUUID(),
    type: "ProcessWagerTransaction",
    occurredAt: new Date().toISOString(),
    data: { ...input, idempotencyKey }
  };
}

describe("integration: SQS FIFO delivery", () => {
  test("valid command is processed and acked, replay is deduplicated, malformed goes to DLQ", async () => {
    await expectStackReady();
    await purgeQueues();
    await waitFor("source queue empty", async () => ((await queueDepth(SOURCE_QUEUE)) === 0 ? true : undefined));
    await waitFor("dlq empty", async () => ((await queueDepth(DLQ_QUEUE)) === 0 ? true : undefined));

    const wallet = await createWallet(PORTS[0], "100.00");
    const input = wagerInput(wallet, "10.00", "BET");
    const idempotencyKey = "idem-sqs-" + randomUUID();
    const envelope = envelopeFor(input, idempotencyKey);

    await sendEnvelope(envelope, wallet.id, randomUUID());

    const pg = await getPg();
    try {
      const transaction = await waitFor("sqs transaction processed", async () => {
        const res = await pg.query<{ id: string; status: string }>(
          "select id, status from wager_transactions where idempotency_key=$1",
          [idempotencyKey]
        );
        return res.rows[0]?.status === "PROCESSED" ? res.rows[0] : undefined;
      });
      expect(transaction.status).toBe("PROCESSED");

      const inbox = await waitFor("inbox processed", async () => {
        const res = await pg.query<{ message_id: string; processed_at: Date | null; payload_hash: string }>(
          "select message_id, processed_at, payload_hash from inbox_messages where consumer_name=$1 and message_id=$2",
          ["wager-transactions", envelope.messageId]
        );
        return res.rows[0]?.processed_at !== null ? res.rows[0] : undefined;
      });
      expect(inbox.message_id).toBe(envelope.messageId);
      expect(inbox.payload_hash).toHaveLength(64);

      await waitFor("source acked", async () => ((await queueDepth(SOURCE_QUEUE)) === 0 ? true : undefined));

      await sendEnvelope(envelope, wallet.id, randomUUID());
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await waitFor("source acked after replay", async () => ((await queueDepth(SOURCE_QUEUE)) === 0 ? true : undefined));

      const effects = await pg.query<{ transactions: string; debits: string; balance: string }>(
        `select
           (select count(*) from wager_transactions where idempotency_key=$1)::text as transactions,
           (select count(*) from wallet_ledger_entries where wallet_id=$2 and direction='DEBIT')::text as debits,
           (select balance from wallets where id=$2)::text as balance`,
        [idempotencyKey, wallet.id]
      );
      expect(effects.rows[0]?.transactions).toBe("1");
      expect(effects.rows[0]?.debits).toBe("1");
      expect(effects.rows[0]?.balance).toBe("90.00");

      const businessFailure = envelopeFor(
        { ...wagerInput(wallet, "1.00", "BET"), walletId: randomUUID() },
        "idem-missing-" + randomUUID()
      );
      const dlqBeforeBusiness = await queueDepth(DLQ_QUEUE);
      await sendEnvelope(businessFailure, wallet.id, randomUUID());
      await waitFor("business failure acked", async () => ((await queueDepth(SOURCE_QUEUE)) === 0 ? true : undefined));
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await queueDepth(DLQ_QUEUE)).toBe(dlqBeforeBusiness);

      const malformed = {
        messageId: randomUUID(),
        type: "ProcessWagerTransaction",
        occurredAt: new Date().toISOString(),
        data: { idempotencyKey: "bad" }
      };
      await sendEnvelope(malformed, wallet.id, randomUUID());
      await waitFor("malformed moved to dlq", async () => ((await queueDepth(DLQ_QUEUE)) > 0 ? true : undefined));

      const dlqMessage = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: DLQ_QUEUE, MaxNumberOfMessages: 1, WaitTimeSeconds: 2 })
      );
      const received = dlqMessage.Messages?.[0];
      expect(received).toBeDefined();
      const receivedBody = JSON.parse(received?.Body ?? "{}") as { messageId?: string };
      expect(receivedBody.messageId).toBe(malformed.messageId);
      if (received?.ReceiptHandle !== undefined) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: DLQ_QUEUE, ReceiptHandle: received.ReceiptHandle }));
      }
    } finally {
      await pg.end();
    }
  }, 90000);
});
