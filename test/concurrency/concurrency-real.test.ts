import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { Client } from "pg";

const PORTS = [3001, 3002, 3003] as const;
const API = (p: number) => "http://localhost:" + p;

function portAt(index: number): number {
  return PORTS[index % PORTS.length] ?? PORTS[0];
}

interface ApiBody {
  id: string;
  status: string;
  idempotentReplay: boolean;
  failureCode?: string;
  transactionId?: string;
  code?: string;
  balance?: { amount: string; currency: string };
}

async function req(port: number, method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(API(port) + path, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: ApiBody | undefined;
  try {
    json = JSON.parse(text) as ApiBody;
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

async function getPg() {
  const client = new Client({
    host: "localhost",
    port: 5432,
    user: "jungle",
    password: "jungle",
    database: "wagering"
  });
  await client.connect();
  return client;
}

async function createWallet(port: number, initialAmount: string) {
  const playerId = "p-" + randomUUID();
  const r = await req(port, "POST", "/wallets", { playerId, initialBalance: { amount: initialAmount, currency: "BRL" } });
  expect(r.status).toBe(201);
  const walletId = r.json?.id;
  if (!walletId) throw new Error("wallet creation failed: " + r.text);
  return { walletId, playerId };
}

describe("concurrency real", () => {
  test("1) same bet 50 times parallel across 3 ports -> exactly 1 processed debit effect, 49 replays", async () => {
    const port = PORTS[0];
    const { walletId, playerId } = await createWallet(port, "100.00");
    const key = "idem-" + randomUUID();
    const body = {
      providerId: "prov",
      externalTransactionId: "ext-" + randomUUID(),
      playerId,
      walletId,
      roundId: "r-" + randomUUID(),
      gameId: "g1",
      kind: "BET",
      money: { amount: "10.00", currency: "BRL" }
    };
    const calls = Array.from({ length: 50 }).map((_, i) => req(portAt(i), "POST", "/wagering/transactions", body, { "Idempotency-Key": key }));
    const results = await Promise.all(calls);
    const errors = results.filter(r => r.status >= 500);
    const processed = results.filter(r => r.json && r.json.status === "PROCESSED" && r.json.idempotentReplay === false);
    const replays = results.filter(r => r.json && r.json.idempotentReplay === true);
    expect(errors.length).toBe(0);
    expect(processed.length).toBe(1);
    expect(replays.length).toBe(49);
    const pg = await getPg();
    const w = await pg.query("select balance from wallets where id=$1", [walletId]);
    const debits = await pg.query("select count(*) as c from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT'", [walletId]);
    expect(w.rows[0].balance).toBe("90.00");
    expect(parseInt(debits.rows[0].c)).toBe(1);
    await pg.end();
  }, 60000);

  test("2) mandatory: balance 100, two BETs of 80 in parallel different replicas -> 1 PROCESSED 1 REJECTED (INSUFFICIENT_FUNDS), final 20.00, exactly 1 DEBIT", async () => {
    const { walletId, playerId } = await createWallet(PORTS[0], "100.00");
    const p1 = req(PORTS[0], "POST", "/wagering/transactions", {
      providerId: "prov", externalTransactionId: "ext-" + randomUUID(), playerId, walletId, roundId: "r-" + randomUUID(), gameId: "g1", kind: "BET", money: { amount: "80.00", currency: "BRL" }
    }, { "Idempotency-Key": "k1-" + randomUUID() });
    const p2 = req(PORTS[1], "POST", "/wagering/transactions", {
      providerId: "prov2", externalTransactionId: "ext-" + randomUUID(), playerId, walletId, roundId: "r-" + randomUUID(), gameId: "g1", kind: "BET", money: { amount: "80.00", currency: "BRL" }
    }, { "Idempotency-Key": "k2-" + randomUUID() });
    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.json?.status, r2.json?.status].filter(Boolean).sort();
    expect(statuses).toEqual(["PROCESSED", "REJECTED"]);
    const rejected = r1.json?.status === "REJECTED" ? r1 : r2;
    expect(rejected.json?.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(rejected.status).toBe(422);
    expect(rejected.json?.transactionId).toBeDefined();
    expect(rejected.json?.status).toBe("REJECTED");
    expect(rejected.json?.balance).toBeDefined();
    expect(rejected.json?.idempotentReplay).toBeDefined();
    const pg = await getPg();
    const w = await pg.query("select balance from wallets where id=$1", [walletId]);
    const debits = await pg.query("select count(*) as c from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT'", [walletId]);
    expect(w.rows[0].balance).toBe("20.00");
    expect(parseInt(debits.rows[0].c)).toBe(1);
    await pg.end();
  }, 60000);

  test("3) many small concurrent bets on same wallet -> no negative balance, final correct", async () => {
    const { walletId, playerId } = await createWallet(PORTS[2], "100.00");
    const calls = Array.from({ length: 20 }).map(() => req(portAt(Math.floor(Math.random()*3)), "POST", "/wagering/transactions", {
      providerId: "prov", externalTransactionId: "ext-" + randomUUID(), playerId, walletId, roundId: "r-" + randomUUID(), gameId: "g1", kind: "BET", money: { amount: "5.00", currency: "BRL" }
    }, { "Idempotency-Key": "k-" + randomUUID() }));
    await Promise.all(calls);
    const pg = await getPg();
    const w = await pg.query("select balance from wallets where id=$1", [walletId]);
    const bal = parseFloat(w.rows[0].balance);
    expect(bal).toBeGreaterThanOrEqual(0);
    const debits = await pg.query("select sum(cast(amount as numeric)) as s from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT'", [walletId]);
    const credits = await pg.query("select sum(cast(amount as numeric)) as s from wallet_ledger_entries where wallet_id=$1 and direction='CREDIT'", [walletId]);
    const d = parseFloat(debits.rows[0].s || "0");
    const c = parseFloat(credits.rows[0].s || "0");
    expect((c - d).toFixed(2)).toBe(bal.toFixed(2));
    await pg.end();
  }, 60000);

  test("4) distinct wallets in parallel, no global serialization", async () => {
    const tasks = Array.from({ length: 10 }).map(async (_, i) => {
      const { walletId, playerId } = await createWallet(portAt(i), "50.00");
      const r = await req(portAt(i + 1), "POST", "/wagering/transactions", {
        providerId: "prov", externalTransactionId: "ext-" + randomUUID(), playerId, walletId, roundId: "r-" + randomUUID(), gameId: "g1", kind: "BET", money: { amount: "10.00", currency: "BRL" }
      }, { "Idempotency-Key": "k-" + randomUUID() });
      return { walletId, r };
    });
    const res = await Promise.all(tasks);
    for (const x of res) {
      if (x.r.json && x.r.json.code === "INTERNAL_ERROR") continue;
      expect(x.r.json?.status).toBe("PROCESSED");
    }
    const pg = await getPg();
    for (const x of res) {
      if (!x.walletId) continue;
      const w = await pg.query("select balance from wallets where id=$1", [x.walletId]);
      const debits = await pg.query("select count(*) as c from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT'", [x.walletId]);
      expect(w.rows[0].balance).toBe("40.00");
      expect(parseInt(debits.rows[0].c)).toBe(1);
    }
    await pg.end();
  }, 60000);

  test("5) simultaneous load on all 3 instances", async () => {
    const { walletId, playerId } = await createWallet(PORTS[0], "200.00");
    const calls = Array.from({ length: 30 }).map(() => req(portAt(Math.floor(Math.random()*3)), "POST", "/wagering/transactions", {
      providerId: "prov", externalTransactionId: "ext-" + randomUUID(), playerId, walletId, roundId: "r-" + randomUUID(), gameId: "g1", kind: "BET", money: { amount: "1.00", currency: "BRL" }
    }, { "Idempotency-Key": "k-" + randomUUID() }));
    await Promise.all(calls);
    const pg = await getPg();
    const w = await pg.query("select balance from wallets where id=$1", [walletId]);
    const bal = parseFloat(w.rows[0].balance);
    expect(bal).toBeGreaterThanOrEqual(0);
    const s = await pg.query("select sum(cast(amount as numeric)) as s from wallet_ledger_entries where wallet_id=$1 and direction='DEBIT'", [walletId]);
    expect((200 - parseFloat(s.rows[0].s || "0")).toFixed(2)).toBe(bal.toFixed(2));
    await pg.end();
  }, 120000);
});
