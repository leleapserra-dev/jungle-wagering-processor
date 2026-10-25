import { defineConfig, type Options, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletRecordSchema } from '../modules/wallet/infrastructure/persistence/wallet.record';
import { LedgerRecordSchema } from '../modules/wallet/infrastructure/persistence/ledger-entry.record';
import { WagerTransactionRecordSchema } from '../modules/wagering/infrastructure/persistence/wager-transaction.record';
import { InboxRecordSchema } from '../modules/messaging/infrastructure/persistence/inbox-message.record';
import { OutboxRecordSchema } from '../modules/messaging/infrastructure/persistence/outbox-message.record';
import { MIGRATIONS } from '../migrations';

export interface DatabaseSettings {
  url: string;
  poolSize: number;
  ssl: boolean;
}

export function createOrmOptions(settings: DatabaseSettings): Options {
  return defineConfig({
    driver: PostgreSqlDriver,
    clientUrl: settings.url,
    entities: [
      WalletRecordSchema,
      LedgerRecordSchema,
      WagerTransactionRecordSchema,
      InboxRecordSchema,
      OutboxRecordSchema
    ],
    pool: { min: 1, max: settings.poolSize },
    driverOptions: settings.ssl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
    debug: false,
    extensions: [Migrator],
    migrations: {
      migrationsList: MIGRATIONS,
      transactional: true,
      allOrNothing: true
    }
  });
}
