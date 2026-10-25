import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { AppConfig } from '../../../config/app-config';
import type { WagerTransactionRepository } from '../domain/wager-transaction.repository';
import type { WalletRepository } from '../../wallet/domain/wallet.repository';
import type { WalletLedgerRepository } from '../../wallet/domain/wallet-ledger.repository';
import type { OutboxRepository } from '../../messaging/domain/outbox.repository';
import { UuidV7Generator } from '../../../shared/domain/identity';
import { FailureCode } from '../domain/failure-code';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged
} from '../domain/events';
import { LedgerDirection } from '../../wallet/domain/ledger-direction';
import { InsufficientFundsError } from '../../../shared/domain/errors';

@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickPromise: Promise<void> | null = null;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(AppConfig) private readonly config: AppConfig,
    @Inject('WagerTransactionRepository') private readonly wagerRepo: WagerTransactionRepository,
    @Inject('WalletRepository') private readonly walletRepo: WalletRepository,
    @Inject('WalletLedgerRepository') private readonly ledgerRepo: WalletLedgerRepository,
    @Inject('OutboxRepository') private readonly outboxRepo: OutboxRepository,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator,
    @Inject('EntityManager')
    private readonly em: { transactional: <T>(fn: (...args: unknown[]) => Promise<T>) => Promise<T> }
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.pendingReferenceEnabled) return;
    this.stopped = false;
    await this.startTick();
    this.timer = setInterval(() => {
      void this.startTick();
    }, this.config.pendingReferencePollIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.tickPromise !== null) {
      await this.tickPromise;
    }
  }

  private startTick(): Promise<void> {
    if (this.running || this.stopped) return Promise.resolve();
    this.running = true;
    this.tickPromise = this.reprocess()
      .catch((error: unknown) => {
        this.logger.error('pending reference tick failed', error instanceof Error ? error.stack : String(error));
      })
      .finally(() => {
        this.running = false;
        this.tickPromise = null;
      });
    return this.tickPromise;
  }

  private async reprocess(): Promise<void> {
    const now = new Date();
    const idsDue = await this.wagerRepo.findDuePendingReferenceIds(now, this.config.pendingReferenceBatchSize);
    for (const txId of idsDue) {
      await this.em.transactional(async () => {
        const tx = await this.wagerRepo.findByIdForUpdate(txId);
        if (tx === null || tx.status !== 'PENDING_REFERENCE') return;
        if (tx.referenceExternalTransactionId === undefined) {
          tx.reject(FailureCode.ReferenceNotFound, now, tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        const ref = await this.wagerRepo.findByProviderExternal(tx.providerId, tx.referenceExternalTransactionId);
        if (ref === null) {
          const attempts = tx.referenceAttempts + 1;
          if (attempts >= this.config.pendingReferenceMaxAttempts) {
            tx.reject(FailureCode.ReferenceNotFound, now, tx.observedBalance);
            await this.wagerRepo.update(tx);
            await this.outboxRepo.insert(
              OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
            );
            return;
          }
          const delay = Math.min(
            this.config.pendingReferenceBackoffBaseMs * 2 ** (attempts - 1),
            this.config.pendingReferenceBackoffMaxMs
          );
          tx.markPendingReference(now, new Date(now.getTime() + delay), tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionPendingReference.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (!ref.isTerminal() || ref.status !== 'PROCESSED') {
          const attempts = tx.referenceAttempts + 1;
          if (attempts >= this.config.pendingReferenceMaxAttempts) {
            tx.reject(FailureCode.ReferenceNotFound, now, tx.observedBalance);
            await this.wagerRepo.update(tx);
            await this.outboxRepo.insert(
              OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
            );
            return;
          }
          const delay = Math.min(
            this.config.pendingReferenceBackoffBaseMs * 2 ** (attempts - 1),
            this.config.pendingReferenceBackoffMaxMs
          );
          tx.markPendingReference(now, new Date(now.getTime() + delay), tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionPendingReference.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (
          tx.providerId !== ref.providerId ||
          tx.playerId !== ref.playerId ||
          tx.walletId !== ref.walletId ||
          tx.money.currency !== ref.money.currency ||
          tx.roundId !== ref.roundId
        ) {
          tx.reject(FailureCode.ReferenceMismatch, now, tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (!tx.money.equals(ref.money)) {
          tx.reject(FailureCode.AmountMismatch, now, tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        const existingReversal = await this.wagerRepo.findProcessedReversal(ref.id, tx.kind);
        if (existingReversal !== null) {
          tx.reject(FailureCode.AlreadyReversed, now, tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (ref.kind !== tx.kind && !(tx.kind === 'ROLLBACK' && (ref.kind === 'WIN' || ref.kind === 'REFUND'))) {
          if (!(ref.kind === 'BET' && (tx.kind === 'REFUND' || tx.kind === 'ROLLBACK'))) {
            tx.reject(FailureCode.InvalidReferenceKind, now, tx.observedBalance);
            await this.wagerRepo.update(tx);
            await this.outboxRepo.insert(
              OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
            );
            return;
          }
        }
        const wallet = await this.walletRepo.findByIdForUpdate(tx.walletId);
        if (wallet === null) {
          tx.reject(FailureCode.ReferenceNotFound, now, tx.observedBalance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (tx.kind === 'LOSS') {
          tx.markProcessed(ref.id, now, wallet.balance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionProcessed.from(tx, this.context(tx.walletId)))
          );
          return;
        }
        if (tx.kind === 'WIN') {
          const entry = wallet.credit({ transactionId: tx.id, entryId: this.ids.next(), money: tx.money, at: now });
          await this.ledgerRepo.insert(entry);
          await this.walletRepo.update(wallet);
          tx.markProcessed(ref.id, now, wallet.balance);
          await this.wagerRepo.update(tx);
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WagerTransactionProcessed.from(tx, this.context(tx.walletId)))
          );
          await this.outboxRepo.insert(
            OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, this.context(tx.walletId)))
          );
          return;
        }
        if (tx.kind === 'REFUND' || tx.kind === 'ROLLBACK') {
          const direction = tx.ledgerDirectionFor(ref);
          if (direction === LedgerDirection.Credit) {
            const entry = wallet.credit({ transactionId: tx.id, entryId: this.ids.next(), money: tx.money, at: now });
            await this.ledgerRepo.insert(entry);
            await this.walletRepo.update(wallet);
            tx.markProcessed(ref.id, now, wallet.balance);
            await this.wagerRepo.update(tx);
            await this.outboxRepo.insert(
              OutboxMessage.enqueue(WagerTransactionProcessed.from(tx, this.context(tx.walletId)))
            );
            await this.outboxRepo.insert(
              OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, this.context(tx.walletId)))
            );
            return;
          } else {
            try {
              const entry = wallet.debit({ transactionId: tx.id, entryId: this.ids.next(), money: tx.money, at: now });
              await this.ledgerRepo.insert(entry);
              await this.walletRepo.update(wallet);
              tx.markProcessed(ref.id, now, wallet.balance);
              await this.wagerRepo.update(tx);
              await this.outboxRepo.insert(
                OutboxMessage.enqueue(WagerTransactionProcessed.from(tx, this.context(tx.walletId)))
              );
              await this.outboxRepo.insert(
                OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, this.context(tx.walletId)))
              );
              return;
            } catch (error) {
              if (error instanceof InsufficientFundsError) {
                tx.reject(FailureCode.ReversalWouldOverdraw, now, wallet.balance);
                await this.wagerRepo.update(tx);
                await this.outboxRepo.insert(
                  OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
                );
                return;
              }
              throw error;
            }
          }
        }
        tx.reject(FailureCode.InvalidKind, now, tx.observedBalance);
        await this.wagerRepo.update(tx);
        await this.outboxRepo.insert(
          OutboxMessage.enqueue(WagerTransactionRejected.from(tx, this.context(tx.walletId)))
        );
      });
    }
  }

  private context(correlationId: string) {
    return { eventId: this.ids.next(), correlationId, causationId: undefined, occurredAt: new Date() };
  }
}
