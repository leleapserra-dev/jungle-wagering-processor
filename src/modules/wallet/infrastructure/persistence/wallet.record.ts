import { EntitySchema } from '@mikro-orm/core';

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletRecordSchema = new EntitySchema<WalletRecord>({
  class: WalletRecord,
  tableName: 'wallets',
  properties: {
    id: { type: 'uuid', primary: true },
    playerId: { type: 'string', fieldName: 'player_id' },
    currency: { type: 'string', columnType: 'char(3)' },
    balance: { type: 'string', columnType: 'numeric(20,2)' },
    version: { type: 'integer' },
    createdAt: { type: 'Date', fieldName: 'created_at', columnType: 'timestamptz' },
    updatedAt: { type: 'Date', fieldName: 'updated_at', columnType: 'timestamptz' }
  }
});
