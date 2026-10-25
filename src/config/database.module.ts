import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { AppConfig } from './app-config';
import { ConfigModuleWrapper } from './config.module';
import { createOrmOptions } from './database.config';

@Module({
  imports: [
    ConfigModuleWrapper,
    MikroOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        createOrmOptions({ url: config.databaseUrl, poolSize: config.databasePoolSize, ssl: config.databaseSsl })
    })
  ]
})
export class DatabaseModule {}
