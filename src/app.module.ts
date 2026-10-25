import { Module } from '@nestjs/common';
import { ConfigModuleWrapper } from './config/config.module';
import { DatabaseModule } from './config/database.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WageringModule } from './modules/wagering/wagering.module';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './modules/messaging/messaging.module';

@Module({
  imports: [ConfigModuleWrapper, DatabaseModule, HealthModule, WalletModule, WageringModule, MessagingModule]
})
export class AppModule {}
