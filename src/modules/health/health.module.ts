import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MessagingModule } from '../messaging/messaging.module';
import { HealthController } from './presentation/health.controller';

@Module({
  imports: [MikroOrmModule, MessagingModule],
  controllers: [HealthController]
})
export class HealthModule {}
