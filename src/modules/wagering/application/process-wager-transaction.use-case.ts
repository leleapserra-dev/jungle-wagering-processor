import { Inject, Injectable } from '@nestjs/common';
import type { ProcessWagerTransactionCommand, ProcessWagerTransactionResult } from './process-wager-transaction.command';
import type { WagerTransactionRepository } from '../domain/wager-transaction.repository';
import type { WalletRepository } from '../../wallet/domain/wallet.repository';
import type { WalletLedgerRepository } from '../../wallet/domain/wallet-ledger.repository';
import type { InboxRepository } from '../../messaging/domain/inbox.repository';
import type { OutboxRepository } from '../../messaging/domain/outbox.repository';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { WagerTransaction } from '../domain/wager-transaction';
import { WagerTransactionKind } from '../domain/wager-transaction-status';
import { FailureCode } from '../domain/failure-code';
import { UuidV7Generator } from '../../../shared/domain/identity';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidWagerTransactionError,
  PersistenceConflictError,
  WalletNotFoundError
} from '../../../shared/domain/errors';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import { WagerTransactionPendingReference, WagerTransactionProcessed, WagerTransactionRejected, WalletBalanceChanged } from '../domain/events';
import type { EventContext } from '../../../shared/domain/integration-event';
import { LedgerDirection } from '../../wallet/domain/ledger-direction';

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    @Inject('UnitOfWork') private readonly uow: UnitOfWork,
    @Inject('WagerTransactionRepository') private readonly wagerRepo: WagerTransactionRepository,
    @Inject('WalletRepository') private readonly walletRepo: WalletRepository,
    @Inject('WalletLedgerRepository') private readonly ledgerRepo: WalletLedgerRepository,
    @Inject('InboxRepository') private readonly inboxRepo: InboxRepository,
    @Inject('OutboxRepository') private readonly outboxRepo: OutboxRepository,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator
  ) {}

  async execute(cmd: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    return this.uow.run(async () => {
      const existing = await this.wagerRepo.findByIdempotencyKey(cmd.idempotencyKey);
      if (existing !== null) {
        return this.replay(existing, cmd.payloadHash, cmd.idempotencyKey);
      }

      const kind = kindFrom(cmd.kind);
      if (kind === WagerTransactionKind.Opening) {
        throw new InvalidWagerTransactionError('OPENING is internal only');
      }

      if (cmd.inboxMessage !== undefined) {
        const inserted = await this.inboxRepo.tryInsert(cmd.inboxMessage);
        if (!inserted) {
          const existingInbox = await this.wagerRepo.findByIdempotencyKey(cmd.idempotencyKey);
          if (existingInbox !== null && existingInbox.matchesPayload(cmd.payloadHash)) {
            const wallet = await this.walletRepo.findById(existingInbox.walletId);
            if (wallet === null) {
              throw new PersistenceConflictError('wallet missing for existing transaction', {
                transactionId: existingInbox.id,
                walletId: existingInbox.walletId
              });
            }
            return {
              transaction: existingInbox,
              wallet,
              ledgerEntry: null,
              events: [],
              balance: existingInbox.observedBalance,
              idempotentReplay: true
            };
          }
        }
      }

      const wallet = await this.walletRepo.findByIdForUpdate(cmd.walletId);
      if (wallet === null) {
        throw new WalletNotFoundError('wallet not found', { walletId: cmd.walletId });
      }

      const transaction = WagerTransaction.create({
        id: this.ids.next(),
        providerId: cmd.providerId,
        externalTransactionId: cmd.externalTransactionId,
        idempotencyKey: cmd.idempotencyKey,
        payloadHash: cmd.payloadHash,
        walletId: cmd.walletId,
        playerId: cmd.playerId,
        roundId: cmd.roundId,
        gameId: cmd.gameId,
        kind,
        money: cmd.money,
        referenceExternalTransactionId: cmd.referenceExternalTransactionId,
        createdAt: cmd.at,
        observedBalance: wallet.balance
      });

      const inserted = await this.wagerRepo.insertIfAbsent(transaction);
      if (!inserted) {
        const winner = await this.wagerRepo.findByIdempotencyKey(cmd.idempotencyKey);
        if (winner !== null) {
          return this.replay(winner, cmd.payloadHash, cmd.idempotencyKey);
        }
        const byExternal = await this.wagerRepo.findByProviderExternal(
          cmd.providerId,
          cmd.externalTransactionId
        );
        if (byExternal === null) {
          throw new PersistenceConflictError('transaction insert conflicted without a persisted winner', {
            idempotencyKey: cmd.idempotencyKey
          });
        }
        if (!byExternal.matchesPayload(cmd.payloadHash) || byExternal.idempotencyKey !== cmd.idempotencyKey) {
          throw new IdempotencyConflictError('transaction already exists with a different identity', {
            idempotencyKey: cmd.idempotencyKey,
            existingIdempotencyKey: byExternal.idempotencyKey
          });
        }
        return this.replay(byExternal, cmd.payloadHash, cmd.idempotencyKey);
      }

      let referencedTransaction: WagerTransaction | null = null;
      if (transaction.requiresReference()) {
        const ref = await this.wagerRepo.findByProviderExternal(
          cmd.providerId,
          transaction.referenceExternalTransactionId as string
        );
        if (ref === null || !ref.isTerminal() || ref.status !== 'PROCESSED') {
          const nextAttempt = new Date(cmd.at.getTime() + 5000);
          transaction.markPendingReference(cmd.at, nextAttempt, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const event = WagerTransactionPendingReference.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(event));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [event],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }

        if (!this.matchesReference(transaction, ref)) {
          transaction.reject(FailureCode.ReferenceMismatch, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const rejected = WagerTransactionRejected.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [rejected],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }

        if (ref.kind !== WagerTransactionKind.Bet) {
          if (
            !(
              transaction.kind === WagerTransactionKind.Rollback &&
              (ref.kind === WagerTransactionKind.Win || ref.kind === WagerTransactionKind.Refund)
            )
          ) {
            transaction.reject(FailureCode.InvalidReferenceKind, cmd.at, wallet.balance);
            await this.wagerRepo.update(transaction);
            const eventContext = context(cmd.correlationId, this.ids);
            const rejected = WagerTransactionRejected.from(transaction, eventContext);
            await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
            if (cmd.inboxMessage !== undefined) {
              await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
            }
            return {
              transaction,
              wallet,
              ledgerEntry: null,
              events: [rejected],
              balance: wallet.balance,
              idempotentReplay: false
            };
          }
        } else if (transaction.kind !== WagerTransactionKind.Refund && transaction.kind !== WagerTransactionKind.Rollback) {
          transaction.reject(FailureCode.InvalidReferenceKind, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const rejected = WagerTransactionRejected.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [rejected],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }

        if (!transaction.money.equals(ref.money)) {
          transaction.reject(FailureCode.AmountMismatch, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const rejected = WagerTransactionRejected.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [rejected],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }

        const existingReversal = await this.wagerRepo.findProcessedReversal(ref.id, transaction.kind);
        if (existingReversal !== null) {
          transaction.reject(FailureCode.AlreadyReversed, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const rejected = WagerTransactionRejected.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [rejected],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }

        referencedTransaction = ref;
      }

      if (transaction.kind === WagerTransactionKind.Loss) {
        transaction.markProcessed(undefined, cmd.at, wallet.balance);
        await this.wagerRepo.update(transaction);
        const eventContext = context(cmd.correlationId, this.ids);
        const processed = WagerTransactionProcessed.from(transaction, eventContext);
        await this.outboxRepo.insert(OutboxMessage.enqueue(processed));
        if (cmd.inboxMessage !== undefined) {
          await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
        }
        return {
          transaction,
          wallet,
          ledgerEntry: null,
          events: [processed],
          balance: wallet.balance,
          idempotentReplay: false
        };
      }

      if (transaction.kind === WagerTransactionKind.Bet) {
        try {
          const entry = wallet.debit({
            transactionId: transaction.id,
            entryId: this.ids.next(),
            money: transaction.money,
            at: cmd.at
          });
          await this.ledgerRepo.insert(entry);
          await this.walletRepo.update(wallet);
          transaction.markProcessed(undefined, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const processed = WagerTransactionProcessed.from(transaction, context(cmd.correlationId, this.ids));
          const changed = WalletBalanceChanged.from(wallet, entry, context(cmd.correlationId, this.ids));
          await this.outboxRepo.insert(OutboxMessage.enqueue(processed));
          await this.outboxRepo.insert(OutboxMessage.enqueue(changed));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: entry,
            events: [processed, changed],
            balance: wallet.balance,
            idempotentReplay: false
          };
        } catch (error) {
          if (error instanceof InsufficientFundsError) {
            transaction.reject(FailureCode.InsufficientFunds, cmd.at, wallet.balance);
            await this.wagerRepo.update(transaction);
            const eventContext = context(cmd.correlationId, this.ids);
            const rejected = WagerTransactionRejected.from(transaction, eventContext);
            await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
            if (cmd.inboxMessage !== undefined) {
              await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
            }
            return {
              transaction,
              wallet,
              ledgerEntry: null,
              events: [rejected],
              balance: wallet.balance,
              idempotentReplay: false
            };
          }
          throw error;
        }
      }

      if (transaction.kind === WagerTransactionKind.Win) {
        const entry = wallet.credit({
          transactionId: transaction.id,
          entryId: this.ids.next(),
          money: transaction.money,
          at: cmd.at
        });
        await this.ledgerRepo.insert(entry);
        await this.walletRepo.update(wallet);
        transaction.markProcessed(undefined, cmd.at, wallet.balance);
        await this.wagerRepo.update(transaction);
        const processed = WagerTransactionProcessed.from(transaction, context(cmd.correlationId, this.ids));
        const changed = WalletBalanceChanged.from(wallet, entry, context(cmd.correlationId, this.ids));
        await this.outboxRepo.insert(OutboxMessage.enqueue(processed));
        await this.outboxRepo.insert(OutboxMessage.enqueue(changed));
        if (cmd.inboxMessage !== undefined) {
          await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
        }
        return {
          transaction,
          wallet,
          ledgerEntry: entry,
          events: [processed, changed],
          balance: wallet.balance,
          idempotentReplay: false
        };
      }

      if (transaction.kind === WagerTransactionKind.Refund || transaction.kind === WagerTransactionKind.Rollback) {
        const ref = referencedTransaction;
        if (ref === null) {
          transaction.reject(FailureCode.ReferenceNotFound, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const eventContext = context(cmd.correlationId, this.ids);
          const rejected = WagerTransactionRejected.from(transaction, eventContext);
          await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: null,
            events: [rejected],
            balance: wallet.balance,
            idempotentReplay: false
          };
        }
        const direction = transaction.ledgerDirectionFor(ref);
        if (direction === LedgerDirection.Credit) {
          const entry = wallet.credit({
            transactionId: transaction.id,
            entryId: this.ids.next(),
            money: transaction.money,
            at: cmd.at
          });
          await this.ledgerRepo.insert(entry);
          await this.walletRepo.update(wallet);
          transaction.markProcessed(ref.id, cmd.at, wallet.balance);
          await this.wagerRepo.update(transaction);
          const processed = WagerTransactionProcessed.from(transaction, context(cmd.correlationId, this.ids));
          const changed = WalletBalanceChanged.from(wallet, entry, context(cmd.correlationId, this.ids));
          await this.outboxRepo.insert(OutboxMessage.enqueue(processed));
          await this.outboxRepo.insert(OutboxMessage.enqueue(changed));
          if (cmd.inboxMessage !== undefined) {
            await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
          }
          return {
            transaction,
            wallet,
            ledgerEntry: entry,
            events: [processed, changed],
            balance: wallet.balance,
            idempotentReplay: false
          };
        } else {
          try {
            const entry = wallet.debit({
              transactionId: transaction.id,
              entryId: this.ids.next(),
              money: transaction.money,
              at: cmd.at
            });
            await this.ledgerRepo.insert(entry);
            await this.walletRepo.update(wallet);
            transaction.markProcessed(ref.id, cmd.at, wallet.balance);
            await this.wagerRepo.update(transaction);
            const processed = WagerTransactionProcessed.from(transaction, context(cmd.correlationId, this.ids));
            const changed = WalletBalanceChanged.from(wallet, entry, context(cmd.correlationId, this.ids));
            await this.outboxRepo.insert(OutboxMessage.enqueue(processed));
            await this.outboxRepo.insert(OutboxMessage.enqueue(changed));
            if (cmd.inboxMessage !== undefined) {
              await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
            }
            return {
              transaction,
              wallet,
              ledgerEntry: entry,
              events: [processed, changed],
              balance: wallet.balance,
              idempotentReplay: false
            };
          } catch (error) {
            if (error instanceof InsufficientFundsError) {
              transaction.reject(FailureCode.ReversalWouldOverdraw, cmd.at, wallet.balance);
              await this.wagerRepo.update(transaction);
              const eventContext = context(cmd.correlationId, this.ids);
              const rejected = WagerTransactionRejected.from(transaction, eventContext);
              await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
              if (cmd.inboxMessage !== undefined) {
                await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
              }
              return {
                transaction,
                wallet,
                ledgerEntry: null,
                events: [rejected],
                balance: wallet.balance,
                idempotentReplay: false
              };
            }
            throw error;
          }
        }
      }

      transaction.reject(FailureCode.InvalidKind, cmd.at, wallet.balance);
      await this.wagerRepo.update(transaction);
      const eventContext = context(cmd.correlationId, this.ids);
      const rejected = WagerTransactionRejected.from(transaction, eventContext);
      await this.outboxRepo.insert(OutboxMessage.enqueue(rejected));
      if (cmd.inboxMessage !== undefined) {
        await this.inboxRepo.markProcessed(cmd.inboxMessage.consumerName, cmd.inboxMessage.messageId, cmd.at);
      }
      return {
        transaction,
        wallet,
        ledgerEntry: null,
        events: [rejected],
        balance: wallet.balance,
        idempotentReplay: false
      };
    });
  }

  private async replay(
    existing: WagerTransaction,
    payloadHash: string,
    idempotencyKey: string
  ): Promise<ProcessWagerTransactionResult> {
    if (!existing.matchesPayload(payloadHash)) {
      throw new IdempotencyConflictError('idempotency key reused with different payload', {
        idempotencyKey
      });
    }
    const wallet = await this.walletRepo.findById(existing.walletId);
    if (wallet === null) {
      throw new PersistenceConflictError('wallet missing for existing transaction', {
        walletId: existing.walletId
      });
    }
    return {
      transaction: existing,
      wallet,
      ledgerEntry: null,
      events: [],
      balance: existing.observedBalance,
      idempotentReplay: true
    };
  }

  private matchesReference(tx: WagerTransaction, ref: WagerTransaction): boolean {
    if (tx.providerId !== ref.providerId || tx.playerId !== ref.playerId || tx.walletId !== ref.walletId) return false;
    if (tx.money.currency !== ref.money.currency) return false;
    if (tx.roundId !== ref.roundId) return false;
    return true;
  }
}

function kindFrom(kind: string): WagerTransactionKind {
  if (kind === WagerTransactionKind.Bet) return WagerTransactionKind.Bet;
  if (kind === WagerTransactionKind.Win) return WagerTransactionKind.Win;
  if (kind === WagerTransactionKind.Loss) return WagerTransactionKind.Loss;
  if (kind === WagerTransactionKind.Refund) return WagerTransactionKind.Refund;
  if (kind === WagerTransactionKind.Rollback) return WagerTransactionKind.Rollback;
  if (kind === WagerTransactionKind.Opening) return WagerTransactionKind.Opening;
  throw new InvalidWagerTransactionError('invalid kind', { kind });
}

function context(correlationId: string, ids: UuidV7Generator): EventContext {
  return { eventId: ids.next(), correlationId, causationId: undefined, occurredAt: new Date() };
}
