import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { DatabaseModule } from '../../config/database.module';
import { WalletController } from './presentation/wallet.controller';
import { CreateWalletUseCase } from './application/create-wallet.use-case';
import { GetWalletUseCase } from './application/get-wallet.use-case';
import { GetWalletLedgerUseCase } from './application/get-wallet-ledger.use-case';
import { MikroOrmWalletRepository } from './infrastructure/persistence/wallet.repository';
import { MikroOrmLedgerRepository } from './infrastructure/persistence/ledger.repository';
import { MikroOrmWagerTransactionRepository } from '../wagering/infrastructure/persistence/wager-transaction.repository';
import { MikroOrmUnitOfWork } from '../../shared/infrastructure/unit-of-work';
import { UuidV7Generator } from '../../shared/domain/identity';
import { ReconcileWalletUseCase } from '../reconciliation/application/reconcile-wallet.use-case';
import { AuthGuard, NoopProviderIdentityPort } from '../../shared/presentation/auth.guard';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GlobalExceptionFilter } from '../../shared/presentation/exception-filter';

@Module({
  imports: [DatabaseModule, MikroOrmModule],
  controllers: [WalletController],
  providers: [
    CreateWalletUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
    { provide: 'WalletRepository', useClass: MikroOrmWalletRepository },
    { provide: 'WalletLedgerRepository', useClass: MikroOrmLedgerRepository },
    { provide: 'WagerTransactionRepository', useClass: MikroOrmWagerTransactionRepository },
    { provide: 'UnitOfWork', useClass: MikroOrmUnitOfWork },
    UuidV7Generator,
    AuthGuard,
    NoopProviderIdentityPort,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter }
  ]
})
export class WalletModule {}
