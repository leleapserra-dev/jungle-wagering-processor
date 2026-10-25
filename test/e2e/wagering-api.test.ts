import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import {
  PORTS,
  createWallet,
  expectStackReady,
  request,
  submitWager,
  wagerInput
} from "../support/api";
import type { LedgerResponse, ReconciliationResponse, WalletResponse } from "../support/api";

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

describe("e2e: HTTP API contract", () => {
  test("wallet lifecycle, validation, idempotency, ledger pagination and reconciliation", async () => {
    await expectStackReady();

    const wallet = await createWallet(PORTS[0], "100.00");
    expect(wallet.version).toBe(1);

    const fromAnotherReplica = await request<WalletResponse>(PORTS[1], "GET", "/wallets/" + wallet.id);
    expect(fromAnotherReplica.status).toBe(200);
    expect(fromAnotherReplica.body?.balance.amount).toBe("100.00");

    const duplicateWallet = await request<ErrorBody>(PORTS[2], "POST", "/wallets", {
      body: { playerId: wallet.playerId, initialBalance: { amount: "1.00", currency: "BRL" } }
    });
    expect(duplicateWallet.status).toBe(409);
    expect(duplicateWallet.body?.code).toBe("WALLET_ALREADY_EXISTS");

    expect((await request<ErrorBody>(PORTS[0], "GET", "/wallets/not-a-uuid")).status).toBe(400);
    expect((await request<ErrorBody>(PORTS[0], "GET", "/wallets/" + randomUUID())).status).toBe(404);

    const missingIdempotency = await request<ErrorBody>(PORTS[0], "POST", "/wagering/transactions", {
      body: wagerInput(wallet, "10.00", "BET")
    });
    expect(missingIdempotency.status).toBe(400);
    expect(missingIdempotency.body?.code).toBe("BAD_REQUEST");

    const invalidMoney = await submitWager(PORTS[0], {
      ...wagerInput(wallet, "10.001", "BET")
    });
    expect(invalidMoney.status).toBe(400);

    const invalidKind = await request<ErrorBody>(PORTS[0], "POST", "/wagering/transactions", {
      body: { ...wagerInput(wallet, "10.00", "BET"), kind: "NOT_A_KIND" },
      headers: { "Idempotency-Key": "idem-" + randomUUID() }
    });
    expect(invalidKind.status).toBe(400);

    const input = wagerInput(wallet, "10.00", "BET");
    const key = "idem-e2e-" + randomUUID();
    const first = await submitWager(PORTS[0], input, key);
    expect(first.status).toBe(201);
    expect(first.body?.status).toBe("PROCESSED");
    expect(first.body?.idempotentReplay).toBe(false);

    const replay = await submitWager(PORTS[1], input, key);
    expect(replay.status).toBe(201);
    expect(replay.body?.idempotentReplay).toBe(true);
    expect(replay.body?.transactionId).toBe(first.body?.transactionId);
    expect(replay.body?.balance.amount).toBe("90.00");

    const conflict = await request<ErrorBody>(PORTS[2], "POST", "/wagering/transactions", {
      body: { ...input, money: { amount: "11.00", currency: "BRL" } },
      headers: { "Idempotency-Key": key }
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body?.code).toBe("IDEMPOTENCY_KEY_CONFLICT");

    const transactionId = first.body?.transactionId;
    if (transactionId === undefined) throw new Error("missing transaction id");
    const byId = await request<{ id: string; status: string; kind: string; balance: { amount: string } }>(
      PORTS[2],
      "GET",
      "/wagering/transactions/" + transactionId
    );
    expect(byId.status).toBe(200);
    expect(byId.body?.id).toBe(transactionId);
    expect(byId.body?.status).toBe("PROCESSED");
    expect(byId.body?.kind).toBe("BET");

    const byProvider = await request<{ id: string }>(
      PORTS[1],
      "GET",
      "/providers/" + input.providerId + "/wagering/transactions/" + input.externalTransactionId
    );
    expect(byProvider.status).toBe(200);
    expect(byProvider.body?.id).toBe(transactionId);

    const page1 = await request<LedgerResponse>(PORTS[0], "GET", "/wallets/" + wallet.id + "/ledger?limit=1");
    expect(page1.status).toBe(200);
    expect(page1.body?.entries).toHaveLength(1);
    expect(page1.body?.entries[0]?.direction).toBe("DEBIT");
    expect(page1.body?.entries[0]?.balanceAfter.amount).toBe("90.00");
    expect(page1.body?.nextCursor).not.toBeNull();

    const cursor = page1.body?.nextCursor ?? "";
    const page2 = await request<LedgerResponse>(
      PORTS[2],
      "GET",
      "/wallets/" + wallet.id + "/ledger?limit=1&cursor=" + encodeURIComponent(cursor)
    );
    expect(page2.status).toBe(200);
    expect(page2.body?.entries).toHaveLength(1);
    expect(page2.body?.entries[0]?.direction).toBe("CREDIT");
    expect(page2.body?.entries[0]?.id).not.toBe(page1.body?.entries[0]?.id);
    expect(page2.body?.nextCursor).toBeNull();

    const badCursor = await request<ErrorBody>(
      PORTS[0],
      "GET",
      "/wallets/" + wallet.id + "/ledger?cursor=" + encodeURIComponent("' OR 1=1 --")
    );
    expect(badCursor.status).toBe(400);
    expect(badCursor.body?.code).toBe("BAD_REQUEST");

    const reconciliation = await request<ReconciliationResponse>(
      PORTS[1],
      "POST",
      "/wallets/" + wallet.id + "/reconciliation"
    );
    expect(reconciliation.status).toBe(201);
    expect(reconciliation.body?.consistent).toBe(true);
    expect(reconciliation.body?.checkedEntries).toBe(2);

    const poor = await createWallet(PORTS[0], "5.00");
    const rejected = await submitWager(PORTS[2], wagerInput(poor, "10.00", "BET"));
    expect(rejected.status).toBe(422);
    expect(rejected.body?.status).toBe("REJECTED");
    expect(rejected.body?.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(rejected.body?.transactionId).toBeDefined();

    const status = await request<{ status: string }>(
      PORTS[1],
      "GET",
      "/wagering/transactions/" + (rejected.body?.transactionId ?? "")
    );
    expect(status.status).toBe(200);
    expect(status.body?.status).toBe("REJECTED");
  }, 60000);

  test("all replicas report readiness", async () => {
    for (const port of PORTS) {
      const ready = await request<{ status: string; postgres: string; sqs: string }>(port, "GET", "/health/ready");
      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ status: "ready", postgres: "ok", sqs: "ok" });
    }
  }, 30000);
});
