import { EntitySchema } from '@mikro-orm/core';

export class LedgerRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const LedgerRecordSchema = new EntitySchema<LedgerRecord>({
  class: LedgerRecord,
  tableName: 'wallet_ledger_entries',
  properties: {
    id: { type: 'uuid', primary: true },
    walletId: { type: 'uuid', fieldName: 'wallet_id' },
    transactionId: { type: 'uuid', fieldName: 'transaction_id' },
    direction: { type: 'string', columnType: 'varchar(6)' },
    amount: { type: 'string', columnType: 'numeric(20,2)' },
    currency: { type: 'string', columnType: 'char(3)' },
    balanceBefore: { type: 'string', fieldName: 'balance_before', columnType: 'numeric(20,2)' },
    balanceAfter: { type: 'string', fieldName: 'balance_after', columnType: 'numeric(20,2)' },
    createdAt: { type: 'Date', fieldName: 'created_at', columnType: 'timestamptz' }
  }
});
