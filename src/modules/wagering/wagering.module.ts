import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { DatabaseModule } from '../../config/database.module';
import { WageringController } from './presentation/wagering.controller';
import { ProcessWagerTransactionUseCase } from './application/process-wager-transaction.use-case';
import { MikroOrmWagerTransactionRepository } from './infrastructure/persistence/wager-transaction.repository';
import { MikroOrmWalletRepository } from '../wallet/infrastructure/persistence/wallet.repository';
import { MikroOrmLedgerRepository } from '../wallet/infrastructure/persistence/ledger.repository';
import { MikroOrmInboxRepository } from '../messaging/infrastructure/persistence/inbox.repository';
import { MikroOrmOutboxRepository } from '../messaging/infrastructure/persistence/outbox.repository';
import { MikroOrmUnitOfWork } from '../../shared/infrastructure/unit-of-work';
import { UuidV7Generator } from '../../shared/domain/identity';
import { Sha256PayloadHasher } from '../../shared/payload-hasher';
import { AuthGuard } from '../../shared/presentation/auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { PendingReferenceWorker } from './application/pending-reference.worker';

@Module({
  imports: [DatabaseModule, MikroOrmModule],
  controllers: [WageringController],
  providers: [
    ProcessWagerTransactionUseCase,
    PendingReferenceWorker,
    { provide: 'WagerTransactionRepository', useClass: MikroOrmWagerTransactionRepository },
    { provide: 'WalletRepository', useClass: MikroOrmWalletRepository },
    { provide: 'WalletLedgerRepository', useClass: MikroOrmLedgerRepository },
    { provide: 'InboxRepository', useClass: MikroOrmInboxRepository },
    { provide: 'OutboxRepository', useClass: MikroOrmOutboxRepository },
    { provide: 'UnitOfWork', useClass: MikroOrmUnitOfWork },
    { provide: 'EntityManager', useFactory: (em: EntityManager) => em, inject: [EntityManager] },
    UuidV7Generator,
    Sha256PayloadHasher,
    AuthGuard,
    { provide: APP_GUARD, useClass: AuthGuard }
  ]
})
export class WageringModule {}
