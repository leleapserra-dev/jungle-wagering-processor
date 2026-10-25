import { Module } from '@nestjs/common';
import { ConfigModuleWrapper } from './config/config.module';
import { DatabaseModule } from './config/database.module';
import { AppLoggerModule } from './config/logging.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WageringModule } from './modules/wagering/wagering.module';
import { HealthModule } from './modules/health/health.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { MetricsModule } from './shared/observability/metrics.module';

@Module({
  imports: [
    AppLoggerModule,
    ConfigModuleWrapper,
    DatabaseModule,
    HealthModule,
    MetricsModule,
    WalletModule,
    WageringModule,
    MessagingModule
  ]
})
export class AppModule {}
