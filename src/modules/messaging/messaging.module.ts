import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { EntityManager } from '@mikro-orm/postgresql';
import { ConfigModuleWrapper } from '../../config/config.module';
import { DatabaseModule } from '../../config/database.module';
import { SqsClientService } from './infrastructure/sqs/sqs-client.service';
import { SqsConsumerService } from './application/sqs-consumer.service';
import { OutboxPublisherService } from './application/outbox-publisher.service';
import { MikroOrmInboxRepository } from './infrastructure/persistence/inbox.repository';
import { MikroOrmOutboxRepository } from './infrastructure/persistence/outbox.repository';
import { ProcessWagerTransactionUseCase } from '../wagering/application/process-wager-transaction.use-case';
import { MikroOrmWagerTransactionRepository } from '../wagering/infrastructure/persistence/wager-transaction.repository';
import { MikroOrmWalletRepository } from '../wallet/infrastructure/persistence/wallet.repository';
import { MikroOrmLedgerRepository } from '../wallet/infrastructure/persistence/ledger.repository';
import { MikroOrmUnitOfWork } from '../../shared/infrastructure/unit-of-work';
import { UuidV7Generator } from '../../shared/domain/identity';
import { Sha256PayloadHasher } from '../../shared/payload-hasher';

@Module({
  imports: [ConfigModuleWrapper, DatabaseModule, MikroOrmModule],
  providers: [
    SqsClientService,
    { provide: 'SqsClientService', useClass: SqsClientService },
    SqsConsumerService,
    OutboxPublisherService,
    { provide: 'InboxRepository', useClass: MikroOrmInboxRepository },
    { provide: 'OutboxRepository', useClass: MikroOrmOutboxRepository },
    ProcessWagerTransactionUseCase,
    { provide: 'WagerTransactionRepository', useClass: MikroOrmWagerTransactionRepository },
    { provide: 'WalletRepository', useClass: MikroOrmWalletRepository },
    { provide: 'WalletLedgerRepository', useClass: MikroOrmLedgerRepository },
    { provide: 'UnitOfWork', useClass: MikroOrmUnitOfWork },
    { provide: 'EntityManager', useFactory: (em: EntityManager) => em, inject: [EntityManager] },
    UuidV7Generator,
    Sha256PayloadHasher
  ],
  exports: [SqsClientService]
})
export class MessagingModule {}
