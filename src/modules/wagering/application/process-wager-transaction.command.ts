import type { Money } from '../../../shared/domain/money';
import type { WalletLedgerEntry } from '../../wallet/domain/wallet-ledger-entry';
import type { WagerTransaction } from '../domain/wager-transaction';
import type { Wallet } from '../../wallet/domain/wallet';
import type { IntegrationEvent } from '../../../shared/domain/integration-event';
import type { InboxMessage } from '../../messaging/domain/inbox-message';

export interface ProcessWagerTransactionResult {
  transaction: WagerTransaction;
  wallet: Wallet;
  ledgerEntry: WalletLedgerEntry | null;
  events: IntegrationEvent<unknown>[];
  balance: Money;
  idempotentReplay: boolean;
}

export interface ProcessWagerTransactionCommand {
  correlationId: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  at: Date;
  inboxMessage?: InboxMessage | undefined;
}
