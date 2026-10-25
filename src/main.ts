import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { GlobalExceptionFilter } from './shared/presentation/exception-filter';
import { UuidV7Generator } from './shared/domain/identity';
import type { Request, Response, NextFunction } from 'express';

function validateRequiredConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.awsRegion) missing.push('AWS_REGION');
  if (!config.awsAccessKeyId) missing.push('AWS_ACCESS_KEY_ID');
  if (!config.awsSecretAccessKey) missing.push('AWS_SECRET_ACCESS_KEY');
  if (!config.sqsEndpoint) missing.push('SQS_ENDPOINT');
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const ids = new UuidV7Generator();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const cid =
      (req.headers['x-correlation-id'] as string | undefined) ??
      (req.headers['X-Correlation-Id'] as string | undefined) ??
      ids.next();
    req.headers['x-correlation-id'] = cid;
    res.setHeader('X-Correlation-Id', cid);
    res.setHeader('x-correlation-id', cid);
    next();
  });
  app.useGlobalFilters(new GlobalExceptionFilter());
  const config = app.get(AppConfig);
  validateRequiredConfig(config);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
