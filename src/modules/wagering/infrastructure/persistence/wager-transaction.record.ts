import { EntitySchema } from '@mikro-orm/core';
import type { WagerTransactionKind, WagerTransactionStatus } from '../../domain/wager-transaction-status';

export class WagerTransactionRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: WagerTransactionKind;
  moneyAmount!: string;
  moneyCurrency!: string;
  referenceExternalTransactionId!: string | null;
  status!: WagerTransactionStatus;
  referenceTransactionId!: string | null;
  failureCode!: string | null;
  createdAt!: Date;
  processedAt!: Date | null;
  observedBalance!: string;
  observedBalanceCurrency!: string;
  referenceAttempts!: number;
  nextReferenceAttemptAt!: Date | null;
}

export const WagerTransactionRecordSchema = new EntitySchema<WagerTransactionRecord>({
  class: WagerTransactionRecord,
  tableName: 'wager_transactions',
  properties: {
    id: { type: 'uuid', primary: true },
    providerId: { type: 'string', fieldName: 'provider_id' },
    externalTransactionId: { type: 'string', fieldName: 'external_transaction_id' },
    idempotencyKey: { type: 'string', fieldName: 'idempotency_key' },
    payloadHash: { type: 'string', fieldName: 'payload_hash', columnType: 'char(64)' },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    playerId: { type: 'string', fieldName: 'player_id' },
    roundId: { type: 'string', fieldName: 'round_id' },
    gameId: { type: 'string', fieldName: 'game_id' },
    kind: { type: 'string', columnType: 'varchar(16)' },
    moneyAmount: { type: 'string', fieldName: 'money_amount', columnType: 'numeric(20,2)' },
    moneyCurrency: { type: 'string', fieldName: 'money_currency', columnType: 'char(3)' },
    referenceExternalTransactionId: {
      type: 'string',
      fieldName: 'reference_external_transaction_id',
      columnType: 'varchar(200)',
      nullable: true
    },
    status: { type: 'string', columnType: 'varchar(24)' },
    referenceTransactionId: {
      type: 'uuid',
      fieldName: 'reference_transaction_id',
      nullable: true
    },
    failureCode: { type: 'string', fieldName: 'failure_code', columnType: 'varchar(64)', nullable: true },
    createdAt: { type: 'Date', fieldName: 'created_at', columnType: 'timestamptz' },
    processedAt: { type: 'Date', fieldName: 'processed_at', columnType: 'timestamptz', nullable: true },
    observedBalance: { type: 'string', fieldName: 'observed_balance', columnType: 'numeric(20,2)' },
    observedBalanceCurrency: {
      type: 'string',
      fieldName: 'observed_balance_currency',
      columnType: 'char(3)'
    },
    referenceAttempts: { type: 'integer', fieldName: 'reference_attempts' },
    nextReferenceAttemptAt: {
      type: 'Date',
      fieldName: 'next_reference_attempt_at',
      columnType: 'timestamptz',
      nullable: true
    }
  }
});
