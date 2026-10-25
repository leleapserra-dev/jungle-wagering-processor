import { Inject, Injectable } from '@nestjs/common';
import type { WalletRepository } from '../domain/wallet.repository';
import { WalletAlreadyExistsError } from '../../../shared/domain/errors';
import { Wallet } from '../domain/wallet';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { UuidV7Generator } from '../../../shared/domain/identity';
import { WagerTransactionKind } from '../../wagering/domain/wager-transaction-status';
import { WagerTransaction } from '../../wagering/domain/wager-transaction';
import type { WagerTransactionRepository } from '../../wagering/domain/wager-transaction.repository';
import type { WalletLedgerRepository } from '../domain/wallet-ledger.repository';
import { Money } from '../../../shared/domain/money';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: Money;
  correlationId: string;
  at: Date;
}

export interface CreateWalletResult {
  wallet: Wallet;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject('UnitOfWork') private readonly uow: UnitOfWork,
    @Inject('WalletRepository') private readonly walletRepo: WalletRepository,
    @Inject('WagerTransactionRepository') private readonly wagerRepo: WagerTransactionRepository,
    @Inject('WalletLedgerRepository') private readonly ledgerRepo: WalletLedgerRepository,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator
  ) {}

  async execute(cmd: CreateWalletCommand): Promise<CreateWalletResult> {
    return this.uow.run(async () => {
      const existing = await this.walletRepo.findByPlayerAndCurrency(cmd.playerId, cmd.initialBalance.currency);
      if (existing !== null) {
        throw new WalletAlreadyExistsError('wallet already exists for player and currency', {
          playerId: cmd.playerId,
          currency: cmd.initialBalance.currency
        });
      }

      const wallet = Wallet.open({
        id: this.ids.next(),
        playerId: cmd.playerId,
        initialBalance: Money.zero(cmd.initialBalance.currency),
        at: cmd.at
      });
      await this.walletRepo.insert(wallet);

      if (cmd.initialBalance.isPositive()) {
        const opening = WagerTransaction.create({
          id: this.ids.next(),
          providerId: 'INTERNAL',
          externalTransactionId: `OPENING:${wallet.id}`,
          idempotencyKey: `OPENING:${wallet.id}`,
          payloadHash: 'internal:opening',
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: 'OPENING',
          gameId: 'OPENING',
          kind: WagerTransactionKind.Opening,
          money: cmd.initialBalance,
          referenceExternalTransactionId: undefined,
          createdAt: cmd.at,
          observedBalance: Money.zero(cmd.initialBalance.currency)
        });
        opening.markProcessed(undefined, cmd.at, cmd.initialBalance);
        await this.wagerRepo.insert(opening);

        const entry = wallet.credit({
          transactionId: opening.id,
          entryId: this.ids.next(),
          money: cmd.initialBalance,
          at: cmd.at
        });
        // Opening credit must not increment version
        (wallet as unknown as { _version: number })._version = 1;
        (wallet as unknown as { _updatedAt: Date })._updatedAt = cmd.at;
        await this.ledgerRepo.insert(entry);
        await this.walletRepo.update(wallet);
      }

      return { wallet };
    });
  }
}
