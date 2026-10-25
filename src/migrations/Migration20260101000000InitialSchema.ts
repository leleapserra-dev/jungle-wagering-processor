import { Migration } from '@mikro-orm/migrations';

export class Migration20260101000000InitialSchema extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" varchar(128) not null,
        "currency" char(3) not null,
        "balance" numeric(20,2) not null,
        "version" integer not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id"),
        constraint "wallets_balance_non_negative" check ("balance" >= 0),
        constraint "wallets_balance_scale" check ("balance" = round("balance", 2)),
        constraint "wallets_version_positive" check ("version" >= 1),
        constraint "wallets_player_currency_unique" unique ("player_id", "currency")
      );
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(100) not null,
        "external_transaction_id" varchar(200) not null,
        "idempotency_key" varchar(300) not null,
        "payload_hash" char(64) not null,
        "wallet_id" uuid not null,
        "player_id" varchar(128) not null,
        "round_id" varchar(128) not null,
        "game_id" varchar(128) not null,
        "kind" varchar(16) not null,
        "money_amount" numeric(20,2) not null,
        "money_currency" char(3) not null,
        "reference_external_transaction_id" varchar(200) null,
        "status" varchar(24) not null,
        "reference_transaction_id" uuid null,
        "failure_code" varchar(64) null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        "observed_balance" numeric(20,2) not null,
        "observed_balance_currency" char(3) not null,
        "reference_attempts" integer not null default 0,
        "next_reference_attempt_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id"),
        constraint "wager_transactions_id_wallet_unique" unique ("id", "wallet_id"),
        constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key"),
        constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id"),
        constraint "wager_transactions_wallet_fk" foreign key ("wallet_id") references "wallets" ("id") on update restrict on delete restrict,
        constraint "wager_transactions_reference_fk" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on update restrict on delete restrict,
        constraint "wager_transactions_kind_check" check ("kind" in ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        constraint "wager_transactions_status_check" check ("status" in ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        constraint "wager_transactions_money_positive" check (("kind" = 'LOSS' and "money_amount" >= 0) or ("kind" <> 'LOSS' and "money_amount" > 0)),
        constraint "wager_transactions_money_scale" check ("money_amount" = round("money_amount", 2) and "observed_balance" = round("observed_balance", 2)),
        constraint "wager_transactions_reference_required" check (("kind" in ('REFUND','ROLLBACK') and "reference_external_transaction_id" is not null) or ("kind" not in ('REFUND','ROLLBACK'))),
        constraint "wager_transactions_failure_code_required" check (("status" in ('REJECTED','FAILED') and "failure_code" is not null) or ("status" not in ('REJECTED','FAILED'))),
        constraint "wager_transactions_observed_balance_non_negative" check ("observed_balance" >= 0),
        constraint "wager_transactions_reference_attempts_non_negative" check ("reference_attempts" >= 0)
      );
    `);

    this.addSql(`
      create unique index "wager_transactions_reversal_unique"
        on "wager_transactions" ("reference_transaction_id", "kind")
        where "kind" in ('REFUND','ROLLBACK') and "status" = 'PROCESSED' and "reference_transaction_id" is not null;
    `);
    this.addSql(`
      create index "wager_transactions_pending_reference_due_idx"
        on "wager_transactions" ("next_reference_attempt_at", "id")
        where "status" = 'PENDING_REFERENCE';
    `);
    this.addSql(`
      create index "wager_transactions_wallet_created_idx"
        on "wager_transactions" ("wallet_id", "created_at" desc);
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" varchar(6) not null,
        "amount" numeric(20,2) not null,
        "currency" char(3) not null,
        "balance_before" numeric(20,2) not null,
        "balance_after" numeric(20,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id"),
        constraint "wallet_ledger_entries_wallet_transaction_unique" unique ("wallet_id", "transaction_id"),
        constraint "wallet_ledger_entries_wallet_fk" foreign key ("wallet_id") references "wallets" ("id") on update restrict on delete restrict,
        constraint "wallet_ledger_entries_transaction_wallet_fk" foreign key ("transaction_id", "wallet_id") references "wager_transactions" ("id", "wallet_id") on update restrict on delete restrict,
        constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT','CREDIT')),
        constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0),
        constraint "wallet_ledger_entries_balances_non_negative" check ("balance_before" >= 0 and "balance_after" >= 0),
        constraint "wallet_ledger_entries_scale" check ("amount" = round("amount", 2) and "balance_before" = round("balance_before", 2) and "balance_after" = round("balance_after", 2)),
        constraint "wallet_ledger_entries_arithmetic" check (
          ("direction" = 'DEBIT' and "balance_after" = "balance_before" - "amount") or
          ("direction" = 'CREDIT' and "balance_after" = "balance_before" + "amount")
        )
      );
    `);

    this.addSql(`
      create index "wallet_ledger_entries_cursor_idx"
        on "wallet_ledger_entries" ("wallet_id", "created_at" desc, "id" desc);
    `);

    this.addSql(`
      create table "inbox_messages" (
        "id" uuid not null,
        "consumer_name" varchar(100) not null,
        "message_id" varchar(200) not null,
        "payload_hash" char(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("id"),
        constraint "inbox_messages_consumer_message_unique" unique ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" varchar(128) not null,
        "event_type" varchar(100) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id"),
        constraint "outbox_messages_attempts_non_negative" check ("attempts" >= 0)
      );
    `);

    this.addSql(`
      create index "outbox_messages_pending_due_idx"
        on "outbox_messages" ("next_attempt_at", "occurred_at")
        where "published_at" is null;
    `);
    this.addSql(`
      create index "outbox_messages_pending_occurred_idx"
        on "outbox_messages" ("occurred_at")
        where "published_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "outbox_messages" cascade;');
    this.addSql('drop table if exists "inbox_messages" cascade;');
    this.addSql('drop table if exists "wallet_ledger_entries" cascade;');
    this.addSql('drop table if exists "wager_transactions" cascade;');
    this.addSql('drop table if exists "wallets" cascade;');
  }
}
