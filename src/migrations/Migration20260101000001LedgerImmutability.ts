import { Migration } from '@mikro-orm/migrations';

export class Migration20260101000001LedgerImmutability extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function "reject_ledger_mutation"() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries is immutable: % is forbidden', tg_op
          using errcode = 'integrity_constraint_violation';
      end;
      $$ language plpgsql;
    `);

    this.addSql(`
      create trigger "wallet_ledger_entries_no_update_delete"
      before update or delete on "wallet_ledger_entries"
      for each row execute function "reject_ledger_mutation"();
    `);

    this.addSql(`
      create trigger "wallet_ledger_entries_no_truncate"
      before truncate on "wallet_ledger_entries"
      for each statement execute function "reject_ledger_mutation"();
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop trigger if exists "wallet_ledger_entries_no_truncate" on "wallet_ledger_entries";');
    this.addSql('drop trigger if exists "wallet_ledger_entries_no_update_delete" on "wallet_ledger_entries";');
    this.addSql('drop function if exists "reject_ledger_mutation"();');
  }
}
