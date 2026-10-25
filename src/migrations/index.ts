import type { Migration } from '@mikro-orm/migrations';

export interface MigrationEntry {
  class: new (driver: unknown, config: unknown) => Migration;
  name: string;
}

import { Migration20260101000000InitialSchema } from './Migration20260101000000InitialSchema';
import { Migration20260101000001LedgerImmutability } from './Migration20260101000001LedgerImmutability';

export const MIGRATIONS: MigrationEntry[] = [
  {
    class: Migration20260101000000InitialSchema as new (driver: unknown, config: unknown) => Migration,
    name: 'Migration20260101000000InitialSchema'
  },
  {
    class: Migration20260101000001LedgerImmutability as new (driver: unknown, config: unknown) => Migration,
    name: 'Migration20260101000001LedgerImmutability'
  }
];
