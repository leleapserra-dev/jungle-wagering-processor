import { randomUUID } from 'crypto';
import { Client } from 'pg';

export const PORTS = [3001, 3002, 3003] as const;

export function apiUrl(port: number): string {
  return 'http://localhost:' + port;
}

export interface ApiResult<T> {
  status: number;
  body: T | undefined;
  text: string;
  headers: Headers;
}

export interface WalletResponse {
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
  version: number;
}

export interface TransactionResponse {
  transactionId: string;
  status: string;
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
  failureCode?: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  direction: 'DEBIT' | 'CREDIT';
  money: { amount: string; currency: string };
  balanceBefore: { amount: string; currency: string };
  balanceAfter: { amount: string; currency: string };
  createdAt: string;
}

export interface LedgerResponse {
  entries: LedgerEntry[];
  nextCursor: string | null;
}

export interface ReconciliationResponse {
  walletId: string;
  storedBalance: { amount: string; currency: string };
  calculatedBalance: { amount: string; currency: string };
  difference: { amount: string; currency: string };
  consistent: boolean;
  checkedEntries: number;
}

export async function request<T>(
  port: number,
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<ApiResult<T>> {
  const response = await fetch(apiUrl(port) + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000)
  });
  const text = await response.text();
  let body: T | undefined;
  try {
    body = text.length === 0 ? undefined : (JSON.parse(text) as T);
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text, headers: response.headers };
}

export async function createWallet(port: number, initialAmount: string): Promise<WalletResponse> {
  const playerId = 'p-' + randomUUID();
  const result = await request<WalletResponse>(port, 'POST', '/wallets', {
    body: { playerId, initialBalance: { amount: initialAmount, currency: 'BRL' } }
  });
  if (result.status !== 201 || result.body === undefined) {
    throw new Error('wallet creation failed: ' + result.status + ' ' + result.text);
  }
  return result.body;
}

export interface WagerInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export function wagerInput(wallet: WalletResponse, amount: string, kind: WagerInput['kind'] = 'BET'): WagerInput {
  return {
    providerId: 'prov-' + randomUUID(),
    externalTransactionId: 'ext-' + randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'r-' + randomUUID(),
    gameId: 'game-' + randomUUID(),
    kind,
    money: { amount, currency: 'BRL' }
  };
}

export async function submitWager(
  port: number,
  body: WagerInput,
  idempotencyKey = 'idem-' + randomUUID()
): Promise<ApiResult<TransactionResponse>> {
  return request<TransactionResponse>(port, 'POST', '/wagering/transactions', {
    body,
    headers: { 'Idempotency-Key': idempotencyKey }
  });
}

export async function getPg(): Promise<Client> {
  const client = new Client({
    host: process.env.TEST_PG_HOST ?? 'localhost',
    port: Number(process.env.TEST_PG_PORT ?? '5432'),
    user: process.env.TEST_PG_USER ?? 'jungle',
    password: process.env.TEST_PG_PASSWORD ?? 'jungle',
    database: process.env.TEST_PG_DATABASE ?? 'wagering'
  });
  await client.connect();
  return client;
}

export async function waitFor<T>(
  label: string,
  read: () => Promise<T | undefined>,
  timeoutMs = 20000,
  intervalMs = 250
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('timed out waiting for ' + label);
}

export async function expectStackReady(): Promise<void> {
  for (const port of PORTS) {
    const result = await request<{ status: string; postgres: string; sqs: string }>(port, 'GET', '/health/ready', {
      timeoutMs: 10000
    });
    if (result.status !== 200 || result.body?.status !== 'ready') {
      throw new Error('stack is not ready on port ' + port + ': ' + result.status + ' ' + result.text);
    }
  }
}
