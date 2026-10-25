import { Controller, Get, Post, Param, Query, Body, UseGuards, HttpStatus, Inject, Headers } from '@nestjs/common';
import { UuidV7Generator } from '../../../shared/domain/identity';
import { CreateWalletUseCase } from '../application/create-wallet.use-case';
import { GetWalletUseCase } from '../application/get-wallet.use-case';
import { GetWalletLedgerUseCase } from '../application/get-wallet-ledger.use-case';
import { ReconcileWalletUseCase } from '../../reconciliation/application/reconcile-wallet.use-case';
import { Money } from '../../../shared/domain/money';
import { AuthGuard } from '../../../shared/presentation/auth.guard';
import { AppException } from '../../../shared/presentation/exception-filter';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor';

@Controller()
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    @Inject(CreateWalletUseCase) private readonly createWallet: CreateWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
    @Inject(GetWalletLedgerUseCase) private readonly getLedger: GetWalletLedgerUseCase,
    @Inject(ReconcileWalletUseCase) private readonly reconcile: ReconcileWalletUseCase,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator
  ) {}

  @Post('/wallets')
  async create(
    @Headers('x-correlation-id') correlationIdHeader: string | undefined,
    @Headers('X-Correlation-Id') correlationIdHeader2: string | undefined,
    @Body() body: { playerId: string; initialBalance: { amount: string; currency: string } }
  ) {
    try {
      const correlationId = correlationIdHeader ?? correlationIdHeader2 ?? this.ids.next();
      const result = await this.createWallet.execute({
        playerId: body.playerId,
        initialBalance: Money.from(body.initialBalance),
        correlationId,
        at: new Date()
      });
      return {
        id: result.wallet.id,
        playerId: result.wallet.playerId,
        balance: result.wallet.balance.toJSON(),
        version: result.wallet.version
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'WalletAlreadyExistsError') {
        throw new AppException('WALLET_ALREADY_EXISTS', 'wallet already exists', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  @Get('/wallets/:walletId')
  async get(@Param('walletId') walletId: string) {
    const wallet = await this.getWallet.execute(walletId);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version
    };
  }

  @Get('/wallets/:walletId/ledger')
  async ledger(@Param('walletId') walletId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const page = await this.getLedger.execute(walletId, decodeLedgerCursor(cursor), Math.min(Number(limit ?? 50), 100));
    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString()
      })),
      nextCursor: page.nextCursor === null ? null : encodeLedgerCursor(page.nextCursor)
    };
  }

  @Post('/wallets/:walletId/reconciliation')
  async reconcileWallet(@Param('walletId') walletId: string) {
    const result = await this.reconcile.execute(walletId);
    return result;
  }
}
